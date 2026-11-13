//! Fire kaydının düzeltilmesi ve iptali.
//!
//! Neden silme yerine iptal: denetim defteri eklemeli kalır ve fire kaydı iz bırakmadan
//! kaybolamaz. İptal edilen kayıt `voided_at` ile işaretlenir, stok düşüldüğü partilere
//! gerçek maliyetiyle geri döner, liste ve raporlar kaydı saymaz.
//!
//! Yalnız elle girilen fire düzeltilebilir. Sipariş iptalinden doğan fire siparişin
//! stok kaydına bağlıdır; burada değiştirilirse sipariş ile stok ayrışır.

use serde::Deserialize;
use sqlx::{Row, SqliteConnection};

use super::fifo::{consume_fifo, return_to_batches};
use super::records::WasteRecord;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::quantity_cost::unit_cost_cents as calculate_unit_cost_cents;
use crate::services::inventory360::{optional_i64, optional_text};
use crate::services::stock_trail::{self, StockMove};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasteEditInput {
    pub waste_id: String,
    /// Boşsa kalem değişmez.
    pub product_id: Option<String>,
    pub quantity: f64,
    pub notes: Option<String>,
}

#[derive(Debug)]
pub struct WasteEditOutcome {
    pub record: WasteRecord,
    pub previous_product_id: String,
    pub previous_quantity: f64,
    pub previous_total_cost_cents: i64,
}

#[derive(Debug)]
pub struct WasteVoidOutcome {
    pub record: WasteRecord,
    pub returned_cost_cents: i64,
}

struct StoredWaste {
    record: WasteRecord,
    voided: bool,
}

