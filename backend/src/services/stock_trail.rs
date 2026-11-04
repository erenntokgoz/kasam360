//! Stok hareketinin nedeni ve kaynağı: mal kabulü, satış/reçete, fire, iptal iadesi, sayım.
//!
//! Neden tek defter: her hareket kendi tablosunda iz bırakır ama parti tablosu yalnız
//! kalanı bilir. "Bu miktar neden azaldı" sorusu beş ayrı yerden toplanamaz. Hareket,
//! stoğu değiştiren işlemle aynı yazmada kaydedilir; ayrı zamanda yazılan iz yalan söyler.
//!
//! Yükseltmeden önceki hareketin kaynağı yoktur ve uydurulmaz; defter o andan başlar.

use serde::Serialize;
use sqlx::{Row, SqliteConnection, SqlitePool};

use crate::id_generator::generate_id;

pub const SOURCE_PURCHASE: &str = "PURCHASE_ORDER";
pub const SOURCE_ORDER_ITEM: &str = "ORDER_ITEM";
pub const SOURCE_ORDER_VOID: &str = "ORDER_VOID";
pub const SOURCE_WASTE: &str = "WASTE_RECORD";
pub const SOURCE_COUNT: &str = "STOCK_COUNT";

/// Sistem düşümünde oturum yoktur; kişi kalemin garsonundan okunur.
const SYSTEM_ACTOR: &str = "SYSTEM";
const MAX_ROWS: i64 = 500;

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Eski veritabanında kaynak kolonları yoktur. İndeks de burada kurulur: şema dosyası
/// kolon eklenmeden çalışır ve eski kurulumda hata verirdi.
pub async fn ensure_columns(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    for column in ["source_type", "source_id"] {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('stock_movements') WHERE name = ?",
        )
        .bind(column)
        .fetch_one(pool)
        .await?;
        if exists == 0 {
            sqlx::query(&format!(
                "ALTER TABLE stock_movements ADD COLUMN {column} TEXT"
            ))
            .execute(pool)
            .await?;
        }
    }
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_stock_movements_trail
             ON stock_movements(tenant_id, product_id, created_at)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub struct StockMove<'a> {
    pub product_id: &'a str,
    pub movement_type: &'a str,
    pub quantity: f64,
    pub actor_id: &'a str,
    pub reason: Option<&'a str>,
    pub source_type: &'a str,
    pub source_id: &'a str,
}

pub async fn record(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    entry: StockMove<'_>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO stock_movements
             (id, tenant_id, inventory_item_id, product_id, movement_type, quantity,
              actor_id, reason, source_type, source_id)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(generate_id("smv"))
    .bind(tenant_id)
    .bind(entry.product_id)
    .bind(entry.movement_type)
    .bind(entry.quantity)
    .bind(entry.actor_id)
    .bind(entry.reason)
    .bind(entry.source_type)
    .bind(entry.source_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

/// Bir kalemin parti tüketimini ürün başına tek harekete indirir. Reçetede her bileşen
/// kendi satırını alır; partisi olmayan eksik de düşümdür, sessizce atlanmaz.
pub async fn record_allocations(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    source_id: &str,
    product_id: &str,
    allocations: &[serde_json::Value],
) -> Result<(), String> {
    let mut totals: Vec<(String, f64, bool)> = Vec::new();
    for allocation in allocations {
        let target = allocation["componentProductId"]
            .as_str()
            .unwrap_or(product_id)
            .to_string();
        let taken = allocation["quantity"]
            .as_f64()
            .ok_or_else(|| "INTERNAL: stok kaydında parti miktarı eksik".to_string())?;
        let is_component = allocation.get("componentProductId").is_some();
        match totals.iter_mut().find(|(id, _, _)| *id == target) {
            Some(total) => total.1 += taken,
            None => totals.push((target, taken, is_component)),
        }
    }
    for (target, quantity, is_component) in totals {
        // Adet karşılığı bilinmeyen gram açığı sıfır satırla deftere karışmaz.
        if quantity <= 0.0 {
            continue;
        }
        record(
            conn,
            tenant_id,
            StockMove {
                product_id: &target,
                movement_type: "OUT",
                quantity,
                actor_id: SYSTEM_ACTOR,
                reason: Some(if is_component {
                    "Reçeteden düşüm"
                } else {
                    "Satış"
                }),
                source_type: SOURCE_ORDER_ITEM,
                source_id,
            },
        )
        .await?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockTrailRow {
    pub id: String,
    pub created_at: String,
    pub product_id: String,
    pub product_name: String,
    pub kind: String,
    pub quantity: f64,
    pub reason: Option<String>,
    pub source_id: Option<String>,
    pub order_id: Option<String>,
    pub actor_name: String,
}

fn kind_of(movement_type: &str, source_type: Option<&str>) -> &'static str {
    match (movement_type, source_type) {
        ("IN", Some(SOURCE_ORDER_VOID)) => "IADE",
        ("IN", _) => "MAL_KABUL",
        ("OUT", _) => "SATIS",
        ("WASTE", _) => "FIRE",
        _ => "SAYIM",
    }
}

/// Çıkış eksi, giriş artı görünür. Sayım farkı kendi işaretini taşır.
fn signed_quantity(movement_type: &str, quantity: f64) -> f64 {
    match movement_type {
        "OUT" | "WASTE" => -quantity.abs(),
        "IN" => quantity.abs(),
        _ => quantity,
    }
}

pub async fn list(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: Option<&str>,
) -> Result<Vec<StockTrailRow>, String> {
    let rows = sqlx::query(
        "SELECT m.id, m.created_at, m.product_id, p.name AS product_name, m.movement_type,
                m.quantity, m.reason, m.source_type, m.source_id, oi.order_id,
                COALESCE(actor.name, waiter.name, 'Sistem') AS actor_name
           FROM stock_movements m
           JOIN products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
           LEFT JOIN order_items oi ON oi.id = m.source_id AND oi.tenant_id = m.tenant_id
           LEFT JOIN users actor ON actor.id = m.actor_id AND actor.tenant_id = m.tenant_id
           LEFT JOIN users waiter ON waiter.id = oi.waiter_id AND waiter.tenant_id = m.tenant_id
          WHERE m.tenant_id = ? AND (? IS NULL OR m.product_id = ?)
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT ?",
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(product_id)
    .bind(MAX_ROWS)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let movement_type: String = row.try_get("movement_type").map_err(text_error)?;
        let source_type: Option<String> = row.try_get("source_type").map_err(text_error)?;
        let quantity: f64 = row.try_get("quantity").map_err(text_error)?;
        result.push(StockTrailRow {
            id: row.try_get("id").map_err(text_error)?,
            created_at: row.try_get("created_at").map_err(text_error)?,
            product_id: row.try_get("product_id").map_err(text_error)?,
            product_name: row.try_get("product_name").map_err(text_error)?,
            kind: kind_of(&movement_type, source_type.as_deref()).to_string(),
            quantity: signed_quantity(&movement_type, quantity),
            reason: row.try_get("reason").map_err(text_error)?,
            source_id: row.try_get("source_id").map_err(text_error)?,
            order_id: row.try_get("order_id").map_err(text_error)?,
            actor_name: row.try_get("actor_name").map_err(text_error)?,
        });
    }
    Ok(result)
}

#[cfg(test)]
#[path = "stock_trail_tests.rs"]
mod tests;
