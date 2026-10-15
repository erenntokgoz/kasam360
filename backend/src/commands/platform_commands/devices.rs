//! Cihaz kaydı komutları.
//!
//! Neden ayrı dosya: `platform_commands.rs` 500 satır tavanını aşıyordu ve
//! cihaz bloğu mantığı Tauri `State` içinde gömülüydü. Buradaki yordamlar
//! `&mut SqliteConnection` alır, yani **komutsuz testlenebilir**; Tauri sarmalayıcıları
//! yalnızca yetki + denetim ekler. `ledger_commands` vekiliyle aynı desen.
//!
//! Güvenlik kararları (Cihaz yönetimi):
//!   * `record_device_heartbeat` **yetkisizdi**: herhangi bir çağıran herhangi
//!     bir cihazın atış zamanını yazabiliyordu. Artık rol kapısı ve kiracı
//!     sınırı var; hedef bulunamazsa `NOT_FOUND` döner (sessiz `Ok` değil).
//!   * `register_device` UUID v4 üretiyordu; AGENTS.md §2 pref ULID şart.
//!   * Cihaz olayları `system:...` ve `SISTEM` kategorisiyle yazılıyordu;
//!     AGENTS.md §4.1'deki donmuş kategoriler arasında güvenlik olaylarına
//!     ayrılmış olan `GUVENLIK` kullanılır.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::db::DbPool;
use crate::id_generator::generate_id;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

/// Platform seviyesindeki (çapraz tenant) denetim kayıtlarının taşındığı
/// ayrılmış platform ad alanı. MASTER'ın kendi işletmesi yoktur; platform
/// kayıtları işletme kiracılarıyla aynı ad alanını paylaşırsa bir
/// işletmenin denetim defterine karışırdı (AGENTS.md §3.3).
const PLATFORM_AUDIT_TENANT: &str = "PLATFORM";

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceDto {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub device_type: String,
    pub status: String,
    pub last_heartbeat: Option<String>,
}

/// Cihaz komutlarının görünürlük kapsamı.
///
/// Neden ayrım: MASTER platform hesabıdır ve tüm işletmelerin cihazlarını
/// görmek görevidir; bu yüzden `Platform` kapsamı **bilinçli olarak** kiracı
/// filtresi uygulamaz. Bu durum kodda adıyla durur, rastgele unutulmuş bir
/// `WHERE` eksikliği değildir (AGENTS.md §3.3 istisnası, gerekçesi burada).
#[derive(Debug, Clone, PartialEq)]
pub enum CihazKapsam {
    /// MASTER: tüm kiracıların cihazları.
    Platform,
    /// İşletme sahibi/müdür: yalnız kendi işletmesi.
    Tenant(String),
}

impl CihazKapsam {
    /// Rol ve tenant kimliğinden kapsamı çözer.
    ///
    /// `tenant_id` verilmemişse ve rol kiracı düzeyindeyse hata verir:
    /// kapsamı bilinmeyen bir sorgu "tüm veriyi getir" anlamına gelmez.
    pub fn coz(caller_role: &str, tenant_id: Option<&str>) -> Result<Self, String> {
        if crate::rbac::require_master_present(Some(caller_role)).is_ok() {
            return Ok(Self::Platform);
        }
        let tenant = tenant_id
            .map(str::trim)
            .filter(|deger| !deger.is_empty())
            .ok_or_else(|| "UNAUTHORIZED: kiracı kapsamı belirtilmedi".to_string())?;
        crate::rbac::require_any_present(
            Some(caller_role),
            &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
        )?;
        Ok(Self::Tenant(tenant.to_string()))
    }

    /// Kiracı filtresi uygulanır mı?
    fn kiraci_filtresi_var(&self) -> bool {
        matches!(self, Self::Tenant(_))
    }

    fn tenant_id(&self) -> Option<&str> {
        match self {
            Self::Platform => None,
            Self::Tenant(tenant) => Some(tenant.as_str()),
        }
    }
}