async fn load_waste(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    waste_id: &str,
) -> Result<StoredWaste, String> {
    let row = sqlx::query(
        "SELECT w.id, w.product_id, p.name AS product_name, w.reason, w.quantity,
                w.unit_cost_cents, w.total_cost_cents, w.occurred_at, w.recorded_by,
                w.notes, w.voided_at,
                EXISTS (SELECT 1 FROM stock_movements m
                         WHERE m.tenant_id = w.tenant_id AND m.source_id = w.id
                           AND m.source_type = ?) AS manual
           FROM waste_records w
           JOIN products p ON p.id = w.product_id AND p.tenant_id = w.tenant_id
          WHERE w.id = ? AND w.tenant_id = ?",
    )
    .bind(stock_trail::SOURCE_WASTE)
    .bind(waste_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: fire kaydı bulunamadı".to_string())?;

    let voided_at = optional_text(&row, "voided_at")?;
    let record = WasteRecord {
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
    };
    Ok(StoredWaste {
        record,
        voided: voided_at.is_some(),
    })
}

/// Düzeltilebilir kayıt: iptal edilmemiş ve elle girilmiş olmalı.
async fn load_adjustable(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    waste_id: &str,
) -> Result<WasteRecord, String> {
    let stored = load_waste(conn, tenant_id, waste_id).await?;
    if stored.voided {
        return Err("VALIDATION: Bu fire kaydı zaten iptal edilmiş.".into());
    }
    if !stored.record.manual {
        return Err("VALIDATION: Sipariş iptalinden doğan fire buradan değiştirilemez.".into());
    }
    Ok(stored.record)
}

fn known_total(record: &WasteRecord) -> Result<i64, String> {
    record.total_cost_cents.ok_or_else(|| {
        "VALIDATION: Bu fire kaydının maliyeti bilinmiyor, düzeltilemez.".to_string()
    })
}

#[allow(clippy::too_many_arguments)]
async fn record_move(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    product_id: &str,
    movement_type: &str,
    quantity: f64,
    reason: &str,
    waste_id: &str,
    source_type: &str,
) -> Result<(), String> {
    stock_trail::record(
        conn,
        tenant_id,
        StockMove {
            product_id,
            movement_type,
            quantity,
            actor_id,
            reason: Some(reason),
            source_type,
            source_id: waste_id,
        },
    )
    .await
}

/// Miktarı, notu veya kalemi düzeltir. Fark kadar FIFO düşümü veya partiye iade yapılır;
/// kalem değişirse eski kalem tümüyle iade edilir, yeni kalemden düşülür.
pub async fn edit_waste(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: WasteEditInput,
) -> Result<WasteEditOutcome, String> {
    if !(input.quantity.is_finite() && input.quantity > 0.0) {
        return Err("VALIDATION: fire miktarı sıfırdan büyük olmalı".into());
    }
    let before = load_adjustable(conn, tenant_id, &input.waste_id).await?;
    let old_total = known_total(&before)?;
    let new_product_id = input
        .product_id
        .clone()
        .unwrap_or_else(|| before.product_id.clone());
    let notes = input.notes.clone().or_else(|| before.notes.clone());

    let new_total = if new_product_id != before.product_id {
        ensure_owned(conn, "products", &new_product_id, tenant_id).await?;
        // Yeni kalem yetersizse hata, eski kaleme dokunmadan döner.
        let consumed =
            consume_fifo(conn, tenant_id, &new_product_id, input.quantity, &before.id).await?;
        return_to_batches(
            conn,
            tenant_id,
            &before.id,
            &before.product_id,
            before.quantity,
            before.unit_cost_cents,
        )
        .await?;
        record_move(
            conn,
            tenant_id,
            actor_id,
            &before.product_id,
            "IN",
            before.quantity,
            "Fire kalemi değişti",
            &before.id,
            stock_trail::SOURCE_WASTE_VOID,
        )
        .await?;
        record_move(
            conn,
            tenant_id,
            actor_id,
            &new_product_id,
            "WASTE",
            input.quantity,
            "Fire kalemi değişti",
            &before.id,
            stock_trail::SOURCE_WASTE,
        )
        .await?;
        consumed
    } else if input.quantity > before.quantity {
        let delta = input.quantity - before.quantity;
        let consumed = consume_fifo(conn, tenant_id, &before.product_id, delta, &before.id).await?;
        record_move(
            conn,
            tenant_id,
            actor_id,
            &before.product_id,
            "WASTE",
            delta,
            "Fire düzeltmesi",
            &before.id,
            stock_trail::SOURCE_WASTE,
        )
        .await?;
        old_total
            .checked_add(consumed)
            .ok_or_else(|| "OVERFLOW: fire maliyeti taştı".to_string())?
    } else if input.quantity < before.quantity {
        let delta = before.quantity - input.quantity;
        let returned = return_to_batches(
            conn,
            tenant_id,
            &before.id,
            &before.product_id,
            delta,
            before.unit_cost_cents,
        )
        .await?;
        record_move(
            conn,
            tenant_id,
            actor_id,
            &before.product_id,
            "IN",
            delta,
            "Fire düzeltmesi",
            &before.id,
            stock_trail::SOURCE_WASTE_VOID,
        )
        .await?;
        old_total
            .checked_sub(returned)
            .filter(|total| *total >= 0)
            .ok_or_else(|| "VALIDATION: iade edilen maliyet fire tutarını aşıyor".to_string())?
    } else {
        old_total
    };

    let new_unit = calculate_unit_cost_cents(new_total, input.quantity)?;
    let updated = sqlx::query(
        "UPDATE waste_records
            SET product_id = ?, quantity = ?, unit_cost_cents = ?, total_cost_cents = ?, notes = ?
          WHERE id = ? AND tenant_id = ? AND voided_at IS NULL",
    )
    .bind(&new_product_id)
    .bind(input.quantity)
    .bind(new_unit)
    .bind(new_total)
    .bind(&notes)
    .bind(&before.id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();
    if updated != 1 {
        return Err("CONFLICT: fire kaydı güncellenemedi".into());
    }

    let after = load_waste(conn, tenant_id, &before.id).await?.record;
    Ok(WasteEditOutcome {
        record: after,
        previous_product_id: before.product_id,
        previous_quantity: before.quantity,
        previous_total_cost_cents: old_total,
    })
}

/// Fire kaydını iptal eder: stok düşüldüğü partilere gerçek maliyetiyle geri döner.
pub async fn void_waste(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    waste_id: &str,
    reason: &str,
) -> Result<WasteVoidOutcome, String> {
    let record = load_adjustable(conn, tenant_id, waste_id).await?;
    known_total(&record)?;

    let returned_cost_cents = return_to_batches(
        conn,
        tenant_id,
        &record.id,
        &record.product_id,
        record.quantity,
        record.unit_cost_cents,
    )
    .await?;

    let marked = sqlx::query(
        "UPDATE waste_records
            SET voided_at = ?, voided_by = ?, void_reason = ?
          WHERE id = ? AND tenant_id = ? AND voided_at IS NULL",
    )
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(actor_id)
    .bind(reason)
    .bind(&record.id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();
    if marked != 1 {
        return Err("CONFLICT: fire kaydı iptal edilemedi".into());
    }

    record_move(
        conn,
        tenant_id,
        actor_id,
        &record.product_id,
        "IN",
        record.quantity,
        "Fire iptali",
        &record.id,
        stock_trail::SOURCE_WASTE_VOID,
    )
    .await?;

    Ok(WasteVoidOutcome {
        record,
        returned_cost_cents,
    })
}
