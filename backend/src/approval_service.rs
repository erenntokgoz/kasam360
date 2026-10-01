//! Anlık PIN onayı çekirdeği (Faz 3).
//!
//! Kural: void / indirim / ikram işlemleri MASTER hariç **her** işlem sahibi
//! için anlık PIN onayına tabidir. Onay iki adımdan oluşur:
//!
//! 1. `verify_and_issue`: onaylayanın PIN'i tenant içinde Argon2 ile sınanır,
//!    rolü ve işlem tutarına göre denetlenir, ayrım gözetimi uygulanır ve
//!    **tek kullanımlık** bir jeton üretilir. Jetonun kendisi değil, özeti saklanır.
//! 2. `consume_token`: işlemin kendisi çalışmadan hemen önce jeton tüketilir;
//!    kapsam (tenant + işlem + kaynak + tutar) ve süre yeniden denetlenir.
//!
//! Neden ayrı bir servis: onay kuralı tek yerde durmalıdır. Bugün void yolunda
//! bir PIN kontrolü, kuyruk komutunda başka bir kontrol vardı; ikisi de farklı
//! şekilde yanlış davranıyordu. Kural burada toplanır, komutlar yalnızca çağırır.
//!
//! Güvenlik sınırları:
//! - PIN düz metin hiçbir hata mesajına, loga veya audit kaydına girmez.
//! - Deneme sayacı süreç belleğinde değil `approval_attempts` tablosundadır;
//!   uygulama yeniden başlasa da kilit korunur (AGENTS.md §9/13).
//! - Onaylayanın PIN'i yalnız aynı tenant içinde aranır; çapraz tenant onayı
//!   imkânsızdır.

use crate::rbac::{self, Role};
use crate::user_credentials;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};

/// Onaylanabilecek işlem yüzeyleri. Kısa ve kapalı: yeni yüzey eklenirse buraya
/// eklenmek zorunda olsun, böylece kapsam kayması fark edilir.
pub mod operation {
    pub const VOID: &str = "VOID_ORDER";
    pub const DISCOUNT: &str = "DISCOUNT";
    pub const COMPLIMENTARY: &str = "COMPLIMENTARY";
}

/// %20 veya 500 TL üzeri indirimlerde onaylayan yalnız işletme sahibi veya
/// müdür olabilir (K2 kararı). Eşikler kuruş üzerinden karşılaştırılır.
pub const LARGE_DISCOUNT_PERCENT: i64 = 20;
pub const LARGE_DISCOUNT_CENTS: i64 = 50_000;

/// Tek denemede kabul edilen hatalı PIN sayısı; aşılınca terminal kilitlenir.
pub const MAX_FAILED_ATTEMPTS: i64 = 5;

/// Kilit süresi (saniye). Saldırganın kaba kuvvetle denemesi pahalı hale
/// gelir; mevcut giriş kilidiyle (300 sn) aynı süre kullanılır.
pub const LOCKOUT_SECONDS: i64 = 300;

/// Jetonun geçerlilik süresi. Personel onayladıktan sonra fişin gitmesi
/// uzun sürmemelidir.
pub const TOKEN_TTL_SECONDS: i64 = 30;

/// Onay isteğinin kimliği ve kapsamı.
#[derive(Debug, Clone)]
pub struct ApprovalRequest {
    pub tenant_id: String,
    pub operation: String,
    pub resource_id: String,
    /// İşlemi yapan kişi (ayrım gözetimi bu kimliğe göre denetlenir).
    pub actor_id: String,
    /// İşlemi yapan kişinin kanonik rolü; denetim kaydına yazılır.
    pub actor_role: String,
    /// İşlemin tutarı (kuruş). Büyük indirim eşiği bu değere bakar.
    pub amount_cents: i64,
    /// İndirim yüzdesi (yalnız DISCOUNT için). K2 eşiği iki kaynaktan birini
    /// aşmada tetiklenir, bu yüzden oran da kapsama girer.
    pub approved_percent_hint: i64,
    /// Onay PIN'ini deneyen terminal. Sayaç bu kimlikle ayrılır.
    pub terminal_id: String,
}

