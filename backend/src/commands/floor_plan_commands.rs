//! Faz 13 · Kroki çizim Tauri komutları.
//!
//! Bu katman **yalnız üç iş yapar**: yetkiyi sınar, kilidi alır, servise
//! delegasyon yapar. Yerleşim kuralları `services::floor360` içindedir.
//!
//! Adlandırma notu: `get_floor_plan` adı `floor_commands`deki mevcut komuta
//! aittir ve kart görünümünün işletim verisini verir (durum, garson, tutar).
//! Bu modülün `get_floor_layout` komutu ise **geometri** döner (x, y, döndürme,
//! sandalye, bölüm, mimari obje). İki yüzey farklı olduğu için iki komut da
//! gereklidir; aynı ada bağlamak mevcut `useFloorStore` sözleşmesini kırardı.
//!
//! Yazma disiplini: her yazma `BEGIN IMMEDIATE` altında atomik çalışır. Tek
//! bir kayıt reddedilirse düzenin tamamı geri alınır; kısmi kayıt bırakılmaz.

use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{category, AuditLock};
use crate::services::floor360::types::{CreateObjectInput, FloorLayout, SaveLayoutInput};
use crate::services::floor360::{layout, objects};
use crate::AppState;
use serde::Deserialize;
use sqlx::SqliteConnection;
use tauri::State;

/// Krokiyi okuyan roller. Garson masayı bulmak zorunda olduğu için salon
/// herkese açıktır; yalnız **çizim** kısıtlıdır.
const READ_ROLES: [Role; 5] = [
    Role::Owner,
    Role::Manager,
    Role::Cashier,
    Role::Waiter,
    Role::Kitchen,
];
/// Krokiyi çizen roller. Garson salonu görebilir ama yerleşimi değiştiremez:
/// yanlışlıkla masayı taşınan bir akşam servisi kaybolur.
const WRITE_ROLES: [Role; 2] = [Role::Owner, Role::Manager];

/// Kim yaptı, hangi işletmede yaptı.
///
/// Neden yapı: bu üçlü her yazma komutunda aynı anda taşınır. Ayrı argüman
/// olarak taşındığında biri unutulabilir ve kayıt başka bir işletmenin
/// defterine yazılır (AGENTS.md §3.3). Tek bir değer olarak taşınması
/// "eksik üçlü" durumunu derleme zamanına taşır.
struct Aktör {
    tenant_id: String,
    actor_id: String,
    actor_role: String,
}

impl Aktör {
    /// Çağrıdan işletme ve aktör kimliğini fail-closed çözer.
    ///
    /// Neden hedef satırdan okunmuyor: okunursa bir işletme sahibi başka
    /// işletmenin `tbl_...` kimliğini tahmin edip kendi krokisine
    /// yerleştirebilir ve denetim kaydı kurbanın defterine yazılır.
    fn coz(
        actor_id: Option<String>,
        actor_role: &str,
        tenant_id: Option<&str>,
    ) -> Result<Self, String> {
        let kirac = tenant_id.unwrap_or("").trim();
        if kirac.is_empty() {
            return Err("UNAUTHORIZED: oturum işletmesi yok, işlem reddedildi".into());
        }
        Ok(Self {
            tenant_id: kirac.to_string(),
            // Oturum bilgisi taşımayan bir çağrı "SYSTEM" olarak yazılır;
            // boş bırakılırsa denetim defterinde boş bir aktör sütunu oluşur
            // ve soruşturulamaz.
            actor_id: actor_id.unwrap_or_else(|| "SYSTEM".to_string()),
            actor_role: actor_role.to_string(),
        })
    }

    fn tenant(&self) -> &str {
        &self.tenant_id
    }
}

/// Havuz bağlantısı alır. Bağlantı hatası `Err` olarak yukarı taşınır;
/// sessizce boş sonuç dönülmez.
async fn acquire(pool: &DbPool) -> Result<SqliteConnection, String> {
    pool.acquire()
        .await
        .map(|baglanti| baglanti.detach())
        .map_err(|e| e.to_string())
}

