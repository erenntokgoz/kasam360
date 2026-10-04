//! Kimlik doğrulama komutları (PIN, kullanıcı, şifre değişimi)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::{Acquire, Row};

use crate::services::security360::login_lockout::{
    basari_sifirla, hesap_kapsami, hata_kaydet, kilit_kontrol, pin_kapsami, KilitDurumu,
};

#[cfg(test)]
#[path = "auth_commands/security_tests.rs"]
mod tests;

/// Giriş sırasında sayacın hangi kiracı altına yazılacağı.
///
/// Neden ayrı sabit: giriş anında kiracı bilinmez (kimlik henüz doğrulanmadı).
/// `login_attempts.tenant_id` bir kaynak alanıdır; filtre olarak kullanılsaydı
/// okuma ve yazma farklı değerlerle çalışır ve kilit sessizce kaçardı.
const GIRIS_KIRACISI: &str = "PLATFORM_GIRIS";

/// MASTER oturumunun taşıdığı bayrakların **gerçek** listesi.
///
/// Neden bu liste: 11 bayrağın tamamı iki giriş yolunda (PIN ve e-posta)
/// elle yazılıydı ve kod tabanında karşılığı olmayan bayraklar da açıktı.
/// `feat_seat_split`, `feat_delivery`, `feat_caller_id` ve
/// `feat_dynamic_pricing` henüz uygulanmadığı için **açılmaz**: açık bir
/// bayrak, arayüzde hiçbir komuta karşılığı olmayan bir özellik gösterir ve
/// kullanıcı çalışmayan bir düğmeyle karşılaşır.
///
/// Kapanan listede bugün uygulanmış olan bayraklar vardır; yenisi eklenirken
/// bu tablo güncellenmelidir. `feat_multi_branch` burada **açıktır** çünkü
/// şube komutları (`branch_commands.rs`) uygulanmıştır; ancak arayüz bu bayrağı
/// MASTER'ın **kendi** listesiyle değil, yönettiği kiracının modül listesiyle
/// çözer (`PlatformBranchesPanel.tsx`) — platform hesabının bir işletmesi
/// yoktur.
const MASTER_MODULES: [&str; 7] = [
    "feat_kds",
    "feat_qr_menu",
    "feat_table_order",
    "feat_recipe_bom",
    "feat_ledger_cari",
    "feat_loss_radar",
    "feat_multi_branch",
];

/// MASTER oturumunun bayrak listesini üretir.
///
/// Neden fonksiyon: liste iki giriş yolunda da kullanılıyor; iki ayrı el yazımı
/// yeniden ayrışma riski taşır.
pub(crate) fn master_modules() -> Vec<String> {
    MASTER_MODULES.iter().map(|m| m.to_string()).collect()
}

/// Kilit veya uyarı mesajını döndürür.
fn kilit_mesaji(durum: &KilitDurumu) -> String {
    durum.mesaj.clone()
}

