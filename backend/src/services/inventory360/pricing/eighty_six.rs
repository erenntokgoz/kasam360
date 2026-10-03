use sqlx::SqliteConnection;

use crate::management_commands::ensure_owned;

// ---------------------------------------------------------------------------
// 86'D
// ---------------------------------------------------------------------------

/// Ürünü 86'ya alır veya stoğa geri getirir.
///
/// `is_active` bilinçli olarak değiştirilmez: 86 geçicidir, `is_active` kalıcıdır.
/// Karıştırılırsa ürün stok geldiğinde kalıcı olarak menüden kaybolur.
pub async fn set_product_86d(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    product_id: &str,
    is_86d: bool,
    reason: Option<String>,
) -> Result<bool, String> {
    ensure_owned(conn, "products", product_id, tenant_id).await?;

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE products
            SET is_86 = ?, stockout_reason = ?, stockout_at = ?, stockout_by = ?
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(is_86d)
    .bind(if is_86d { reason.as_deref() } else { None })
    .bind(if is_86d { Some(now.as_str()) } else { None })
    .bind(if is_86d { Some(actor_id) } else { None })
    .bind(product_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(is_86d)
}