/// Cihaz listesini döner.
///
/// `WHERE` kasıtlı olarak iki dallıdır: kiracı kapsamında filtre **zorunlu**,
/// platform kapsamında kapsam belirtisi satırla birlikte yorumlanır. Sorgu
/// hiçbir koşulda parametresiz çalışmaz; platform dalı da `tenant_id`
/// kolonunu okur, böylece yeni bir kolon eklendiğinde unutulmaz.
pub async fn list_devices(
    conn: &mut SqliteConnection,
    kapsam: &CihazKapsam,
) -> Result<Vec<DeviceDto>, String> {
    let sql = if kapsam.kiraci_filtresi_var() {
        "SELECT id, tenant_id, name, device_type, status, last_heartbeat
           FROM devices WHERE tenant_id = ? ORDER BY name ASC"
    } else {
        "SELECT id, tenant_id, name, device_type, status, last_heartbeat
           FROM devices ORDER BY name ASC"
    };

    let sorgu = sqlx::query(sql);
    let rows = match kapsam.tenant_id() {
        Some(tenant) => sorgu.bind(tenant).fetch_all(&mut *conn).await,
        None => sorgu.fetch_all(&mut *conn).await,
    }
    .map_err(|e| e.to_string())?;

    let mut cihazlar = Vec::with_capacity(rows.len());
    for row in rows {
        cihazlar.push(DeviceDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            tenant_id: row.try_get("tenant_id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            device_type: row.try_get("device_type").map_err(|e| e.to_string())?,
            status: row.try_get("status").map_err(|e| e.to_string())?,
            last_heartbeat: row.try_get("last_heartbeat").ok(),
        });
    }
    Ok(cihazlar)
}

/// Cihaz atış zamanını yazar.
///
/// **Yetki kapsamı zorunludur** ve hedef bulunamazsa hata döner. Daha önce bu
/// komut yetkisizdi ve sıfır satır güncellendiğinde bile başarı döndürüyordu;
/// izleme ekranı "çalışıyor" derken cihaz kaydı hiç güncellenmiyor olabilirdi.
pub async fn record_heartbeat(
    conn: &mut SqliteConnection,
    kapsam: &CihazKapsam,
    device_id: &str,
) -> Result<(), String> {
    let sql = if kapsam.kiraci_filtresi_var() {
        "UPDATE devices SET last_heartbeat = datetime('now')
          WHERE id = ? AND tenant_id = ?"
    } else {
        "UPDATE devices SET last_heartbeat = datetime('now') WHERE id = ?"
    };

    let sorgu = sqlx::query(sql).bind(device_id);
    let sonuc = match kapsam.tenant_id() {
        Some(tenant) => sorgu.bind(tenant).execute(&mut *conn).await,
        None => sorgu.execute(&mut *conn).await,
    }
    .map_err(|e| e.to_string())?;

    if sonuc.rows_affected() == 0 {
        return Err("NOT_FOUND: kapsamın dışında cihaz bulunamadı".to_string());
    }
    Ok(())
}

/// Yeni cihaz kaydeder ve kimliğini döner.
///
/// Kimlik **pref ULID**'dir (`dev_`), AGENTS.md §2'nin emrettiği gibi.
/// `datetime('now')` UTC yazar; bu bir zaman damgası olduğu için sorun değil,
/// ancak gösterim katmanı yerele çevirmelidir (bkz. `print_commands`).
pub async fn cihaz_kaydet(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    name: &str,
    device_type: &str,
) -> Result<DeviceDto, String> {
    let tenant = tenant_id.trim();
    if tenant.is_empty() {
        return Err("VALIDATION: tenant_id zorunludur".to_string());
    }
    let ad = name.trim();
    if ad.is_empty() {
        return Err("VALIDATION: cihaz adı boş olamaz".to_string());
    }
    let tur = device_type.trim();
    if tur.is_empty() {
        return Err("VALIDATION: cihaz türü boş olamaz".to_string());
    }

    let id = generate_id("dev");
    sqlx::query(
        "INSERT INTO devices (id, tenant_id, name, device_type, status)
         VALUES (?, ?, ?, ?, 'ACTIVE')",
    )
    .bind(&id)
    .bind(tenant)
    .bind(ad)
    .bind(tur)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(DeviceDto {
        id,
        tenant_id: tenant.to_string(),
        name: ad.to_string(),
        device_type: tur.to_string(),
        status: "ACTIVE".to_string(),
        last_heartbeat: None,
    })
}