/// PIN değiştirme için mevcut PIN'in **zorunlu** olduğunu doğrular ve temizler.
///
/// Neden ayrı yordam: kapı Tauri komutu içinde test edilemez (`State` kurulamaz),
/// kuralın kendisi ise saf bir işlevdir. Ayrıca kural tek yerde yazılır; iki
/// çağrı yeri birbirinden ayrışamaz.
pub(crate) fn mevcut_pin_zorunlu(current_pin: Option<&str>) -> Result<String, String> {
    current_pin
        .map(str::trim)
        .filter(|deger| !deger.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: PIN değiştirmek için mevcut PIN gereklidir".to_string())
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UserDto {
    pub id: String,
    pub role: String,
    pub name: String,
    pub tenant_id: String,
    #[serde(rename = "activeModules", skip_serializing_if = "Option::is_none")]
    pub active_modules: Option<Vec<String>>,
}

async fn user_dto_with_modules(pool: &DbPool, row: &sqlx::sqlite::SqliteRow) -> UserDto {
    let tenant_id: String = row.try_get("tenant_id").unwrap_or_else(|_| "DEFAULT_TENANT".to_string());
    let module_rows = sqlx::query("SELECT module_id FROM tenant_modules WHERE tenant_id = ? AND is_active = 1")
        .bind(&tenant_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    let active_modules: Vec<String> = module_rows
        .into_iter()
        .map(|r| r.try_get("module_id").unwrap_or_default())
        .collect();

    UserDto {
        id: row.try_get("id").unwrap_or_default(),
        role: row.try_get("role").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        tenant_id,
        active_modules: Some(active_modules),
    }
}

/// Authenticates an exact, provisioned login identifier.  Names and roles are
/// deliberately not identifiers: neither is stable nor secret.
pub async fn authenticate_by_identifier(pool: &DbPool, identifier: &str, secret: &str) -> Result<UserDto, String> {
    let identifier = identifier.trim();
    if identifier.is_empty() || secret.is_empty() {
        return Err("Geçersiz kimlik bilgileri".to_string());
    }

    // Kaba kuvvet kilidi DB'dedir (Faz 15 B2). Kapsam kimlik metninden türetilir;
    // küçük/büyük harf farkı iki ayrı kilit sayılmasın diye normalize edilir.
    let kapsam = hesap_kapsami(identifier);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Kilit **önce** kontrol edilir: kilitli bir kimliğin kayıtlı olup olmadığı
    // sorgulanırsa saldırgana "bu kimlik var" bilgisi bedava verilir.
    kilit_kontrol(&mut conn, &kapsam).await?;

    // İlk olarak platform_admins tablosuna bak (MASTER yetkisi için).
    // Sütun `pin_hash`: düz metin `pin` kaldırıldı, yalnızca Argon2id PHC kabul edilir.
    let admin_row = sqlx::query(
        "SELECT id, name, pin_hash FROM platform_admins WHERE email = ? COLLATE NOCASE",
    )
    .bind(identifier)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = admin_row {
        let hash: Option<String> = row.try_get("pin_hash").ok().flatten();
        let is_valid = match hash.as_deref() {
            Some(hash) => crate::user_credentials::verify_stored_credential(secret, hash),
            None => false,
        };

        if is_valid {
            basari_sifirla(&mut conn, &kapsam).await?;
            return Ok(UserDto {
                id: row.try_get("id").unwrap_or_default(),
                role: "MASTER".to_string(),
                name: row.try_get("name").unwrap_or_default(),
                tenant_id: "DEFAULT_TENANT".to_string(),
                active_modules: Some(master_modules()),
            });
        }
    }

    let row = sqlx::query(
        "SELECT id, role, name, tenant_id, credential_hash FROM users WHERE is_active = 1 AND (login_identifier = ? COLLATE NOCASE OR email = ? COLLATE NOCASE OR id = ?)",
    )
    .bind(identifier)
    .bind(identifier)
    .bind(identifier)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Kullanıcı bulunamadı da bulundu, hata **aynı** metni döner: aksi halde
    // "bu e-posta kayıtlı" diyerek kayıtlı hesapları saymak mümkün olurdu.
    // Sayaç yine ilerler — kimlik bulunamasa da bu bir denemedir.
    let Some(row) = row else {
        let durum = hata_kaydet(&mut conn, GIRIS_KIRACISI, &kapsam).await?;
        return Err(kilit_mesaji(&durum));
    };
    // Yalnızca Argon2 hash'i kabul edilir; düz metin PIN sütunu artık yoktur ve
    // migration'da hash'e çevrilmiştir. Argon2 olmayan bir hash "eşleşme" sayılmaz.
    let hash: Option<String> = row.try_get("credential_hash").ok().flatten();
    let is_valid = match hash.as_deref() {
        Some(hash) if crate::user_credentials::is_argon2_hash(hash) => {
            crate::auth::verify_credential(secret, hash)
        }
        _ => false,
    };

    if !is_valid {
        let tenant: String = row.try_get("tenant_id").unwrap_or_default();
        let durum = hata_kaydet(&mut conn, &tenant, &kapsam).await?;
        return Err(kilit_mesaji(&durum));
    }
    basari_sifirla(&mut conn, &kapsam).await?;
    drop(conn);
    Ok(user_dto_with_modules(pool, &row).await)
}

/// PIN entry remains supported for restaurant workstations.  PINs are checked
/// against salted Argon2 hashes when available, with safe fallback to provisioned PINs.
/// PIN ile kimlik doğrulama — Restoran çalışma istasyonları için.
/// Multi-tenant izolasyonu: Eğer tenant_id belirtilmişse, öncelikle o işletmeye ait personel aranır.
pub async fn authenticate_by_pin(pool: &DbPool, pin: &str, target_tenant_id: Option<&str>) -> Result<UserDto, String> {
    // Multi-tenant PIN çakışmasını engelle (Cross-Tenant PIN Fallthrough Koruması):
    // tenant belirtilmişse yalnızca o tenant taranır, bulunamazsa hiçbir başka
    // kiracıya düşülmez. Tenant belirtilmemişse yalnızca DEFAULT_TENANT denenir —
    // bu, tüm veritabanını taramakla aynı şey değildir.
    let effective_tenant = match target_tenant_id {
        Some(tenant) if !tenant.is_empty() => tenant,
        _ => "DEFAULT_TENANT",
    };

    // Kilit kapsamı **kiracıdır**, PIN'in kendisi değil. PIN kapsam anahtarına
    // girseydi saldırgan kapsamları sayarak hangi PIN'lerin kayıtlı olduğunu
    // keşfedebilirdi. Önceden tek bir global sayaç vardı; beş hatalı deneme
    // bütün personeli kilitliyordu, yani saldırgan bedava bir hizmet alıyordu.
    let kapsam = pin_kapsami(effective_tenant);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    kilit_kontrol(&mut conn, &kapsam).await?;

    // PIN uzunluğu en az 4, en fazla 8 hane ve tamamen rakamlardan oluşmalıdır
    if !pin.chars().all(|character| character.is_ascii_digit()) || !(4..=8).contains(&pin.len()) {
        let durum = hata_kaydet(&mut conn, effective_tenant, &kapsam).await?;
        return Err(if durum.kilitli {
            kilit_mesaji(&durum)
        } else {
            "Geçersiz PIN".to_string()
        });
    }

    // İlk olarak platform_admins kontrol et (MASTER her işletmede geçerlidir).
    // `pin_hash` sütunu Argon2id tutar; düz metin karşılaştırması yoktur.
    let admin_rows = sqlx::query("SELECT id, name, pin_hash FROM platform_admins")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    for row in admin_rows {
        let hash: Option<String> = row.try_get("pin_hash").ok().flatten();
        let is_valid = match hash.as_deref() {
            Some(hash) => crate::user_credentials::verify_stored_credential(pin, hash),
            None => false,
        };

        if is_valid {
            basari_sifirla(&mut conn, &kapsam).await?;
            drop(conn);
            return Ok(UserDto {
                id: row.try_get("id").unwrap_or_default(),
                role: "MASTER".to_string(),
                name: row.try_get("name").unwrap_or_default(),
                tenant_id: effective_tenant.to_string(),
                active_modules: Some(master_modules()),
            });
        }
    }

    // PIN düz metin olmadığı için `WHERE pin = ?` yerine aday satırlar Argon2 ile
    // doğrulanır. Bu tarama `user_credentials` içinde tek yerde yaşar.
    let matched =
        crate::user_credentials::find_user_by_pin(&mut conn, pin, Some(effective_tenant)).await?;

    match matched {
        Some(found) => {
            basari_sifirla(&mut conn, &kapsam).await?;
            drop(conn);
            let row = sqlx::query("SELECT id, role, name, tenant_id FROM users WHERE id = ?")
                .bind(&found.id)
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(user_dto_with_modules(pool, &row).await)
        }
        None => {
            let durum = hata_kaydet(&mut conn, effective_tenant, &kapsam).await?;
            Err(if durum.kilitli {
                kilit_mesaji(&durum)
            } else {
                "Geçersiz PIN".to_string()
            })
        }
    }
}

#[tauri::command]
pub async fn auth_login_credentials(identifier: String, secret: String, pool: tauri::State<'_, DbPool>) -> Result<UserDto, String> {
    authenticate_by_identifier(&pool, &identifier, &secret).await
}

#[tauri::command]
pub async fn auth_login(
    pin: String,
    tenant_id: Option<String>,
    #[allow(non_snake_case)]
    tenantId: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<UserDto, String> {
    let effective_tenant = tenant_id.or(tenantId);
    authenticate_by_pin(&pool, &pin, effective_tenant.as_deref()).await
}

#[tauri::command]
pub async fn change_self_pin(
    user_id: String,
    current_pin: Option<String>,
    new_pin: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    // PIN 4 ila 8 haneli sayısal olmalıdır
    if !new_pin.chars().all(|c| c.is_ascii_digit()) || !(4..=8).contains(&new_pin.len()) {
        return Err("Yeni PIN 4-8 haneli sayısal olmalıdır.".into());
    }

    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Mevcut PIN **zorunludur**. Önceden `current_pin: None` geldiğinde
    // doğrulama hiç çalışmıyordu: `user_id` bilen bir çağıran (arayüz alanı
    // boş bırakıldığında `undefined` gönderir) mevcut PIN'i bilmeden yeni PIN
    // yazabiliyordu. Parametre tipi `Option` kaldı çünkü IPC sözleşmesi
    // değişirse arayüz kırılır; tipin `String` olması Faz 17'de arayüzle
    // birlikte yapılacak (bkz. docs/FAZ-15-PLAN.md).
    let cur_pin = mevcut_pin_zorunlu(current_pin.as_deref())?;
    if !crate::user_credentials::verify_user_pin(&mut conn, &user_id, &cur_pin).await? {
        return Err("Mevcut PIN hatalı.".to_string());
    }

    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    // Yeni PIN'i hash'le ve yalnızca hash'ini yaz: düz metin hiçbir yere gitmez.
    let hash = crate::user_credentials::hash_pin(&new_pin)?;

    // PIN benzersizliği kontrolü ve yazma aynı transaction içinde.
    let tenant_id: String = sqlx::query_scalar("SELECT tenant_id FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Yeniden kullanım engeli: son 5 PIN reddedilir. Kontrol **yazmadan önce**
    // ve aynı transaction içinde yapılır; aksi halde kullanıcı eski PIN'ini
    // geri yazıp geçmişten silebilirdi.
    if crate::services::security360::policy::pin_geride_kalmis_mi(&mut *tx, &tenant_id, &user_id, &new_pin)
        .await?
    {
        return Err("VALIDATION: Bu PIN son kullanımlarınız arasında. Farklı bir PIN seçin.".into());
    }

    crate::user_credentials::ensure_pin_available(&mut *tx, &tenant_id, &new_pin, Some(&user_id)).await?;

    sqlx::query("UPDATE users SET pin_hash = ? WHERE id = ?")
        .bind(&hash)
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    crate::user_credentials::ensure_pin_unique_after_write(&mut *tx, &tenant_id, &new_pin, &user_id).await?;

    // Yalnızca hash yazılır; geçmiş tablosu bir kimlik dökümü olmamalı.
    crate::services::security360::policy::pin_gecmise_ekle(&mut *tx, &tenant_id, &user_id, &hash)
        .await?;

    // Kimlik bilgisi değişikliği "Güvenlik" kategorisine yazılır. Deftere PIN'in
    // kendisi ya da hash'i girmez; yalnızca değişikliğin gerçekleştiği yazılır.
    let user_role: String =
        sqlx::query_scalar("SELECT role FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or_else(|_| "System".to_string());

    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        user_id.clone(),
        user_role,
        crate::services::audit_service::category::GUVENLIK,
        "security:pin_changed",
        user_id.clone(),
        serde_json::json!({ "userId": user_id, "method": "self_service" }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "user_id": user_id,
        "new_pin": new_pin,
    }))
}
