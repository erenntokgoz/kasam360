use crate::commands::{CartItemDto, PaymentPayloadDto};
use sqlx::Row;
use uuid::Uuid;

pub struct PaymentRepository;

impl PaymentRepository {
    pub async fn check_idempotency(
        conn: &mut sqlx::SqliteConnection,
        transaction_id: &str,
    ) -> Result<bool, String> {
        let existing: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
            "SELECT id FROM audit_ledger WHERE resource_id = ? LIMIT 1",
        )
        .bind(transaction_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(existing.is_some())
    }

    pub async fn calculate_server_truth_total(
        conn: &mut sqlx::SqliteConnection,
        items: &[CartItemDto],
        global_discount: Option<&serde_json::Value>,
    ) -> Result<i64, String> {
        let mut subtotal_all_cents: i64 = 0;
        let mut tax_all_cents: i64 = 0;

        for item in items {
            let product_id = item.product.get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing product.id in cart item".to_string())?;

            // 1. Önce siparişte dondurulmuş birim fiyat var mı kontrol et (Price Drift Koruması)
            let frozen_order_item = sqlx::query("SELECT unit_price_cents, tax_rate FROM order_items WHERE id = ?")
                .bind(&item.id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

            let (db_price_cents, db_tax_rate): (i64, f64) = if let Some(r) = frozen_order_item {
                (r.try_get("unit_price_cents").unwrap_or(0), r.try_get("tax_rate").unwrap_or(0.0))
            } else {
                let row = sqlx::query("SELECT price_cents, tax_rate FROM products WHERE id = ?")
                    .bind(product_id)
                    .fetch_optional(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

                match row {
                    Some(r) => (r.try_get("price_cents").unwrap_or(0), r.try_get("tax_rate").unwrap_or(0.0)),
                    None => return Err(format!("Product not found in database: {}", product_id)),
                }
            };

            let mut item_unit_price = db_price_cents;
            if let Some(mods) = &item.modifiers {
                if let Some(arr) = mods.as_array() {
                    for mod_opt in arr {
                        if let Some(pc) = mod_opt.get("priceCents").and_then(|v| v.as_i64()) {
                            // Negatif fiyat manipülasyonunu engelle
                            if pc < 0 {
                                return Err("MALICIOUS_INPUT: Negative modifier price detected".to_string());
                            }
                            item_unit_price += pc;
                        }
                    }
                }
            }

            let quantity = item.quantity;
            let gross_cents = item_unit_price * quantity;
            let mut discount_amount_cents: i64 = 0;

            // Kalem bazlı indirim tutarını hesapla (yüzdelik veya sabit tutar)
            if let Some(disc) = &item.discount {
                let disc_type = disc.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let disc_val = disc.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if disc_val > 0.0 {
                    if disc_type == "PERCENTAGE" {
                        let pct = disc_val.min(100.0);
                        discount_amount_cents = ((gross_cents as f64) * (pct / 100.0)).round() as i64;
                    } else if disc_type == "FIXED_AMOUNT" {
                        discount_amount_cents = (disc_val.round() as i64).min(gross_cents);
                    }
                }
            }

            let subtotal_cents = (gross_cents - discount_amount_cents).max(0);
            let tax_rate_int = db_tax_rate.round() as i64;
            let tax_amount_cents = (subtotal_cents * tax_rate_int) / 100;

            subtotal_all_cents += subtotal_cents;
            tax_all_cents += tax_amount_cents;
        }

        let mut grand_total_cents = subtotal_all_cents + tax_all_cents;

        // Sepet geneli (global) indirim tutarını uygula
        if let Some(g_disc) = global_discount {
            let disc_type = g_disc.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let disc_val = g_disc.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if disc_val > 0.0 {
                let g_discount_cents = if disc_type == "PERCENTAGE" {
                    let pct = disc_val.min(100.0);
                    ((grand_total_cents as f64) * (pct / 100.0)).round() as i64
                } else {
                    (disc_val.round() as i64).min(grand_total_cents)
                };
                grand_total_cents = (grand_total_cents - g_discount_cents).max(0);
            }
        }

        Ok(grand_total_cents)
    }

    pub async fn insert_sale_event(
        conn: &mut sqlx::SqliteConnection,
        payload: &PaymentPayloadDto,
    ) -> Result<(), String> {
        let sale_event_id = format!("evt_sale_{}", Uuid::new_v4());
        let payload_json = serde_json::to_string(payload).map_err(|e| e.to_string())?;

        sqlx::query(
            "INSERT INTO events (event_id, aggregate_id, aggregate_type, event_type, payload, created_at) \
             VALUES (?, ?, 'SALE', 'SALE_SETTLED', ?, datetime('now'))",
        )
        .bind(&sale_event_id)
        .bind(&payload.transaction_id)
        .bind(&payload_json)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let outbox_sale_id = format!("outbox_{}", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO outbox (id, event_id, status, created_at) VALUES (?, ?, 'PENDING', datetime('now'))",
        )
        .bind(&outbox_sale_id)
        .bind(&sale_event_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn close_order_if_applicable(
        conn: &mut sqlx::SqliteConnection,
        order_id: Option<&str>,
    ) -> Result<(), String> {
        if let Some(o_id) = order_id {
            let order_row = sqlx::query("SELECT table_id FROM orders WHERE id = ? AND status = 'OPEN'")
                .bind(o_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

            if let Some(row) = order_row {
                let table_id: String = row.try_get("table_id").unwrap_or_default();
                
                sqlx::query("UPDATE orders SET status = 'PAID' WHERE id = ?")
                    .bind(o_id)
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

                sqlx::query("UPDATE tables SET status = 'AVAILABLE' WHERE id = ? AND status = 'RESERVED'")
                    .bind(&table_id)
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}
