//! Raf ömrü takibi (Spec §2.12).
//!
//! Son kullanma tarihi partinin kendisinde durur (`inventory_batches.expiry_date`),
//! çünkü aynı ürünün partileri farklı günlerde dolabilir. Politika tablosu ise
//! ürünün **kaç gün** dayandığını söyler; tarih elle girilmez, üretim tarihine
//! eklenerek hesaplanır. Elle tarih girmek en sık hata kaynağıdır: garson
//! son kullanma tarihini gün tutturur ve gıda güvenliği ihlali oluşur.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::{optional_i64, optional_text};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ShelfLifePolicy {
    pub id: String,
    pub product_id: String,
    pub product_name: String,
    pub shelf_life_days: i64,
    pub warning_days: i64,
    pub storage_instruction: Option<String>,
    pub is_active: bool,
}

/// Raf ömrü durumu: dolmuş, yaklaşıyor ya da sağlıklı.
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub enum Freshness {
    /// Son kullanma tarihi geçti.
    Expired,
    /// Uyarı penceresinde.
    ExpiringSoon,
    /// Tarih yok veya uzak.
    Fresh,
    /// Raf ömrü dolmuş ama tarih henüz yazılmamış.
    Unknown,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BatchFreshness {
    pub batch_id: String,
    pub product_id: String,
    pub product_name: String,
    pub batch_code: Option<String>,
    pub remaining_quantity: f64,
    pub unit_cost_cents: i64,
    pub received_at: String,
    pub expiry_date: Option<String>,
    /// Son kullanma tarihine kalan gün. `None` = tarih bilinmiyor.
    pub days_remaining: Option<i64>,
    pub state: Freshness,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExpiryReport {
    pub expired: Vec<BatchFreshness>,
    pub expiring_soon: Vec<BatchFreshness>,
    /// Raf ömrü tanımlı ama son kullanma tarihi yazılmamış partiler. Bunlar
    /// gıda güvenliği riskidir ve rapor "tarih yok" diye gösterir.
    pub missing_expiry_date: Vec<BatchFreshness>,
    /// Bu rapordaki fire riskinin tutarı (kuruş). Maliyet partiden bilinir.
    pub at_risk_cost_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfLifePolicyInput {
    pub product_id: String,
    pub shelf_life_days: i64,
    pub warning_days: Option<i64>,
    pub storage_instruction: Option<String>,
    pub is_active: Option<bool>,
}

pub async fn upsert_shelf_life_policy(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: ShelfLifePolicyInput,
) -> Result<ShelfLifePolicy, String> {
    if input.shelf_life_days <= 0 {
        return Err("VALIDATION: raf ömrü sıfırdan büyük gün sayısı olmalı".into());
    }
    let warning_days = input.warning_days.unwrap_or(3);
    if warning_days < 0 || warning_days >= input.shelf_life_days {
        return Err("VALIDATION: uyarı pencerisi raf ömründen küçük olmalı".into());
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

    let is_active = input.is_active.unwrap_or(true);
    sqlx::query(
        "INSERT INTO shelf_life_policies
             (id, tenant_id, product_id, shelf_life_days, warning_days,
              storage_instruction, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, product_id)
         DO UPDATE SET shelf_life_days = excluded.shelf_life_days,
                       warning_days = excluded.warning_days,
                       storage_instruction = excluded.storage_instruction,
                       is_active = excluded.is_active,
                       updated_at = CURRENT_TIMESTAMP",
    )
    .bind(generate_id("slp"))
    .bind(tenant_id)
    .bind(&input.product_id)
    .bind(input.shelf_life_days)
    .bind(warning_days)
    .bind(&input.storage_instruction)
    .bind(is_active)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // UPSERT sonrası kimlik okunur: üretilen kimlik `ON CONFLICT` dalında
    // kullanılmaz, gerçek kimlik veritabanındaki kayıttır.
    let id: String = sqlx::query_scalar(
        "SELECT id FROM shelf_life_policies WHERE tenant_id = ? AND product_id = ?",
    )
    .bind(tenant_id)
    .bind(&input.product_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(ShelfLifePolicy {
        id,
        product_id: input.product_id,
        product_name,
        shelf_life_days: input.shelf_life_days,
        warning_days,
        storage_instruction: input.storage_instruction,
        is_active,
    })
}

pub async fn list_shelf_life_policies(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<ShelfLifePolicy>, String> {
    let rows = sqlx::query(
        "SELECT s.id, s.product_id, p.name AS product_name, s.shelf_life_days,
                s.warning_days, s.storage_instruction, s.is_active
           FROM shelf_life_policies s
           JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
          WHERE s.tenant_id = ?
          ORDER BY p.name ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(ShelfLifePolicy {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            product_id: row.try_get("product_id").map_err(|e| e.to_string())?,
            product_name: row.try_get("product_name").map_err(|e| e.to_string())?,
            shelf_life_days: row.try_get("shelf_life_days").map_err(|e| e.to_string())?,
            warning_days: row.try_get("warning_days").map_err(|e| e.to_string())?,
            storage_instruction: optional_text(&row, "storage_instruction")?,
            is_active: row.try_get("is_active").map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}

async fn build_report(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<ExpiryReport, String> {
    let rows = sqlx::query(
        "SELECT b.id AS batch_id, b.product_id, p.name AS product_name, b.batch_code,
                b.remaining_quantity, b.unit_cost_cents, b.received_at, b.expiry_date,
                s.warning_days
           FROM inventory_batches b
           JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
           LEFT JOIN shelf_life_policies s
                  ON s.product_id = b.product_id AND s.tenant_id = b.tenant_id
                 AND s.is_active = 1
          WHERE b.tenant_id = ? AND b.remaining_quantity > 0 AND b.product_id IS NOT NULL",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let bugun = chrono::Local::now().date_naive();
    let mut expired = Vec::new();
    let mut expiring_soon = Vec::new();
    let mut missing = Vec::new();
    let mut at_risk_cost_cents: i64 = 0;

    for row in rows {
        let unit_cost: i64 = row.try_get("unit_cost_cents").map_err(|e| e.to_string())?;
        let remaining: f64 = row
            .try_get("remaining_quantity")
            .map_err(|e| e.to_string())?;
        let expiry = optional_text(&row, "expiry_date")?;
        let warning_days = optional_i64(&row, "warning_days")?;

        let (days_remaining, state) = match expiry
            .as_deref()
            .and_then(|d| d.parse::<chrono::NaiveDate>().ok())
        {
            Some(tarih) => {
                let kalan = (tarih - bugun).num_days();
                let durum = if kalan < 0 {
                    Freshness::Expired
                } else if kalan <= warning_days.unwrap_or(3) {
                    Freshness::ExpiringSoon
                } else {
                    Freshness::Fresh
                };
                (Some(kalan), durum)
            }
            // Tarih yazılmamış. Raf ömrü tanımlıysa bu bir veri eksiğidir:
            // ne geçtiğini bilmek imkânsız, gıda güvenliği riski taşır.
            None => (None, Freshness::Unknown),
        };

        let kayit = BatchFreshness {
            batch_id: row.try_get("batch_id").map_err(|e| e.to_string())?,
            product_id: row.try_get("product_id").map_err(|e| e.to_string())?,
            product_name: row.try_get("product_name").map_err(|e| e.to_string())?,
            batch_code: optional_text(&row, "batch_code")?,
            remaining_quantity: remaining,
            unit_cost_cents: unit_cost,
            received_at: row.try_get("received_at").map_err(|e| e.to_string())?,
            expiry_date: expiry,
            days_remaining,
            state: state.clone(),
        };

        match state {
            Freshness::Expired => {
                at_risk_cost_cents += (unit_cost as f64 * remaining).round() as i64;
                expired.push(kayit);
            }
            Freshness::ExpiringSoon => {
                at_risk_cost_cents += (unit_cost as f64 * remaining).round() as i64;
                expiring_soon.push(kayit);
            }
            Freshness::Unknown => {
                at_risk_cost_cents += (unit_cost as f64 * remaining).round() as i64;
                missing.push(kayit);
            }
            Freshness::Fresh => {}
        }
    }

    // En yakın dolan partiler önce: mutfak önce onları kullanmalı.
    expired.sort_by_key(|b| b.days_remaining);
    expiring_soon.sort_by_key(|b| b.days_remaining);

    Ok(ExpiryReport {
        expired,
        expiring_soon,
        missing_expiry_date: missing,
        at_risk_cost_cents,
    })
}

pub async fn expired_batches(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<BatchFreshness>, String> {
    Ok(build_report(conn, tenant_id).await?.expired)
}

pub async fn expiring_batches(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<ExpiryReport, String> {
    build_report(conn, tenant_id).await
}

/// Son kullanma tarihi gelen partiye gider ve `expiry_date` yazılır.
pub async fn set_batch_expiry(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    batch_id: &str,
    expiry_date: &str,
) -> Result<(), String> {
    ensure_owned(conn, "inventory_batches", batch_id, tenant_id).await?;
    chrono::NaiveDate::parse_from_str(expiry_date, "%Y-%m-%d")
        .map_err(|_| "VALIDATION: son kullanma tarihi YYYY-AA-GG biçiminde olmalı".to_string())?;

    sqlx::query("UPDATE inventory_batches SET expiry_date = ? WHERE id = ? AND tenant_id = ?")
        .bind(expiry_date)
        .bind(batch_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Parti geliş tarihini okur.
///
/// İki biçim gerçekte yazılır: şemanın `CURRENT_TIMESTAMP` varsayılanı
/// (`2026-10-03 08:52:00`) ve satın alma teslimi RFC 3339
/// (`2026-10-03T08:52:00Z`). Yalnız birini kabul eden kod, partilerin bir
/// kısmında "geliş tarihi okunamadı" hatası verir ve o partiler hiçbir zaman
/// raf ömrü damgası almaz; stok raporunda "tarih yok" görünür.
fn gelis_tarihi_coz(metin: &str) -> Option<chrono::NaiveDate> {
    if let Ok(tarih) = chrono::NaiveDate::parse_from_str(metin, "%Y-%m-%d") {
        return Some(tarih);
    }
    if let Ok(an) = chrono::DateTime::parse_from_rfc3339(metin) {
        return Some(an.date_naive());
    }
    chrono::NaiveDateTime::parse_from_str(metin, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|an| an.date())
}

/// Raf ömrü tanımlı ürünlerin yeni partilerine son kullanma tarihini yazar.
///
/// Geliş tarihinden politika gün sayısı hesaplanır; tarih elle verilmez.
pub async fn stamp_expiry_from_policy(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    batch_id: &str,
) -> Result<Option<String>, String> {
    let shelf_life_days: Option<i64> = sqlx::query_scalar(
        "SELECT s.shelf_life_days
           FROM inventory_batches b
           JOIN shelf_life_policies s
             ON s.product_id = b.product_id AND s.tenant_id = b.tenant_id
            AND s.is_active = 1
          WHERE b.id = ? AND b.tenant_id = ?",
    )
    .bind(batch_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Politika yoksa tarih uydurulmaz; parti "tarih yok" olarak raporlanır.
    let shelf_life_days = match shelf_life_days {
        Some(days) => days,
        None => return Ok(None),
    };

    let received: String = sqlx::query_scalar(
        "SELECT received_at FROM inventory_batches WHERE id = ? AND tenant_id = ?",
    )
    .bind(batch_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let received_date = gelis_tarihi_coz(&received)
        .ok_or_else(|| "VALIDATION: parti geliş tarihi okunamadı".to_string())?;
    let expiry = received_date + chrono::Duration::days(shelf_life_days);
    let expiry_text = expiry.format("%Y-%m-%d").to_string();

    sqlx::query("UPDATE inventory_batches SET expiry_date = ? WHERE id = ? AND tenant_id = ?")
        .bind(&expiry_text)
        .bind(batch_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(Some(expiry_text))
}