/// Cihazı etkin/pasif arasında değiştirir.
pub async fn cihaz_durum_degistir(
    conn: &mut SqliteConnection,
    device_id: &str,
) -> Result<DeviceDto, String> {
    let row = sqlx::query(
        "UPDATE devices
            SET status = CASE WHEN status = 'ACTIVE' THEN 'INACTIVE' ELSE 'ACTIVE' END
          WHERE id = ?
      RETURNING id, tenant_id, name, device_type, status, last_heartbeat",
    )
    .bind(device_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: cihaz bulunamadı".to_string())?;

    Ok(DeviceDto {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        tenant_id: row.try_get("tenant_id").map_err(|e| e.to_string())?,
        name: row.try_get("name").map_err(|e| e.to_string())?,
        device_type: row.try_get("device_type").map_err(|e| e.to_string())?,
        status: row.try_get("status").map_err(|e| e.to_string())?,
        last_heartbeat: row.try_get("last_heartbeat").ok(),
    })
}

// ---------------------------------------------------------------------------
// Tauri sarmalayıcıları
// ---------------------------------------------------------------------------

/// Cihaz listesi. MASTER tüm işletmeleri, işletme sahibi kendi cihazlarını görür.
#[tauri::command]
pub async fn get_devices(
    caller_role: String,
    caller_tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DeviceDto>, String> {
    let kapsam = CihazKapsam::coz(&caller_role, caller_tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    list_devices(&mut conn, &kapsam).await
}

/// Cihaz atışı. Rol ve kiracı kapsamı zorunludur.
#[tauri::command]
pub async fn record_device_heartbeat(
    caller_role: String,
    caller_tenant_id: Option<String>,
    device_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    let kapsam = CihazKapsam::coz(&caller_role, caller_tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    record_heartbeat(&mut conn, &kapsam, device_id.trim()).await
}

/// Yeni cihaz kaydı. MASTER işletmesi adına cihaz tanımlar.
#[tauri::command]
pub async fn register_device(
    caller_role: String,
    tenant_id: String,
    name: String,
    device_type: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeviceDto, String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let dto = cihaz_kaydet(&mut conn, &tenant_id, &name, &device_type).await?;

    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        category::GUVENLIK,
        "security:device_registered",
        dto.id.clone(),
        serde_json::json!({
            "tenantId": dto.tenant_id,
            "name": dto.name,
            "deviceType": dto.device_type
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut conn, &audit_lock, &ctx).await?;
    Ok(dto)
}

/// Cihazı etkin/pasif yapar. MASTER işletmesi adına karar verir.
#[tauri::command]
pub async fn toggle_device_status(
    caller_role: String,
    device_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeviceDto, String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let onceki: Option<String> = sqlx::query_scalar("SELECT status FROM devices WHERE id = ?")
        .bind(device_id.trim())
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let dto = cihaz_durum_degistir(&mut conn, device_id.trim()).await?;

    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        category::GUVENLIK,
        "security:device_status_changed",
        dto.id.clone(),
        serde_json::json!({
            "changes": { "status": { "old": onceki, "new": dto.status } }
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut conn, &audit_lock, &ctx).await?;
    Ok(dto)
}

/// Cihazı siler. MASTER işletmesi adına karar verir.
#[tauri::command]
pub async fn delete_device(
    caller_role: String,
    device_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let onceki_ad: Option<String> = sqlx::query_scalar("SELECT name FROM devices WHERE id = ?")
        .bind(device_id.trim())
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let sonuc = sqlx::query("DELETE FROM devices WHERE id = ?")
        .bind(device_id.trim())
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    if sonuc.rows_affected() != 1 {
        return Err("NOT_FOUND: cihaz bulunamadı".to_string());
    }

    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        category::GUVENLIK,
        "security:device_deleted",
        device_id.trim().to_string(),
        serde_json::json!({ "name": onceki_ad }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut conn, &audit_lock, &ctx).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