/// Başarılı PIN doğrulamasının sonucu.
#[derive(Debug, Clone)]
pub struct VerifiedApproval {
    pub approver_id: String,
    pub approver_name: String,
    pub approver_role: Role,
    /// İşlemi uygulamak için kullanılacak tek kullanımlık jeton.
    pub token: String,
}

/// Anlık PIN onayı hataları. Metinler arayüze doğrudan gösterilir ve
/// Türkçedir; PIN'e dair hiçbir bilgi sızdırmaz.
pub mod error {
    pub const INVALID_PIN: &str = "INVALID_APPROVAL_PIN: Onay PIN'i hatalı.";
    pub const NOT_APPROVER: &str =
        "UNAUTHORIZED: Bu rol onay veremez (izin: MASTER, OWNER, MANAGER).";
    pub const SELF_APPROVAL: &str =
        "SELF_APPROVAL_FORBIDDEN: Onaylayan kişi işlemi yapan kişi olamaz.";
    pub const LOCKED: &str = "APPROVAL_LOCKED";
    pub const TOKEN_INVALID: &str = "APPROVAL_TOKEN_INVALID: Onay jetonu geçersiz.";
    pub const TOKEN_USED: &str = "APPROVAL_TOKEN_USED: Onay jetonu zaten kullanılmış.";
    pub const TOKEN_SCOPE: &str =
        "APPROVAL_TOKEN_SCOPE_MISMATCH: Onay jetonu bu işleme ait değil.";
    pub const TOKEN_EXPIRED: &str = "APPROVAL_TOKEN_EXPIRED: Onay jetonunun süresi doldu.";
    /// Jetonsuz işlem denemesi. Bu bir reddedilmedir: işlem yürütülmez.
    pub const TOKEN_REQUIRED: &str =
        "APPROVAL_REQUIRED: Bu işlem için onay PIN'i gerekli.";
    /// Jetonun onaylayanı, tüketim anındaki eşik kuralını karşılamıyor.
    pub const APPROVER_NOT_ALLOWED: &str =
        "UNAUTHORIZED: Bu işlem için onaylayan rol yetkili değil.";

    pub fn locked(remaining_seconds: i64) -> String {
        format!(
            "{}: Çok sayıda hatalı deneme. Terminal {} saniye kilitli.",
            LOCKED, remaining_seconds
        )
    }
}

/// Deneme sayacının kapsam anahtarı.
///
/// Terminal + tenant + yüzey üçlüsüyle ayrılır: bir cihazdaki hatalı deneme
/// başka cihazın sayacını tüketmez, aynı cihazdaki kasa girişi onay sayacını
/// tüketmez.
fn attempt_scope(tenant_id: &str, terminal_id: &str, surface: &str) -> String {
    format!("{}|{}|{}", tenant_id, terminal_id, surface)
}

/// Kapsam anahtarı üretim kuralının testlerde de doğrulanabilmesi için.
#[cfg(test)]
pub fn attempt_scope_for_test(tenant_id: &str, terminal_id: &str, surface: &str) -> String {
    attempt_scope(tenant_id, terminal_id, surface)
}

/// Kilit bitiş zamanı. Sütun `DATETIME` olduğu için değer RFC3339 metni olarak
/// yazılır; SQLite dinamik tipli olduğundan epoch sayı yazılırsa okuma tür
/// uyuşmazlığına düşer.
fn locked_until_timestamp() -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(LOCKOUT_SECONDS)).to_rfc3339()
}

fn token_expiry_timestamp() -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(TOKEN_TTL_SECONDS)).to_rfc3339()
}

