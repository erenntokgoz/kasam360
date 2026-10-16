//! Onay deneme sayacı ve kilit yönetimi.
//!
//! Neden ayrı modül: approval_service.rs 500 satır tavanını aştığı için
//! deneme ve kilit mantığı bu alt modüle ayrıldı.

use super::{error, ApprovalRequest, LOCKOUT_SECONDS, MAX_FAILED_ATTEMPTS, TOKEN_TTL_SECONDS};
use sqlx::SqliteConnection;

/// Deneme sayacının kapsam anahtarı.
///
/// Terminal + tenant + yüzey üçlüsüyle ayrılır: bir cihazdaki hatalı deneme
/// başka cihazın sayacını tüketmez, aynı cihazdaki kasa girişi onay sayacını
/// tüketmez.
pub(crate) fn attempt_scope(tenant_id: &str, terminal_id: &str, surface: &str) -> String {
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
pub(crate) fn locked_until_timestamp() -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(LOCKOUT_SECONDS)).to_rfc3339()
}

pub(crate) fn token_expiry_timestamp() -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(TOKEN_TTL_SECONDS)).to_rfc3339()
}

/// Deneme sayacı kilitliyse kalan süreyle hata döner.
pub(crate) async fn ensure_not_locked(
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

pub(crate) async fn record_failure(
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

pub(crate) async fn clear_failures(
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