/// `BEGIN IMMEDIATE` açar.
///
/// Neden IMMEDIATE: iki kasiyer aynı salonu aynı anda kaydederse DEFERRED
/// kilidi ikisi de alır ve ikincisi ilk yazmanın üzerine yazar. Kilidi
/// baştan alıp yazma sırasına sokmak, "son yazan kazanır" sessiz veri
/// kaybını "ikinci kullanıcı uyarı alır" biçimine çevirir.
async fn baslat(conn: &mut SqliteConnection) -> Result<(), String> {
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// İşlemi kapatır: başarılıysa `COMMIT`, hatalıysa `ROLLBACK`.
///
/// Neden ayrı fonksiyon: yedi yazma komutunun da aynı `match` blokunu
/// kopyalaması, birinde `ROLLBACK` unutulduğunda sessizce kısmi yazı
/// bırakması demektir. Kapatma kuralı tek yerde yaşar.
async fn kapat<T>(conn: &mut SqliteConnection, sonuc: Result<T, String>) -> Result<T, String> {
    match sonuc {
        Ok(deger) => {
            sqlx::query("COMMIT")
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(deger)
        }
        Err(hata) => {
            // Geri alma hatası asıl hatayı gölgelemez; asıl hata kullanıcıya
            // gider çünkü o, sorunun ne olduğunu bilen taraftır.
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
            Err(hata)
        }
    }
}

/// Denetim defteri kaydı. `SIPARIS_MASA` kategorisi kullanılır: kroki salonun
/// masa yerleşimidir ve sipariş defterinin parçasıdır.
async fn record_audit(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    aktor: &Aktör,
    action: &str,
    resource_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    crate::inventory360_commands::record_audit(
        conn,
        lock,
        &aktor.tenant_id,
        &aktor.actor_id,
        &aktor.actor_role,
        category::SIPARIS_MASA,
        action,
        resource_id,
        payload,
    )
    .await
}

/// Krokinin tamamını döner: bölümler + masa geometrisi + mimari objeler.
#[tauri::command]
pub async fn get_floor_layout(
    actor_role: String,
    tenant_id: Option<String>,
    zone_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<FloorLayout, String> {
    rbac::require_any(&actor_role, &READ_ROLES)?;
    let tenant_id = tenant_id.unwrap_or_default();
    let kirac = tenant_id.trim();
    if kirac.is_empty() {
        return Err("UNAUTHORIZED: oturum işletmesi yok, işlem reddedildi".into());
    }
    let zone_id = zone_id
        .map(|deger| deger.trim().to_string())
        .filter(|deger| !deger.is_empty());

    let mut conn = acquire(&pool).await?;
    layout::get_layout(&mut conn, kirac, zone_id.as_deref()).await
}

/// Kroki düzenini kaydeder. Tüm masalar ve objeler tek yazma birimi olarak
/// ilerler: biri reddedilirse hiçbiri yazılmaz.
#[tauri::command]
pub async fn save_floor_layout(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: SaveLayoutInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &WRITE_ROLES)?;

    let aktor = Aktör::coz(actor_id, &actor_role, tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    baslat(&mut conn).await?;

    let sonuc: Result<(), String> = async {
        layout::save_layout(&mut conn, aktor.tenant(), &args).await?;
        record_audit(
            &mut conn,
            &lock,
            &aktor,
            "floor:layout_saved",
            aktor.tenant(),
            serde_json::json!({
                "tableCount": args.tables.len(),
                "objectCount": args.objects.len(),
            }),
        )
        .await
    }
    .await;

    kapat(&mut conn, sonuc).await
}

/// Yeni salon bölümü açar.
#[tauri::command]
pub async fn create_floor_zone(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    name: String,
    sort_order: Option<i64>,
    pool: State<'_, DbPool>,
    app_state: State<'_, AppState>,
) -> Result<String, String> {
    rbac::require_any(&actor_role, &WRITE_ROLES)?;

    let aktor = Aktör::coz(actor_id, &actor_role, tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let sira = sort_order.unwrap_or(0);
    baslat(&mut conn).await?;

    let sonuc: Result<String, String> = async {
        let id = layout::create_zone(&mut conn, aktor.tenant(), &name, sira).await?;
        record_audit(
            &mut conn,
            &lock,
            &aktor,
            "floor:zone_created",
            &id,
            serde_json::json!({ "name": name, "sortOrder": sira }),
        )
        .await?;
        Ok(id)
    }
    .await;

    kapat(&mut conn, sonuc).await
}

/// Salon bölümünü kaldırır. Bölüme bağlı masalar silinmez, yalnız
/// bağlantıları düşer.
#[tauri::command]
pub async fn delete_floor_zone(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    zone_id: String,
    pool: State<'_, DbPool>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &WRITE_ROLES)?;

    let aktor = Aktör::coz(actor_id, &actor_role, tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    baslat(&mut conn).await?;

    let sonuc: Result<(), String> = async {
        layout::delete_zone(&mut conn, aktor.tenant(), &zone_id).await?;
        record_audit(
            &mut conn,
            &lock,
            &aktor,
            "floor:zone_deleted",
            &zone_id,
            serde_json::json!({}),
        )
        .await
    }
    .await;

    kapat(&mut conn, sonuc).await
}

/// Yeni mimari obje ekler (kapı, bar, duvar, kolon).
///
/// Neden ayrı komut: düzen kaydetme yalnız **taşıma** yapar. Elle kapı
/// koyabilmek için bir oluşturma yolu gerekir; aksi halde salon yalnız
/// şablonlarla kurulabilir.
#[tauri::command]
pub async fn create_floor_object(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: CreateObjectInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, AppState>,
) -> Result<String, String> {
    rbac::require_any(&actor_role, &WRITE_ROLES)?;

    let aktor = Aktör::coz(actor_id, &actor_role, tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    baslat(&mut conn).await?;

    let sonuc: Result<String, String> = async {
        let id = objects::create_object(&mut conn, aktor.tenant(), &args).await?;
        record_audit(
            &mut conn,
            &lock,
            &aktor,
            "floor:object_created",
            &id,
            serde_json::json!({ "kind": args.kind, "x": args.x, "y": args.y }),
        )
        .await?;
        Ok(id)
    }
    .await;

    kapat(&mut conn, sonuc).await
}

/// Mimari objeyi kaldırır.
#[tauri::command]
pub async fn delete_floor_object(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    object_id: String,
    pool: State<'_, DbPool>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &WRITE_ROLES)?;

    let aktor = Aktör::coz(actor_id, &actor_role, tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    baslat(&mut conn).await?;

    let sonuc: Result<(), String> = async {
        objects::delete_object(&mut conn, aktor.tenant(), &object_id).await?;
        record_audit(
            &mut conn,
            &lock,
            &aktor,
            "floor:object_deleted",
            &object_id,
            serde_json::json!({}),
        )
        .await
    }
    .await;

    kapat(&mut conn, sonuc).await
}

/// Hazır şablonu uygular ve uygulanan şablonun adını döner.
#[tauri::command]
pub async fn apply_floor_template(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    template_id: String,
    pool: State<'_, DbPool>,
    app_state: State<'_, AppState>,
) -> Result<String, String> {
    rbac::require_any(&actor_role, &WRITE_ROLES)?;

    let aktor = Aktör::coz(actor_id, &actor_role, tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    baslat(&mut conn).await?;

    let sonuc: Result<String, String> = async {
        let ad = objects::apply_template(&mut conn, aktor.tenant(), &template_id).await?;
        record_audit(
            &mut conn,
            &lock,
            &aktor,
            "floor:template_applied",
            aktor.tenant(),
            serde_json::json!({ "templateId": template_id, "name": ad }),
        )
        .await?;
        Ok(ad)
    }
    .await;

    kapat(&mut conn, sonuc).await
}

/// Hazır şablonların listesi. Frontend seçici bu listeyi tek kaynaktan alır.
#[tauri::command]
pub async fn list_floor_templates() -> Result<Vec<FloorTemplateInfo>, String> {
    let kayitlar = objects::list_templates().await?;
    Ok(kayitlar
        .into_iter()
        .map(|(id, name, description)| FloorTemplateInfo {
            id,
            name,
            description,
        })
        .collect())
}

/// Şablon özeti. Frontend'in çizim verisine ihtiyacı yok; yalnız ad ve
/// açıklama gösterir.
#[derive(Debug, Clone, serde::Serialize, Deserialize)]
pub struct FloorTemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}
