//! Patronun personele verdiği onay yetkisi.
//!
//! Neden rolden ayrı: işletmede kıdemli kasiyer veya vardiya sorumlusu müdür rolü
//! almadan iptal, ikram ve iade onaylayabilmelidir. Rol değiştirmek maaş ve rapor
//! görünürlüğünü de açardı; bu izin yalnız onay kapısını açar.

use sqlx::{SqliteConnection, SqlitePool};

/// Eski veritabanına kolonu ekler. Şema dosyası var olan tabloyu değiştirmez.
pub async fn ensure_column(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let present: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'can_approve'",
    )
    .fetch_one(pool)
    .await?;
    if present == 0 {
        sqlx::query("ALTER TABLE users ADD COLUMN can_approve INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Yetki her onayda satırdan okunur: geri alınan izin bekleyen jetonu da durdurur.
pub async fn is_granted(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
) -> Result<bool, String> {
    let granted: Option<i64> = sqlx::query_scalar(
        "SELECT can_approve FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1",
    )
    .bind(user_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(granted == Some(1))
}

/// Patron ve platform hesabına yazılmaz: patron zaten yetkilidir.
pub async fn set_grant(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    staff_id: &str,
    can_approve: bool,
) -> Result<(), String> {
    let updated = sqlx::query(
        "UPDATE users SET can_approve = ?
         WHERE id = ? AND tenant_id = ? AND is_active = 1
           AND role IN ('MANAGER', 'CASHIER', 'WAITER', 'KITCHEN')",
    )
    .bind(i64::from(can_approve))
    .bind(staff_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if updated.rows_affected() != 1 {
        return Err("NOT_FOUND: bu işletmede yetki verilebilecek personel bulunamadı.".to_string());
    }
    Ok(())
}
