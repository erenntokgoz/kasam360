//! Mutfakta hazır olup masaya götürülmemiş kalemlerin teslim listesi.
//!
//! Neden ayrı servis: hazır kalemi masaya götüren garsonun mutfak biletini ilerletme yetkisi
//! yoktur. Teslim yalnız `Ready` -> `Served` geçişidir; hazırlık durumları mutfağın kalır.
//! Stok sipariş anında bir kez düşer, teslim stoğa dokunmaz.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

/// Tek istekte işaretlenebilecek kalem sayısı; sınırsız liste yazma kilidini uzatmasın diye.
const MAX_SERVE_BATCH: usize = 100;

/// Masaya götürülmeyi bekleyen hazır kalem.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeliveryDto {
    pub item_id: String,
    pub order_id: String,
    pub table_name: String,
    pub product_name: String,
    pub quantity: i64,
    /// Kalemin hazır olduğu andan bu yana geçen saniye.
    pub ready_seconds: i64,
}

/// Açık adisyonlardaki hazır kalemler; en uzun bekleyen başta.
///
/// `now` UTC `YYYY-AA-GG SS:DD:ss` biçimindedir (`events.created_at` ile aynı). Hazır olma anı
/// kalem olayından gelir; olay yoksa siparişin son güncellemesine düşülür.
pub async fn list_pending(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    now: &str,
) -> Result<Vec<PendingDeliveryDto>, String> {
    let rows = sqlx::query(
        "SELECT oi.id AS item_id, oi.order_id AS order_id,
                COALESCE(t.name, 'Masa') AS table_name,
                COALESCE(p.name, 'Ürün') AS product_name,
                oi.quantity AS quantity,
                MAX(0, CAST(strftime('%s', ?) AS INTEGER) - CAST(strftime('%s', COALESCE(
                    (SELECT MAX(e.created_at) FROM events e
                      WHERE e.tenant_id = oi.tenant_id AND e.aggregate_id = oi.id
                        AND e.event_type = 'ITEM_READY'),
                    o.updated_at)) AS INTEGER)) AS ready_seconds
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
         LEFT JOIN tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id
         LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id
         WHERE oi.tenant_id = ? AND o.status IN ('OPEN', 'IN_PROGRESS')
           AND UPPER(oi.status) = 'READY'
         ORDER BY ready_seconds DESC, oi.id ASC",
    )
    .bind(now)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Okunamayan satır listeden sessizce düşmez: eksik liste "teslim bekleyen yok" demek olurdu.
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(PendingDeliveryDto {
            item_id: row.try_get("item_id").map_err(|e| e.to_string())?,
            order_id: row.try_get("order_id").map_err(|e| e.to_string())?,
            table_name: row.try_get("table_name").map_err(|e| e.to_string())?,
            product_name: row.try_get("product_name").map_err(|e| e.to_string())?,
            quantity: row.try_get("quantity").map_err(|e| e.to_string())?,
            ready_seconds: row.try_get("ready_seconds").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

/// Hazır kalemleri teslim edildi yapar; döndürülen sayı işaretlenen kalem adedidir.
///
/// Tüm kalemler bu kiracının, açık adisyonda ve `Ready` durumunda olmalıdır; biri uymuyorsa
/// çağıranın işlem dilimi geri alınsın diye hata döner (iki garsonun aynı kalemi almasını yakalar).
pub async fn mark_served(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    item_ids: &[String],
) -> Result<i64, String> {
    if item_ids.is_empty() {
        return Err("VALIDATION: teslim edilecek kalem seçilmedi".to_string());
    }
    if item_ids.len() > MAX_SERVE_BATCH {
        return Err(format!(
            "VALIDATION: tek seferde en çok {MAX_SERVE_BATCH} kalem teslim edilir"
        ));
    }
    let mut served: i64 = 0;
    for item_id in item_ids {
        let result = sqlx::query(
            "UPDATE order_items SET status = 'Served'
             WHERE id = ? AND tenant_id = ? AND UPPER(status) = 'READY'
               AND order_id IN (SELECT id FROM orders
                                WHERE tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS'))",
        )
        .bind(item_id.trim())
        .bind(tenant_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        if result.rows_affected() != 1 {
            return Err(
                "CONFLICT: kalem teslime hazır değil; başka bir cihaz teslim etmiş olabilir"
                    .to_string(),
            );
        }
        served += 1;
    }
    Ok(served)
}

/// Mutfak kalemi hazır işaretleyince hazır olma anı olay olarak yazılır (teslim bekleme süresi).
pub async fn record_item_ready(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    item_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at)
         VALUES (?, ?, ?, 'KDS_ITEM', 'ITEM_READY', '{}', datetime('now'))",
    )
    .bind(crate::id_generator::generate_id("evt_item"))
    .bind(tenant_id)
    .bind(item_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
#[path = "serve_service_tests.rs"]
mod tests;
