//! Stok/malzeme hareket raporu: dönem için açılış, giriş, satışla düşüm, fire, sayım,
//! iade ve kapanış; miktar ve gerçek parti maliyetiyle.
//!
//! Neden bu kaynaklar: giriş `inventory_batches` partisinden okunur (alış maliyeti partide
//! durur). Satış maliyeti, düşüm anında FIFO'nun yazdığı `FIFO_STOCK_DEDUCTED` olayından
//! gelir; sonradan değişen parti fiyatı geçmiş satışın maliyetini oynatmaz. Fire, sayım ve
//! iade `stock_movements` defterinden okunur. Maliyeti bilinmeyen miktar sıfır maliyetle
//! gizlenmez, `unknown_cost_quantity` olarak ayrıca gösterilir.
//!
//! Açılış ve kapanış miktarı bugünkü parti kalanından geriye doğru çözülür: kalandan dönem
//! sonrasındaki net hareket çıkarılarak kapanışa, dönem içindekiler de çıkarılarak açılışa
//! gidilir. Değer, bugünkü partilerin ağırlıklı ortalama maliyetiyle yazılır; geçmiş günün
//! parti bazlı anlık değeri tutulmadığı için bu bir tahmindir ve arayüz öyle adlandırır.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::services::inventory360::quantity_cost::{line_cost_cents, unit_cost_cents};
use crate::services::stock_trail::{
    SOURCE_COUNT, SOURCE_ORDER_ITEM, SOURCE_ORDER_VOID, SOURCE_WASTE, SOURCE_WASTE_VOID,
};

/// Fire iadesiyle açılan parti mal kabulü değildir; iade hareketi zaten sayılır.
const RETURN_BATCH_CODE: &str = "FIRE-IADE";
const EPSILON: f64 = 1e-9;
/// `quantity_cost` altı mikrobirimden küçük miktarı ölçülemez sayar.
const MIN_COSTED: f64 = 0.000_001;

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StockMovementRowDto {
    pub product_id: String,
    pub product_name: String,
    pub unit: String,
    pub is_raw: bool,
    pub opening_quantity: f64,
    /// Bugünkü ortalama maliyetle; parti hiç yoksa boş.
    pub opening_cost_cents: Option<i64>,
    pub intake_quantity: f64,
    pub intake_cost_cents: i64,
    pub sale_quantity: f64,
    pub sale_cost_cents: i64,
    /// İptal edilen fire düşülmüş net fire.
    pub waste_quantity: f64,
    pub waste_cost_cents: i64,
    /// Sayım farkı işaretlidir: eksik negatif.
    pub count_quantity: f64,
    pub count_cost_cents: i64,
    pub return_quantity: f64,
    pub return_cost_cents: i64,
    pub closing_quantity: f64,
    pub closing_cost_cents: Option<i64>,
    /// Maliyeti kayda geçmemiş miktar: partisiz satış, maliyetsiz fire veya fazla sayım.
    pub unknown_cost_quantity: f64,
}

#[derive(Default)]
struct Acc {
    intake_q: f64,
    intake_c: i64,
    sale_q: f64,
    sale_c: i64,
    waste_q: f64,
    waste_c: i64,
    count_q: f64,
    count_c: i64,
    return_q: f64,
    return_c: i64,
    unknown_q: f64,
    net_after_from: f64,
    net_after_to: f64,
    remaining: f64,
    value_now: i64,
    last_unit_cost: Option<i64>,
}

/// Bir olayın bir ürün için toplam kullanımı: bilinen maliyet ve maliyetsiz miktar.
#[derive(Default, Clone)]
struct EventUse {
    quantity: f64,
    known_cost: i64,
    unknown_quantity: f64,
}

