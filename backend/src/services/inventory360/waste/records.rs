//! Fire (zayi) kaydı ve kör sayım (Spec §2.12).
//!
//! Neden ayrı tablo: `stock_movements` stok hareketini kaydeder ama firein
//! **gerekçesini** tutmaz. Bozulan malzeme ile sayım hatası aynı muhasebe
//! satırına girerse, zararın kaynağı görülemez ve önlem alınamaz.
//!
//! Kör sayım kuralı: sayım satırında **beklenen miktar tutulmaz**. Beklenen
//! değeri gören kişi kendi ölçümüne göre yazmaz; sayımın değeri kaybolur.
//! Beklenen miktar yalnız kapanışta hesaplanır ve fark olarak denetim defterine
//! yazılır.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::fifo::consume_fifo;
use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::quantity_cost::unit_cost_cents as calculate_unit_cost_cents;
use crate::services::inventory360::{optional_i64, optional_text};
use crate::services::stock_trail::{self, StockMove};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct WasteRecord {
    pub id: String,
    pub product_id: String,
    pub product_name: String,
    pub reason: String,
    pub quantity: f64,
    /// Partilerden çözülen birim maliyet (kuruş). `None` = maliyet bilinmiyor;
    /// sıfır değildir (AGENTS.md §3.4).
    pub unit_cost_cents: Option<i64>,
    /// Fire tutarı (kuruş). `None` = maliyet bilinmiyor.
    pub total_cost_cents: Option<i64>,
    pub occurred_at: String,
    pub recorded_by: String,
    pub notes: Option<String>,
    /// Elle girilen fire düzenlenebilir; sipariş iptalinden doğan kayıt siparişe bağlıdır.
    pub manual: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasteInput {
    pub product_id: String,
    pub reason: String,
    pub quantity: f64,
    pub occurred_at: Option<String>,
    pub notes: Option<String>,
}

const GECERLI_GEREKCELER: [&str; 6] = [
    "BOZULDU",
    "RAF_OMRU_DOLDU",
    "KIRILDI",
    "SIZINTI",
    "HATA_GIRIS",
    "FIRE_EDILDI",
];

pub async fn record_waste(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: WasteInput,
) -> Result<WasteRecord, String> {
    if !GECERLI_GEREKCELER.contains(&input.reason.as_str()) {
        return Err(format!(
            "VALIDATION: fire gerekçesi geçersiz, izin verilenler: {}",
            GECERLI_GEREKCELER.join(", ")
        ));
    }
    if !(input.quantity.is_finite() && input.quantity > 0.0) {
        return Err("VALIDATION: fire miktarı sıfırdan büyük olmalı".into());
    }
    ensure_owned(conn, "products", &input.product_id, tenant_id).await?;

    let product_name: String =
        sqlx::query_scalar("SELECT name FROM products WHERE id = ? AND tenant_id = ?")
            .bind(&input.product_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "NOT_FOUND: ürün bulunamadı".to_string())?;

    let occurred_at = input
        .occurred_at
        .clone()
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let id = generate_id("wst");
    // Stoğu aşan kayıtta ilk partiye bile dokunulmaz; dağılım iptal için saklanır.
    let maliyet = consume_fifo(conn, tenant_id, &input.product_id, input.quantity, &id).await?;

    let unit_cost_cents = Some(calculate_unit_cost_cents(maliyet, input.quantity)?);
    let total_cost_cents = Some(maliyet);

    sqlx::query(
        "INSERT INTO waste_records
             (id, tenant_id, product_id, reason, quantity, unit_cost_cents,
              total_cost_cents, occurred_at, recorded_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&input.product_id)
    .bind(&input.reason)
    .bind(input.quantity)
    .bind(unit_cost_cents)
    .bind(total_cost_cents)
    .bind(&occurred_at)
    .bind(actor_id)
    .bind(&input.notes)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    stock_trail::record(
        conn,
        tenant_id,
        StockMove {
            product_id: &input.product_id,
            movement_type: "WASTE",
            quantity: input.quantity,
            actor_id,
            reason: Some(&input.reason),
            source_type: stock_trail::SOURCE_WASTE,
            source_id: &id,
        },
    )
    .await?;

    Ok(WasteRecord {
        id,
        product_id: input.product_id,
        product_name,
        reason: input.reason,
        quantity: input.quantity,
        unit_cost_cents,
        total_cost_cents,
        occurred_at,
        recorded_by: actor_id.to_string(),
        notes: input.notes,
        manual: true,
    })
}

pub async fn list_waste_records(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    limit: Option<i64>,
) -> Result<Vec<WasteRecord>, String> {
    // Rapor sonu sınırsız döngüye girmemeli; sınır yoksa 500 varsayılır.
    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let rows = sqlx::query(
        "SELECT w.id, w.product_id, p.name AS product_name, w.reason, w.quantity,
                w.unit_cost_cents, w.total_cost_cents, w.occurred_at, w.recorded_by, w.notes,
                EXISTS (SELECT 1 FROM stock_movements m
                         WHERE m.tenant_id = w.tenant_id AND m.source_id = w.id
                           AND m.source_type = 'WASTE_RECORD') AS manual
           FROM waste_records w
           JOIN products p ON p.id = w.product_id AND p.tenant_id = w.tenant_id
          WHERE w.tenant_id = ? AND w.voided_at IS NULL
          ORDER BY w.occurred_at DESC
          LIMIT ?",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(WasteRecord {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            product_id: row.try_get("product_id").map_err(|e| e.to_string())?,
            product_name: row.try_get("product_name").map_err(|e| e.to_string())?,
            reason: row.try_get("reason").map_err(|e| e.to_string())?,
            quantity: row.try_get("quantity").map_err(|e| e.to_string())?,
            unit_cost_cents: optional_i64(&row, "unit_cost_cents")?,
            total_cost_cents: optional_i64(&row, "total_cost_cents")?,
            occurred_at: row.try_get("occurred_at").map_err(|e| e.to_string())?,
            recorded_by: row.try_get("recorded_by").map_err(|e| e.to_string())?,
            notes: optional_text(&row, "notes")?,
            manual: row.try_get("manual").map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}
