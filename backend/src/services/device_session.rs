//! Cihazın işletme hesabı oturumu ve personel oturumu ayarları.
//!
//! Neden iki katman: e-posta ve şifre cihazı işletmeye açar, personel bu cihazda
//! PIN ile çalışır. PIN bilen biri tek başına kapatılmış bir cihazı açamaz; hesap
//! şifresi de vardiya boyunca kasada yazılmaz.
//!
//! Bu tablo cihaza özeldir: bir cihazdan çıkış diğerlerini kapatmaz. Hesap şimdilik
//! yerelde doğrulanır, böylece internetsiz çalışma kuralı bozulmaz; web hesabı
//! geldiğinde doğrulama değişir, oturum katmanı değişmez.

use serde::Serialize;
use sqlx::{Row, SqliteConnection, SqlitePool};

const PASSWORD_MIN_CHARS: usize = 8;
const EMAIL_MAX_CHARS: usize = 254;
pub const DEFAULT_STAFF_IDLE_SECONDS: i64 = 120;
/// `0` kalıcı personel oturumudur: hareketsizlikte kilitlenmez.
const STAFF_IDLE_CHOICES: [i64; 4] = [0, DEFAULT_STAFF_IDLE_SECONDS, 300, 900];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSession {
    pub signed_in: bool,
    pub email: Option<String>,
    /// Eski işletmede sahibin henüz e-posta ve şifresi yoktur.
    pub account_missing: bool,
    pub keep_signed_in: bool,
    pub staff_idle_seconds: i64,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Girişte karşılaştırılan tek biçim: büyük harf aynı hesabı ikiye bölmesin.
pub fn normalize_email(email: &str) -> Result<String, String> {
    let email = email.trim().to_lowercase();
    let valid = email.chars().count() <= EMAIL_MAX_CHARS
        && !email.chars().any(char::is_whitespace)
        && email.split_once('@').is_some_and(|(name, host)| {
            !name.is_empty() && host.contains('.') && !host.contains('@')
        });
    if !valid {
        return Err("VALIDATION: geçerli bir e-posta adresi girin.".to_string());
    }
    Ok(email)
}

pub fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < PASSWORD_MIN_CHARS {
        return Err(format!(
            "VALIDATION: şifre en az {PASSWORD_MIN_CHARS} karakter olmalıdır."
        ));
    }
    Ok(())
}

pub async fn load(conn: &mut SqliteConnection) -> Result<DeviceSession, String> {
    let row = sqlx::query(
        "SELECT s.user_id, s.keep_signed_in, s.staff_idle_seconds, u.email
         FROM (SELECT 1) AS anchor
         LEFT JOIN device_session s ON s.slot = 1
         LEFT JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id AND u.is_active = 1",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let email: Option<String> = row.try_get("email").map_err(text_error)?;
    let user_id: Option<String> = row.try_get("user_id").map_err(text_error)?;
    let keep: Option<i64> = row.try_get("keep_signed_in").map_err(text_error)?;
    let idle: Option<i64> = row.try_get("staff_idle_seconds").map_err(text_error)?;
    let owners_with_account: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users
         WHERE role = 'OWNER' AND is_active = 1 AND credential_hash IS NOT NULL",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(DeviceSession {
        // Hesabı silinen veya pasifleştirilen kullanıcının oturumu geçersizdir.
        signed_in: user_id.is_some() && email.is_some(),
        email,
        account_missing: owners_with_account == 0,
        keep_signed_in: keep.unwrap_or(1) == 1,
        staff_idle_seconds: idle.unwrap_or(DEFAULT_STAFF_IDLE_SECONDS),
    })
}

/// Personel girişi kapısı. Okunamayan durum "açık" sayılmaz.
pub async fn require_signed_in(pool: &SqlitePool) -> Result<(), String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    if load(&mut conn).await?.signed_in {
        return Ok(());
    }
    Err("ACCOUNT_REQUIRED: bu cihazda işletme hesabıyla giriş yapılmalı".to_string())
}

pub async fn sign_in(
    conn: &mut SqliteConnection,
    user_id: &str,
    tenant_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO device_session (slot, user_id, tenant_id, signed_in_at)
         VALUES (1, ?1, ?2, datetime('now'))
         ON CONFLICT(slot) DO UPDATE SET user_id = ?1, tenant_id = ?2,
                                         signed_in_at = datetime('now')",
    )
    .bind(user_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

pub async fn sign_out(conn: &mut SqliteConnection) -> Result<(), String> {
    sqlx::query("UPDATE device_session SET user_id = NULL, tenant_id = NULL WHERE slot = 1")
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(())
}

pub async fn set_policy(
    conn: &mut SqliteConnection,
    keep_signed_in: bool,
    staff_idle_seconds: i64,
) -> Result<(), String> {
    if !STAFF_IDLE_CHOICES.contains(&staff_idle_seconds) {
        return Err("VALIDATION: geçersiz personel kilit süresi".to_string());
    }
    sqlx::query(
        "INSERT INTO device_session (slot, keep_signed_in, staff_idle_seconds)
         VALUES (1, ?1, ?2)
         ON CONFLICT(slot) DO UPDATE SET keep_signed_in = ?1, staff_idle_seconds = ?2",
    )
    .bind(i64::from(keep_signed_in))
    .bind(staff_idle_seconds)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

/// Açılışta çağrılır: kalıcı olmayan hesap oturumu uygulama kapanınca biter.
pub async fn end_temporary_session(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE device_session SET user_id = NULL, tenant_id = NULL
         WHERE slot = 1 AND keep_signed_in = 0",
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
#[path = "device_session_tests.rs"]
mod tests;
