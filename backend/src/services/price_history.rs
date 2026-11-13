//! Menü fiyat değişim geçmişi.
//!
//! Neden ayrı tablo: denetim defteri her ürün güncellemesini tek satırda tutar ve
//! fiyatı yük içinde saklar; "bu ürünün fiyatı zaman içinde nasıl değişti" sorusu için
//! her satırın JSON'u açılmak zorunda kalırdı. Kayıt, menü işleminin kendi işleminde
//! yazılır; işlem geri alınırsa kayıt da kalmaz, böylece defterle ayrışmaz.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;

pub const SOURCE_MENU_EDIT: &str = "MENU_EDIT";
pub const SOURCE_BULK_UPDATE: &str = "BULK_UPDATE";

const MAX_ROWS: i64 = 500;

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Fiyat gerçekten değiştiyse bir satır ekler; aynı fiyatı yeniden kaydetmek iz bırakmaz.
#[allow(clippy::too_many_arguments)]
pub async fn record_change(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
    product_name: &str,
    old_price_cents: i64,
    new_price_cents: i64,
    actor_id: &str,
    actor_role: &str,
    source: &str,
) -> Result<(), String> {
    if old_price_cents == new_price_cents {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO product_price_history
             (id, tenant_id, product_id, product_name, old_price_cents, new_price_cents,
              actor_id, actor_role, source, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
    )
    .bind(generate_id("pph"))
    .bind(tenant_id)
    .bind(product_id)
    .bind(product_name)
    .bind(old_price_cents)
    .bind(new_price_cents)
    .bind(actor_id)
    .bind(actor_role)
    .bind(source)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PriceChangeRowDto {
    pub id: String,
    pub product_id: String,
    pub product_name: String,
    pub old_price_cents: i64,
    pub new_price_cents: i64,
    pub actor_id: String,
    pub actor_name: String,
    pub actor_role: String,
    pub source: String,
    pub changed_at: String,
}

/// Dönemdeki fiyat değişimleri, yeniden eskiye. `product_id` verilirse yalnız o ürün.
pub async fn list(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
    product_id: Option<&str>,
) -> Result<Vec<PriceChangeRowDto>, String> {
    let rows = sqlx::query(
        "SELECT h.id, h.product_id, h.product_name, h.old_price_cents, h.new_price_cents,
                h.actor_id, COALESCE(u.name, h.actor_id) AS actor_name, h.actor_role,
                h.source, h.changed_at
           FROM product_price_history h
           LEFT JOIN users u ON u.id = h.actor_id AND u.tenant_id = h.tenant_id
          WHERE h.tenant_id = ?1 AND datetime(h.changed_at) >= datetime(?2)
            AND datetime(h.changed_at) <= datetime(?3)
            AND (?4 IS NULL OR h.product_id = ?4)
          ORDER BY h.changed_at DESC, h.id DESC
          LIMIT ?5",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .bind(product_id)
    .bind(MAX_ROWS)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            Ok(PriceChangeRowDto {
                id: row.try_get("id").map_err(text_error)?,
                product_id: row.try_get("product_id").map_err(text_error)?,
                product_name: row.try_get("product_name").map_err(text_error)?,
                old_price_cents: row.try_get("old_price_cents").map_err(text_error)?,
                new_price_cents: row.try_get("new_price_cents").map_err(text_error)?,
                actor_id: row.try_get("actor_id").map_err(text_error)?,
                actor_name: row.try_get("actor_name").map_err(text_error)?,
                actor_role: row.try_get("actor_role").map_err(text_error)?,
                source: row.try_get("source").map_err(text_error)?,
                changed_at: row.try_get("changed_at").map_err(text_error)?,
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "price_history_tests.rs"]
mod tests;
