//! İlk kurulum durumu: işletmenin hiç kurulmadığı cihazı tanır ve açar.
//!
//! Neden ayrı durum satırı: kullanıcı sayısına bakmak kurulumun neden tamamlandığını
//! söylemez ve mevcut işletmeyi yanlışlıkla sihirbaza düşürebilir. Karar veritabanının
//! ilk yükseltilmesinde bir kez verilir ve kalıcıdır.
//!
//! Taslakta PIN veya eşleştirme kodu yoktur: yarım kalan kurulum diskte sır bırakmaz.

use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::device_identity::ensure_local_device;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection, SqlitePool};

/// Cihaz henüz bir işletmeye bağlanmadan kimliğinin geçici kiracısı.
/// Katılımda bütün satırlar kümenin kiracısına taşınır.
pub const PROVISIONAL_TENANT: &str = "tnt_unjoined";

/// AGENTS.md §6'da varsayılan olarak açık özellik bayrakları.
const DEFAULT_MODULES: [&str; 6] = [
    "feat_kds",
    "feat_qr_menu",
    "feat_table_order",
    "feat_recipe_bom",
    "feat_ledger_cari",
    "feat_loss_radar",
];

const NAME_MAX_CHARS: usize = 120;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SetupDraft {
    pub business_name: String,
    pub tax_id: String,
    pub phone: String,
    pub address: String,
    pub owner_name: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupState {
    /// `PENDING`: kurulum gerekli, `COMPLETE`: normal giriş açık.
    pub status: String,
    /// Yarım kalan seçim: `NEW` veya `JOIN`.
    pub mode: Option<String>,
    pub draft: SetupDraft,
}

/// Sır taşıdığı için `Debug` türetilmez; günlüğe yanlışlıkla PIN düşmesin.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBusinessInput {
    pub business_name: String,
    #[serde(default)]
    pub tax_id: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub address: String,
    pub owner_name: String,
    pub pin: String,
    pub pin_confirm: String,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

fn clean_name(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    let length = value.chars().count();
    if !(2..=NAME_MAX_CHARS).contains(&length) {
        return Err(format!(
            "VALIDATION: {label} 2-{NAME_MAX_CHARS} karakter olmalıdır."
        ));
    }
    Ok(value.to_string())
}

fn optional(value: &str) -> Option<String> {
    Some(value.trim().to_string()).filter(|text| !text.is_empty())
}

/// PIN biçimini ve tek haneli tekrarları denetler.
///
/// Neden tekrar reddi: eski fabrika PIN'leri `1111`-`6666` biçimindeydi; kurulumda
/// seçilirse fabrika PIN'iyle giriş kapısı kullanıcı eliyle geri açılmış olurdu.
pub fn validate_owner_pin(pin: &str, confirm: &str) -> Result<(), String> {
    if pin != confirm {
        return Err("VALIDATION: PIN ve tekrarı aynı değil.".to_string());
    }
    if !crate::user_credentials::is_valid_pin_format(pin) {
        return Err("VALIDATION: PIN 4-8 haneli sayısal olmalıdır.".to_string());
    }
    let mut digits = pin.chars();
    let first = digits.next();
    if digits.all(|digit| Some(digit) == first) {
        return Err("VALIDATION: PIN aynı rakamın tekrarı olamaz.".to_string());
    }
    Ok(())
}

/// Eski sürüm temiz veritabanına bu hesapları kendiliğinden açardı.
pub(crate) const FACTORY_PINS: [(&str, &str); 6] = [
    ("usr_master", "1111"),
    ("usr_owner", "2222"),
    ("usr_manager", "3333"),
    ("usr_cashier", "4444"),
    ("usr_waiter", "5555"),
    ("usr_cook", "6666"),
];

/// Hiç kullanılmamış eski kurulum mu?
///
/// Eski sürümü bir kez açmak fabrika hesaplarını yazardı; bu kurulum kullanıcılı
/// görünür ama ortada işletme yoktur. PIN değiştirilmeden çalışılamadığı için
/// bütün hesapların fabrika PIN'inde durması ve iş kaydı olmaması birlikte
/// aranır. Tek bir değişmiş PIN veya kayıt varsa işletme korunur.
async fn is_unused_factory_install(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    for table in [
        "orders",
        "products",
        "directories",
        "shifts",
        "sync_cluster",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await?;
        if count > 0 {
            return Ok(false);
        }
    }
    // Çok eski şemada `pin_hash` yoktur; PIN taşınmadan karar verilmez.
    let Ok(users) = sqlx::query_as::<_, (String, Option<String>)>("SELECT id, pin_hash FROM users")
        .fetch_all(pool)
        .await
    else {
        return Ok(false);
    };
    Ok(!users.is_empty()
        && users.iter().all(|(id, hash)| {
            let factory = FACTORY_PINS.iter().find(|(factory_id, _)| factory_id == id);
            match (factory, hash) {
                (Some((_, pin)), Some(hash)) => {
                    crate::user_credentials::is_argon2_hash(hash)
                        && crate::auth::verify_credential(pin, hash)
                }
                _ => false,
            }
        }))
}

/// Fabrika hesaplarını kaldırır ve cihazı kuruluma döndürür.
async fn reset_unused_install(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for (id, _) in FACTORY_PINS {
        sqlx::query("DELETE FROM users WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("DELETE FROM login_attempts")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO app_setup (slot, status) VALUES (1, 'PENDING')
         ON CONFLICT(slot) DO UPDATE SET status = 'PENDING', origin = NULL, tenant_id = NULL,
                                         completed_at = NULL, updated_at = datetime('now')",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// Kurulum durumunu çözer. Kullanıcısı olan veritabanı mevcut işletmedir.
///
/// `UPGRADE` satırı yeniden değerlendirilir: önceki sürüm kullanılmamış kurulumu
/// da mevcut işletme saymış olabilir. Kurulumu tamamlanmış satıra dokunulmaz.
/// Kullanıcısız eski kurulum sihirbaza gider ve tamamlanırken var olan kiracıyı
/// devralır; ikinci işletme açılmaz.
pub async fn classify_install(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let known: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT status, origin FROM app_setup WHERE slot = 1")
            .fetch_optional(pool)
            .await?;
    if known
        .as_ref()
        .is_some_and(|(_, origin)| origin.as_deref() != Some("UPGRADE"))
    {
        return Ok(());
    }
    if is_unused_factory_install(pool).await? {
        return reset_unused_install(pool).await;
    }
    if known.is_some() {
        return Ok(());
    }
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    if users == 0 {
        sqlx::query("INSERT INTO app_setup (slot, status) VALUES (1, 'PENDING')")
            .execute(pool)
            .await?;
        return Ok(());
    }
    let tenant: Option<String> = sqlx::query_scalar(
        "SELECT id FROM tenants ORDER BY name = 'Kasam360 Merkez İşletme' DESC, created_at, id
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    sqlx::query(
        "INSERT INTO app_setup (slot, status, origin, tenant_id, completed_at)
         VALUES (1, 'COMPLETE', 'UPGRADE', ?, datetime('now'))",
    )
    .bind(tenant)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_state(conn: &mut SqliteConnection) -> Result<SetupState, String> {
    let row = sqlx::query("SELECT status, mode, draft FROM app_setup WHERE slot = 1")
        .fetch_optional(&mut *conn)
        .await
        .map_err(text_error)?
        .ok_or_else(|| "INTERNAL: kurulum durumu bulunamadı".to_string())?;
    let draft: Option<String> = row.try_get("draft").map_err(text_error)?;
    Ok(SetupState {
        status: row.try_get("status").map_err(text_error)?,
        mode: row.try_get("mode").map_err(text_error)?,
        draft: draft
            .map(|text| serde_json::from_str(&text))
            .transpose()
            .map_err(|e| e.to_string())?
            .unwrap_or_default(),
    })
}

/// Giriş ve satış kapısı. Okunamayan durum "kurulmuş" sayılmaz.
pub async fn require_complete(pool: &SqlitePool) -> Result<(), String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    if load_state(&mut conn).await?.status == "COMPLETE" {
        return Ok(());
    }
    Err("SETUP_REQUIRED: işletme kurulumu tamamlanmadı".to_string())
}

/// Seçimi ve taslağı saklar; uygulama kapanırsa aynı adımdan sürer.
pub async fn save_draft(
    conn: &mut SqliteConnection,
    mode: Option<&str>,
    draft: &SetupDraft,
) -> Result<(), String> {
    if !matches!(mode, None | Some("NEW") | Some("JOIN")) {
        return Err("VALIDATION: geçersiz kurulum yolu".to_string());
    }
    let text = serde_json::to_string(draft).map_err(|e| e.to_string())?;
    let saved = sqlx::query(
        "UPDATE app_setup SET mode = ?, draft = ?, updated_at = datetime('now')
         WHERE slot = 1 AND status = 'PENDING'",
    )
    .bind(mode)
    .bind(text)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    if saved.rows_affected() != 1 {
        return Err("CONFLICT: kurulum zaten tamamlandı".to_string());
    }
    Ok(())
}

/// Katılım anlık görüntüsüyle aynı transaction'da kurulumu kapatır.
pub async fn mark_joined(conn: &mut SqliteConnection, tenant_id: &str) -> Result<(), String> {
    sqlx::query(
        "UPDATE app_setup SET status = 'COMPLETE', origin = 'JOIN', tenant_id = ?, draft = NULL,
                completed_at = datetime('now'), updated_at = datetime('now')
         WHERE slot = 1 AND status = 'PENDING'",
    )
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

async fn upsert_tenant(
    conn: &mut SqliteConnection,
    input: &NewBusinessInput,
    business_name: &str,
    owner_name: &str,
) -> Result<String, String> {
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM tenants ORDER BY created_at, id LIMIT 1")
            .fetch_optional(&mut *conn)
            .await
            .map_err(text_error)?;
    let tenant_id = existing
        .clone()
        .unwrap_or_else(|| crate::id_generator::generate_id("tnt"));
    let statement = if existing.is_some() {
        "UPDATE tenants SET name = ?, contact_person = ?, phone = ?, tax_id = ?, address = ?
         WHERE id = ?"
    } else {
        "INSERT INTO tenants (name, contact_person, phone, tax_id, address, id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')"
    };
    sqlx::query(statement)
        .bind(business_name)
        .bind(owner_name)
        .bind(optional(&input.phone))
        .bind(optional(&input.tax_id))
        .bind(optional(&input.address))
        .bind(&tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(tenant_id)
}

/// İşletmeyi, OWNER hesabını ve çalışma için gereken kayıtları tek transaction'da açar.
///
/// `pin_hash` çağırandan gelir: Argon2 bilinçli olarak yavaştır ve yazma kilidi
/// tutulurken hesaplanmamalıdır. Yarıda kesilirse hiçbir kayıt kalmaz, taslak durur.
pub async fn complete_new_business(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    input: &NewBusinessInput,
    pin_hash: &str,
) -> Result<String, String> {
    let business_name = clean_name(&input.business_name, "İşletme adı")?;
    let owner_name = clean_name(&input.owner_name, "Yetkili adı")?;

    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&mut *conn)
        .await
        .map_err(text_error)?;
    if users > 0 {
        return Err("CONFLICT: bu cihazda kayıtlı işletme var".to_string());
    }
    let tenant_id = upsert_tenant(conn, input, &business_name, &owner_name).await?;
    let claimed = sqlx::query(
        "UPDATE app_setup SET status = 'COMPLETE', origin = 'NEW', mode = 'NEW', tenant_id = ?,
                draft = NULL, completed_at = datetime('now'), updated_at = datetime('now')
         WHERE slot = 1 AND status = 'PENDING'",
    )
    .bind(&tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    if claimed.rows_affected() != 1 {
        return Err("CONFLICT: kurulum zaten tamamlandı".to_string());
    }

    let owner_id = crate::id_generator::generate_id("usr");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active, must_change_pin)
         VALUES (?, ?, 'OWNER', ?, ?, 1, 0)",
    )
    .bind(&owner_id)
    .bind(&tenant_id)
    .bind(&owner_name)
    .bind(pin_hash)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    crate::services::security360::policy::pin_gecmise_ekle(
        &mut *conn, &tenant_id, &owner_id, pin_hash,
    )
    .await?;

    for module_id in DEFAULT_MODULES {
        sqlx::query(
            "INSERT OR IGNORE INTO tenant_modules (tenant_id, module_id, is_active)
             VALUES (?, ?, 1)",
        )
        .bind(&tenant_id)
        .bind(module_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    }
    let categories: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE tenant_id = ?")
        .bind(&tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(text_error)?;
    if categories == 0 {
        sqlx::query(
            "INSERT INTO categories (id, tenant_id, name, display_order, default_station)
             VALUES (?, ?, 'Genel', 0, 'MUTFAK')",
        )
        .bind(crate::id_generator::generate_id("cat"))
        .bind(&tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    }
    ensure_local_device(&mut *conn, &tenant_id).await?;

    let ctx = AuditContext::new(
        tenant_id.clone(),
        owner_id.clone(),
        "OWNER".to_string(),
        category::GUVENLIK,
        "setup:business_created",
        tenant_id.clone(),
        serde_json::json!({ "ownerId": owner_id }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, audit_lock, &ctx).await?;
    Ok(tenant_id)
}

#[cfg(test)]
#[path = "setup_tests.rs"]
mod tests;