fn round6(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

fn add(total: i64, extra: i64) -> Result<i64, String> {
    total
        .checked_add(extra)
        .ok_or_else(|| "OVERFLOW: stok hareket maliyeti taştı".to_string())
}

fn costed(unit: i64, quantity: f64) -> Result<i64, String> {
    if quantity < MIN_COSTED {
        return Ok(0);
    }
    line_cost_cents(unit, quantity)
}

fn parse_event(payload: &str) -> Result<HashMap<String, EventUse>, String> {
    let value: serde_json::Value = serde_json::from_str(payload)
        .map_err(|_| "INTERNAL: stok düşüm olayı okunamadı".to_string())?;
    let mut out: HashMap<String, EventUse> = HashMap::new();
    for line in value["allocations"].as_array().into_iter().flatten() {
        for batch in line["batches"].as_array().into_iter().flatten() {
            let product = batch["componentProductId"]
                .as_str()
                .or_else(|| line["productId"].as_str())
                .ok_or_else(|| "INTERNAL: stok düşüm olayında ürün yok".to_string())?;
            let quantity = batch["quantity"]
                .as_f64()
                .ok_or_else(|| "INTERNAL: stok düşüm olayında miktar yok".to_string())?;
            let entry = out.entry(product.to_string()).or_default();
            entry.quantity += quantity;
            match batch["totalCostCents"].as_i64() {
                Some(cost) => entry.known_cost = add(entry.known_cost, cost)?,
                None => entry.unknown_quantity += quantity,
            }
        }
    }
    Ok(out)
}

/// Dönemde düşüm ya da iade hareketi olan kalemlerin FIFO olayları (kaynak kimliğine göre).
async fn load_events(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<HashMap<String, HashMap<String, EventUse>>, String> {
    let rows = sqlx::query(
        "SELECT aggregate_id, payload FROM events
          WHERE tenant_id = ?1 AND event_type = 'FIFO_STOCK_DEDUCTED'
            AND aggregate_id IN (SELECT source_id FROM stock_movements
                                  WHERE tenant_id = ?1 AND source_type IN (?4, ?5)
                                    AND datetime(created_at) >= datetime(?2)
                                    AND datetime(created_at) < datetime(?3))",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .bind(SOURCE_ORDER_ITEM)
    .bind(SOURCE_ORDER_VOID)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    let mut out = HashMap::new();
    for row in rows {
        let id: String = row.try_get("aggregate_id").map_err(text_error)?;
        let payload: String = row.try_get("payload").map_err(text_error)?;
        out.insert(id, parse_event(&payload)?);
    }
    Ok(out)
}

async fn load_waste_units(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<HashMap<String, Option<i64>>, String> {
    let rows = sqlx::query(
        "SELECT id, unit_cost_cents FROM waste_records
          WHERE tenant_id = ?1
            AND id IN (SELECT source_id FROM stock_movements
                        WHERE tenant_id = ?1 AND source_type IN (?4, ?5)
                          AND datetime(created_at) >= datetime(?2)
                          AND datetime(created_at) < datetime(?3))",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .bind(SOURCE_WASTE)
    .bind(SOURCE_WASTE_VOID)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            Ok((
                row.try_get("id").map_err(text_error)?,
                row.try_get("unit_cost_cents").map_err(text_error)?,
            ))
        })
        .collect()
}

async fn load_count_costs(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<HashMap<(String, String), Option<i64>>, String> {
    let rows = sqlx::query(
        "SELECT stock_count_id, product_id, variance_cost_cents FROM stock_count_lines
          WHERE tenant_id = ?1
            AND stock_count_id IN (SELECT source_id FROM stock_movements
                                    WHERE tenant_id = ?1 AND source_type = ?4
                                      AND datetime(created_at) >= datetime(?2)
                                      AND datetime(created_at) < datetime(?3))",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .bind(SOURCE_COUNT)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            Ok((
                (
                    row.try_get("stock_count_id").map_err(text_error)?,
                    row.try_get("product_id").map_err(text_error)?,
                ),
                row.try_get("variance_cost_cents").map_err(text_error)?,
            ))
        })
        .collect()
}

/// Olay ortalamasıyla orantılı maliyet: iade ve sipariş iptalinden doğan fire için.
fn proportional(event: Option<&EventUse>, quantity: f64) -> Result<Option<i64>, String> {
    let Some(event) = event else { return Ok(None) };
    let known = event.quantity - event.unknown_quantity;
    if known < MIN_COSTED {
        return Ok(None);
    }
    let unit = unit_cost_cents(event.known_cost, known)?;
    Ok(Some(costed(unit, quantity)?))
}

async fn load_batches(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
    product_id: Option<&str>,
    accs: &mut HashMap<String, Acc>,
) -> Result<(), String> {
    let rows = sqlx::query(
        "SELECT product_id, COALESCE(batch_code, '') AS code, unit_cost_cents,
                initial_quantity, remaining_quantity,
                datetime(received_at) >= datetime(?2) AS after_from,
                datetime(received_at) >= datetime(?3) AS after_to
           FROM inventory_batches
          WHERE tenant_id = ?1 AND product_id IS NOT NULL AND (?4 IS NULL OR product_id = ?4)
          ORDER BY datetime(received_at) ASC, id ASC",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    for row in rows {
        let product: String = row.try_get("product_id").map_err(text_error)?;
        let code: String = row.try_get("code").map_err(text_error)?;
        let unit: i64 = row.try_get("unit_cost_cents").map_err(text_error)?;
        let initial: f64 = row.try_get("initial_quantity").map_err(text_error)?;
        let remaining: f64 = row.try_get("remaining_quantity").map_err(text_error)?;
        let after_from: bool = row.try_get("after_from").map_err(text_error)?;
        let after_to: bool = row.try_get("after_to").map_err(text_error)?;
        let acc = accs.entry(product).or_default();
        acc.remaining += remaining;
        if remaining > EPSILON {
            acc.value_now = add(acc.value_now, costed(unit, remaining)?)?;
        }
        acc.last_unit_cost = Some(unit);
        if code == RETURN_BATCH_CODE || !after_from {
            continue;
        }
        acc.net_after_from += initial;
        if after_to {
            acc.net_after_to += initial;
        } else {
            acc.intake_q += initial;
            acc.intake_c = add(acc.intake_c, costed(unit, initial)?)?;
        }
    }
    Ok(())
}

/// Bugünkü partilerin ağırlıklı ortalama maliyetiyle değer; parti hiç yoksa bilinmez.
fn valued(acc: &Acc, quantity: f64) -> Result<Option<i64>, String> {
    if quantity < MIN_COSTED {
        return Ok(Some(0));
    }
    if acc.remaining >= MIN_COSTED && acc.value_now > 0 {
        let unit = unit_cost_cents(acc.value_now, acc.remaining)?;
        return Ok(Some(costed(unit, quantity)?));
    }
    acc.last_unit_cost
        .map(|unit| costed(unit, quantity))
        .transpose()
}

async fn apply_movements(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
    product_id: Option<&str>,
    accs: &mut HashMap<String, Acc>,
) -> Result<(), String> {
    let events = load_events(conn, tenant_id, from, to).await?;
    let waste_units = load_waste_units(conn, tenant_id, from, to).await?;
    let count_costs = load_count_costs(conn, tenant_id, from, to).await?;
    let rows = sqlx::query(
        "SELECT product_id, movement_type, quantity, source_type, source_id,
                datetime(created_at) < datetime(?3) AS in_period
           FROM stock_movements
          WHERE tenant_id = ?1 AND product_id IS NOT NULL AND (?4 IS NULL OR product_id = ?4)
            AND datetime(created_at) >= datetime(?2)
          ORDER BY datetime(created_at) ASC, id ASC",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;

    let mut sale_taken: HashSet<(String, String)> = HashSet::new();
    for row in rows {
        let product: String = row.try_get("product_id").map_err(text_error)?;
        let movement: String = row.try_get("movement_type").map_err(text_error)?;
        let quantity: f64 = row.try_get("quantity").map_err(text_error)?;
        let source_type: Option<String> = row.try_get("source_type").map_err(text_error)?;
        let source_id: String = row
            .try_get::<Option<String>, _>("source_id")
            .map_err(text_error)?
            .unwrap_or_default();
        let in_period: bool = row.try_get("in_period").map_err(text_error)?;
        let source = source_type.as_deref();
        let acc = accs.entry(product.clone()).or_default();
        let event = events.get(&source_id).and_then(|e| e.get(&product));

        let signed = match (movement.as_str(), source) {
            ("OUT" | "WASTE", _) => -quantity,
            ("IN", Some(SOURCE_ORDER_VOID | SOURCE_WASTE_VOID)) | ("ADJUST", _) => quantity,
            // Mal kabulü parti kaydından sayılır; burada ikinci kez eklenmez.
            _ => 0.0,
        };
        acc.net_after_from += signed;
        if !in_period {
            acc.net_after_to += signed;
            continue;
        }
        match (movement.as_str(), source) {
            ("OUT", _) => {
                acc.sale_q += quantity;
                match event {
                    Some(used) if sale_taken.insert((source_id.clone(), product.clone())) => {
                        acc.sale_c = add(acc.sale_c, used.known_cost)?;
                        acc.unknown_q += used.unknown_quantity;
                    }
                    Some(_) => {}
                    None => acc.unknown_q += quantity,
                }
            }
            ("IN", Some(SOURCE_ORDER_VOID)) => {
                acc.return_q += quantity;
                match proportional(event, quantity)? {
                    Some(cost) => acc.return_c = add(acc.return_c, cost)?,
                    None => acc.unknown_q += quantity,
                }
            }
            ("WASTE", _) | ("IN", Some(SOURCE_WASTE_VOID)) => {
                let outgoing = movement == "WASTE";
                let cost = if source == Some(SOURCE_ORDER_ITEM) {
                    proportional(event, quantity)?
                } else {
                    match waste_units.get(&source_id).copied().flatten() {
                        Some(unit) => Some(costed(unit, quantity)?),
                        None => None,
                    }
                };
                acc.waste_q += if outgoing { quantity } else { -quantity };
                match cost {
                    Some(cost) if outgoing => acc.waste_c = add(acc.waste_c, cost)?,
                    Some(cost) => acc.waste_c = add(acc.waste_c, -cost)?,
                    None if outgoing => acc.unknown_q += quantity,
                    None => {}
                }
            }
            ("ADJUST", _) => {
                acc.count_q += quantity;
                let recorded = count_costs
                    .get(&(source_id.clone(), product.clone()))
                    .copied()
                    .flatten();
                match recorded {
                    Some(cost) if quantity < 0.0 => acc.count_c = add(acc.count_c, -cost)?,
                    Some(cost) => acc.count_c = add(acc.count_c, cost)?,
                    None => acc.unknown_q += quantity.abs(),
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Dönemde hareketi olan her kalem için bir satır; kalem adına göre sıralı.
pub async fn report(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
    product_id: Option<&str>,
) -> Result<Vec<StockMovementRowDto>, String> {
    let mut accs: HashMap<String, Acc> = HashMap::new();
    load_batches(conn, tenant_id, from, to, product_id, &mut accs).await?;
    apply_movements(conn, tenant_id, from, to, product_id, &mut accs).await?;

    let products = sqlx::query(
        "SELECT id, name, stock_unit, is_raw FROM products
          WHERE tenant_id = ?1 AND (?2 IS NULL OR id = ?2) ORDER BY name COLLATE NOCASE, id",
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;

    let mut out = Vec::new();
    for product in products {
        let id: String = product.try_get("id").map_err(text_error)?;
        let Some(acc) = accs.get(&id) else { continue };
        let opening = round6(acc.remaining - acc.net_after_from);
        let closing = round6(acc.remaining - acc.net_after_to);
        let active = [
            acc.intake_q,
            acc.sale_q,
            acc.waste_q,
            acc.count_q,
            acc.return_q,
            opening,
            closing,
        ]
        .iter()
        .any(|value| value.abs() > EPSILON);
        if !active {
            continue;
        }
        out.push(StockMovementRowDto {
            product_name: product.try_get("name").map_err(text_error)?,
            unit: product.try_get("stock_unit").map_err(text_error)?,
            is_raw: product.try_get("is_raw").map_err(text_error)?,
            opening_quantity: opening,
            opening_cost_cents: valued(acc, opening.max(0.0))?,
            intake_quantity: round6(acc.intake_q),
            intake_cost_cents: acc.intake_c,
            sale_quantity: round6(acc.sale_q),
            sale_cost_cents: acc.sale_c,
            waste_quantity: round6(acc.waste_q),
            waste_cost_cents: acc.waste_c,
            count_quantity: round6(acc.count_q),
            count_cost_cents: acc.count_c,
            return_quantity: round6(acc.return_q),
            return_cost_cents: acc.return_c,
            closing_quantity: closing,
            closing_cost_cents: valued(acc, closing.max(0.0))?,
            unknown_cost_quantity: round6(acc.unknown_q),
            product_id: id,
        });
    }
    Ok(out)
}

#[cfg(test)]
#[path = "stock_movement_report_tests.rs"]
mod tests;