/// Deneme sayacı kilitliyse kalan süreyle hata döner.
async fn ensure_not_locked(
    conn: &mut SqliteConnection,
    scope: &str,
    tenant_id: &str,
) -> Result<(), String> {
    let locked_until: Option<String> = sqlx::query_scalar(
        "SELECT locked_until FROM approval_attempts WHERE scope = ? AND tenant_id = ?",
    )
    .bind(scope)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .flatten();

    if let Some(until) = locked_until {
        // Kilit RFC3339 metni olarak yazılır; süresi geçmişse temizlenir.
        let remaining = chrono::DateTime::parse_from_rfc3339(&until)
            .map(|parsed| parsed.timestamp() - chrono::Utc::now().timestamp())
            .unwrap_or(0);
        if remaining > 0 {
            return Err(error::locked(remaining));
        }
        sqlx::query(
            "UPDATE approval_attempts SET locked_until = NULL WHERE scope = ? AND tenant_id = ?",
        )
        .bind(scope)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn record_failure(
    conn: &mut SqliteConnection,
    request: &ApprovalRequest,
) -> Result<(), String> {
    let scope = attempt_scope(&request.tenant_id, &request.terminal_id, &request.operation);
    let failed: i64 = sqlx::query_scalar(
        "INSERT INTO approval_attempts (scope, tenant_id, terminal_id, surface, failed_count, updated_at)
         VALUES (?, ?, ?, ?, 1, datetime('now'))
         ON CONFLICT(scope) DO UPDATE SET failed_count = failed_count + 1, updated_at = datetime('now')
         RETURNING failed_count",
    )
    .bind(&scope)
    .bind(&request.tenant_id)
    .bind(&request.terminal_id)
    .bind(&request.operation)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if failed >= MAX_FAILED_ATTEMPTS {
        sqlx::query(
            "UPDATE approval_attempts SET locked_until = ? WHERE scope = ? AND tenant_id = ?",
        )
        .bind(locked_until_timestamp())
        .bind(&scope)
        .bind(&request.tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        // Kilit açıldığında sayaç sıfırdan başlar.
        sqlx::query(
            "UPDATE approval_attempts SET failed_count = 0 WHERE scope = ? AND tenant_id = ?",
        )
        .bind(&scope)
        .bind(&request.tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn clear_failures(
    conn: &mut SqliteConnection,
    request: &ApprovalRequest,
) -> Result<(), String> {
    let scope = attempt_scope(&request.tenant_id, &request.terminal_id, &request.operation);
    sqlx::query(
        "UPDATE approval_attempts SET failed_count = 0, locked_until = NULL WHERE scope = ? AND tenant_id = ?",
    )
    .bind(scope)
    .bind(&request.tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Kalan deneme hakkını döndürür (arayüzde "3 hak kaldı" göstergesi için).
pub async fn remaining_attempts(
    conn: &mut SqliteConnection,
    request: &ApprovalRequest,
) -> Result<i64, String> {
    let scope = attempt_scope(&request.tenant_id, &request.terminal_id, &request.operation);
    let failed: Option<i64> = sqlx::query_scalar(
        "SELECT failed_count FROM approval_attempts WHERE scope = ? AND tenant_id = ?",
    )
    .bind(scope)
    .bind(&request.tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok((MAX_FAILED_ATTEMPTS - failed.unwrap_or(0)).max(0))
}

/// Jetonun kanonik formu. Kapsam burada sabitlenir: aynı jeton başka bir
/// adisyona, işleme veya tutara taşınamaz.
fn canonical_token_material(
    approval_id: &str,
    request: &ApprovalRequest,
    approver_id: &str,
    expires_at: &str,
) -> String {
    [
        approval_id.to_string(),
        request.tenant_id.trim().to_string(),
        request.operation.trim().to_string(),
        request.resource_id.trim().to_string(),
        request.actor_id.trim().to_string(),
        approver_id.trim().to_string(),
        request.amount_cents.to_string(),
        expires_at.to_string(),
    ]
    .join("|")
}

fn hash_hex(material: &str) -> String {
    let digest = Sha256::digest(material.as_bytes());
    hex::encode(digest)
}

/// Özet üretim kuralı testlerde de kullanılabilsin diye dışa açılır: tüketim
/// yolundaki ikinci denetimi sınamak için gerçek bir `token_hash` yazılması
/// gerekir, elle uydurma hash "geçersiz jeton" hatasına düşer.
#[cfg(test)]
pub fn test_hash_hex(token: &str) -> String {
    hash_hex(token.trim())
}

/// Jetonu üretir: kanonik formun özeti + rastgelelik. Böylece jeton tahmin
/// edilemez; veritabanında yalnız özeti saklandığı için veritabanı okuyan bir
/// saldırgan da jetonu üretemez.
fn mint_token(material: &str) -> String {
    let entropy = uuid::Uuid::new_v4().simple().to_string();
    format!("{}_{}", &hash_hex(material)[..32], entropy)
}

/// Bu istek için onaylayanın işletme sahibi/müdür olması gerekip gerekmediği.
///
/// Kural (K2): her tutarda indirim onay ister; %20 veya 500 TL üzerindeki
/// indirimde onaylayan yalnız OWNER veya MANAGER olabilir. İkram, %100 indirim
/// olduğu için daima bu yüksek eşiğe girer; kasa ikram onaylayamaz.
pub fn requires_privileged_approver(request: &ApprovalRequest) -> bool {
    if request.operation != operation::DISCOUNT && request.operation != operation::COMPLIMENTARY {
        return false;
    }
    if request.operation == operation::COMPLIMENTARY {
        return true;
    }
    request.approved_percent_hint >= LARGE_DISCOUNT_PERCENT
        || request.amount_cents >= LARGE_DISCOUNT_CENTS
}

/// Onay PIN'ini doğrular ve tek kullanımlık jeton üretir.
///
/// Sıra önemlidir ve bilinçlidir:
/// 1. kilit kontrolü, 2. PIN biçimi, 3. tenant içi Argon2 araması,
/// 4. rol kapısı, 5. büyük indirim eşiği, 6. ayrım gözetimi.
/// Böylece hatalı PIN denemesi hiçbir bilgi sızdırmaz (aynı hata mesajı).
pub async fn verify_and_issue(
    conn: &mut SqliteConnection,
    request: &ApprovalRequest,
    pin: &str,
) -> Result<VerifiedApproval, String> {
    let scope = attempt_scope(&request.tenant_id, &request.terminal_id, &request.operation);
    ensure_not_locked(conn, &scope, &request.tenant_id).await?;

    if !user_credentials::is_valid_pin_format(pin) {
        record_failure(conn, request).await?;
        return Err(error::INVALID_PIN.to_string());
    }

    // Tenant zorunlu: çapraz tenant PIN'iyle onay verilemez.
    let matched =
        user_credentials::find_user_by_pin(conn, pin, Some(&request.tenant_id)).await?;
    let Some(found) = matched else {
        record_failure(conn, request).await?;
        return Err(error::INVALID_PIN.to_string());
    };

    let approver_role =
        rbac::canonical_role(&found.role).ok_or_else(|| error::NOT_APPROVER.to_string())?;

    // Rol kapısı işleme göre daralır: büyük indirimde MASTER da onaylayamaz.
    let allowed: Vec<Role> = if requires_privileged_approver(request) {
        vec![Role::Owner, Role::Manager]
    } else {
        rbac::APPROVER_ROLES.to_vec()
    };
    if !allowed.contains(&approver_role) {
        record_failure(conn, request).await?;
        return Err(error::NOT_APPROVER.to_string());
    }

    rbac::require_distinct_approver(&found.id, &request.actor_id)?;

    clear_failures(conn, request).await?;

    let approval_id = crate::id_generator::generate_id("apr");
    let expires_at = token_expiry_timestamp();
    let material = canonical_token_material(&approval_id, request, &found.id, &expires_at);
    let token = mint_token(&material);
    // Veritabanında jetonun kendisi değil, jetonun SHA-256 özeti saklanır.
    let token_hash = hash_hex(&token);

    sqlx::query(
        "INSERT INTO approvals
            (id, tenant_id, request_type, resource_id, requester_id, status, approver_id,
             approved_by_role, amount_cents, token_hash, expires_at, payload, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    )
    .bind(&approval_id)
    .bind(&request.tenant_id)
    .bind(&request.operation)
    .bind(&request.resource_id)
    .bind(&request.actor_id)
    .bind(&found.id)
    .bind(approver_role.as_str())
    .bind(request.amount_cents)
    .bind(&token_hash)
    .bind(&expires_at)
    .bind(format!(
        "{{\"approverName\":\"{}\"}}",
        found.name.replace('"', "")
    ))
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(VerifiedApproval {
        approver_id: found.id,
        approver_name: found.name,
        approver_role,
        token,
    })
}

/// Jetonu tüketir: geçerlilik, süre, kapsam ve tek kullanımlılığı denetler.
pub async fn consume_token(
    conn: &mut SqliteConnection,
    token: &str,
    request: &ApprovalRequest,
) -> Result<VerifiedApproval, String> {
    if token.trim().is_empty() {
        return Err(error::TOKEN_INVALID.to_string());
    }

    let row = sqlx::query(
        "SELECT id, tenant_id, request_type, resource_id, requester_id, approver_id,
                approved_by_role, amount_cents, expires_at, consumed_at
         FROM approvals WHERE token_hash = ? AND tenant_id = ?",
    )
    .bind(hash_hex(token.trim()))
    .bind(&request.tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let Some(row) = row else {
        return Err(error::TOKEN_INVALID.to_string());
    };

    let consumed_at: Option<String> = row.try_get("consumed_at").map_err(|e| e.to_string())?;
    if consumed_at.is_some() {
        return Err(error::TOKEN_USED.to_string());
    }

    let stored_tenant: String = row.try_get("tenant_id").map_err(|e| e.to_string())?;
    let stored_operation: String = row.try_get("request_type").map_err(|e| e.to_string())?;
    let stored_resource: String = row.try_get("resource_id").map_err(|e| e.to_string())?;
    let stored_amount: i64 = row.try_get("amount_cents").map_err(|e| e.to_string())?;
    let stored_requester: String = row.try_get("requester_id").map_err(|e| e.to_string())?;
    let approver_id: String = row.try_get("approver_id").map_err(|e| e.to_string())?;
    let approver_role_raw: String = row
        .try_get("approved_by_role")
        .map_err(|e| e.to_string())?;
    let expires_at: Option<String> = row.try_get("expires_at").map_err(|e| e.to_string())?;

    // Kapsam denetimi: jeton başka bir işleme taşınamaz. `requester_id` de
    // kapsama dâhildir; jeton işlemi yapan kişinin kendisine verilmiştir,
    // başkası onunla işlem yürütemez.
    if stored_tenant != request.tenant_id
        || stored_operation != request.operation
        || stored_resource != request.resource_id
        || stored_amount != request.amount_cents
        || stored_requester != request.actor_id
    {
        return Err(error::TOKEN_SCOPE.to_string());
    }

    if let Some(until) = expires_at {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&until) {
            if parsed.timestamp() < chrono::Utc::now().timestamp() {
                return Err(error::TOKEN_EXPIRED.to_string());
            }
        }
    }

    let approver_role = rbac::canonical_role(&approver_role_raw).ok_or_else(|| {
        // Bilinmeyen rol "ayırt edici değil" kuralıyla reddedilir; onaylayan
        // rolü tahmin edilmez.
        error::APPROVER_NOT_ALLOWED.to_string()
    })?;

    // Ayrım gözetimi jetonun kendi satırından yeniden denetlenir. Jetonu üreten
    // yol denetliyordu; burada tekrar denetlemek, elle yazılmış bir satırın veya
    // eski bir kaydın kapıyı atlamasını engeller.
    rbac::require_distinct_approver(&approver_id, &request.actor_id)?;

    // Eşik kuralı tüketim anında da yeniden denetlenir: jeton üretilirken küçük
    // bir indirim için MASTER onayı verilmişse, işlem yürütme anındaki gerçek
    // tutar büyük eşiğe girdiyse jeton kabul edilmez.
    let allowed: Vec<Role> = if requires_privileged_approver(request) {
        vec![Role::Owner, Role::Manager]
    } else {
        rbac::APPROVER_ROLES.to_vec()
    };
    if !allowed.contains(&approver_role) {
        return Err(error::APPROVER_NOT_ALLOWED.to_string());
    }

    // Tüketim tek seferlik: koşullu UPDATE yalnız tüketilmemiş satırı işaretler.
    let updated = sqlx::query(
        "UPDATE approvals SET consumed_at = datetime('now')
         WHERE id = ? AND tenant_id = ? AND consumed_at IS NULL",
    )
    .bind(row.try_get::<String, _>("id").map_err(|e| e.to_string())?)
    .bind(&request.tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if updated.rows_affected() == 0 {
        return Err(error::TOKEN_USED.to_string());
    }

    Ok(VerifiedApproval {
        approver_id,
        approver_name: String::new(),
        approver_role,
        token: String::new(),
    })
}

#[cfg(test)]
#[path = "approval_service_tests.rs"]
mod tests;