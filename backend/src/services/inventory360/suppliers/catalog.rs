//! Tedarikçi yönetimi, fiyat karşılaştırması ve satın alma (Spec §2.12).
//!
//! Neden `directories` yetmiyor: dizin kaydı bir tedarikçinin **adını** tutar,
//! sayısal fiyatını değil. Karşılaştırma tablosu birim fiyat, minimum sipariş
//! miktarı ve teslim süresi ister; bu yüzden `suppliers` ve `supplier_products`
//! ayrı tablolardır.
//!
//! Sessizlik yasağı: en ucuz tedarikçi "fiyatı bilinmiyor" olan bir tedarikçi
//! olamaz. Bilinmeyen fiyat karşılaştırmaya girmez ve raporda "fiyatı girilmemiş"
//! olarak görünür.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::optional_text;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Supplier {
    pub id: String,
    pub name: String,
    pub contact_person: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub tax_number: Option<String>,
    pub address: Option<String>,
    pub payment_term_days: i64,
    pub lead_time_days: i64,
    pub is_active: bool,
    pub notes: Option<String>,
}

/// Bir ürünün tedarikçileri arasındaki fiyat karşılaştırması.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SupplierPriceRow {
    pub supplier_id: String,
    pub supplier_name: String,
    pub unit_cost_cents: i64,
    pub min_order_quantity: f64,
    pub lead_time_days: i64,
    pub payment_term_days: i64,
    pub is_preferred: bool,
    /// En ucuzdan fark (kuruş). Fiyat sıfırdan büyükse hesaplanır; 0 ise bu
    /// satır en ucuzdur.
    pub premium_over_cheapest_cents: Option<i64>,
    /// Aylık alım hacmine göre yıllık maliyet farkı (kuruş). Hacim bilinmiyorsa
    /// `None`; uydurulmaz.
    pub yearly_saving_cents: Option<i64>,
}

/// Fiyatı girilmemiş tedarikçi uyarısı için ayrı sonuç.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PriceGap {
    pub product_id: String,
    pub product_name: String,
    /// Karşılaştırılabilir tedarikçi sayısı.
    pub compared_count: usize,
    /// Fiyatı girilmemiş tedarikçi sayısı.
    pub missing_price_count: usize,
    pub cheapest_supplier_id: Option<String>,
    pub cheapest_supplier_name: Option<String>,
    pub cheapest_unit_cost_cents: Option<i64>,
    /// Fiyatı olmayan tedarikçilerin adları. Sessiz kayıp bırakmamak için
    /// raporda görünür.
    pub missing_price_suppliers: Vec<String>,
    pub rows: Vec<SupplierPriceRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierInput {
    pub id: Option<String>,
    pub name: String,
    pub contact_person: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub tax_number: Option<String>,
    pub address: Option<String>,
    pub payment_term_days: Option<i64>,
    pub lead_time_days: Option<i64>,
    pub is_active: Option<bool>,
    pub notes: Option<String>,
}

pub async fn upsert_supplier(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: SupplierInput,
) -> Result<Supplier, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("VALIDATION: tedarikçi adı boş olamaz".into());
    }
    let payment_term_days = input.payment_term_days.unwrap_or(0);
    let lead_time_days = input.lead_time_days.unwrap_or(0);
    if payment_term_days < 0 || lead_time_days < 0 {
        return Err("VALIDATION: vade ve teslim süresi negatif olamaz".into());
    }

    let id = match input.id {
        Some(ref existing) => {
            ensure_owned(conn, "suppliers", existing, tenant_id).await?;
            sqlx::query(
                "UPDATE suppliers
                    SET name = ?, contact_person = ?, phone = ?, email = ?,
                        tax_number = ?, address = ?, payment_term_days = ?,
                        lead_time_days = ?, is_active = ?, notes = ?,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(name)
            .bind(&input.contact_person)
            .bind(&input.phone)
            .bind(&input.email)
            .bind(&input.tax_number)
            .bind(&input.address)
            .bind(payment_term_days)
            .bind(lead_time_days)
            .bind(input.is_active.unwrap_or(true))
            .bind(&input.notes)
            .bind(existing)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            existing.clone()
        }
        None => {
            let id = generate_id("sup");
            sqlx::query(
                "INSERT INTO suppliers
                     (id, tenant_id, name, contact_person, phone, email, tax_number,
                      address, payment_term_days, lead_time_days, is_active, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(tenant_id)
            .bind(name)
            .bind(&input.contact_person)
            .bind(&input.phone)
            .bind(&input.email)
            .bind(&input.tax_number)
            .bind(&input.address)
            .bind(payment_term_days)
            .bind(lead_time_days)
            .bind(input.is_active.unwrap_or(true))
            .bind(&input.notes)
            .bind(actor_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
    };

    Ok(Supplier {
        id,
        name: name.to_string(),
        contact_person: input.contact_person,
        phone: input.phone,
        email: input.email,
        tax_number: input.tax_number,
        address: input.address,
        payment_term_days,
        lead_time_days,
        is_active: input.is_active.unwrap_or(true),
        notes: input.notes,
    })
}

pub async fn list_suppliers(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<Supplier>, String> {
    let rows = sqlx::query(
        "SELECT id, name, contact_person, phone, email, tax_number, address,
                payment_term_days, lead_time_days, is_active, notes
           FROM suppliers
          WHERE tenant_id = ?
          ORDER BY is_active DESC, name ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(Supplier {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            contact_person: optional_text(&row, "contact_person")?,
            phone: optional_text(&row, "phone")?,
            email: optional_text(&row, "email")?,
            tax_number: optional_text(&row, "tax_number")?,
            address: optional_text(&row, "address")?,
            payment_term_days: row
                .try_get("payment_term_days")
                .map_err(|e| e.to_string())?,
            lead_time_days: row.try_get("lead_time_days").map_err(|e| e.to_string())?,
            is_active: row.try_get("is_active").map_err(|e| e.to_string())?,
            notes: optional_text(&row, "notes")?,
        });
    }
    Ok(result)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierProductInput {
    pub supplier_id: String,
    pub product_id: String,
    pub unit_cost_cents: i64,
    pub min_order_quantity: Option<f64>,
    pub pack_size: Option<String>,
    pub is_preferred: Option<bool>,
}

/// Tedarikçi fiyatını ekler veya günceller.
///
/// Negatif fiyat kabul edilmez: negatif alış fiyatı, alıcının satıcıya para
/// ödemesi anlamına gelir ve stok maliyetini bozar (AGENTS.md §9 #12 ile aynı
/// gerekçe: negatif fiyat engellenir).
pub async fn set_supplier_product(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: SupplierProductInput,
) -> Result<(), String> {
    if input.unit_cost_cents < 0 {
        return Err("VALIDATION: alış fiyatı negatif olamaz".into());
    }
    let min_order_quantity = input.min_order_quantity.unwrap_or(1.0);
    if !(min_order_quantity.is_finite() && min_order_quantity > 0.0) {
        return Err("VALIDATION: minimum sipariş miktarı sıfırdan büyük olmalı".into());
    }

    ensure_owned(conn, "suppliers", &input.supplier_id, tenant_id).await?;
    ensure_owned(conn, "products", &input.product_id, tenant_id).await?;

    // Bir ürün için yalnızca tek "tercih edilen" tedarikçi olabilir; iki tercih
    // edilen tedarikçi hangisinin kullanılacağını belirsizleştirir.
    if input.is_preferred.unwrap_or(false) {
        sqlx::query(
            "UPDATE supplier_products SET is_preferred = 0
              WHERE tenant_id = ? AND product_id = ? AND supplier_id <> ?",
        )
        .bind(tenant_id)
        .bind(&input.product_id)
        .bind(&input.supplier_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    let mevcut: Option<String> = sqlx::query_scalar(
        "SELECT id FROM supplier_products
          WHERE tenant_id = ? AND supplier_id = ? AND product_id = ?",
    )
    .bind(tenant_id)
    .bind(&input.supplier_id)
    .bind(&input.product_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if mevcut.is_some() {
        sqlx::query(
            "UPDATE supplier_products
                SET unit_cost_cents = ?, min_order_quantity = ?, pack_size = ?,
                    is_preferred = ?, updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = ? AND supplier_id = ? AND product_id = ?",
        )
        .bind(input.unit_cost_cents)
        .bind(min_order_quantity)
        .bind(&input.pack_size)
        .bind(input.is_preferred.unwrap_or(false))
        .bind(tenant_id)
        .bind(&input.supplier_id)
        .bind(&input.product_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    } else {
        sqlx::query(
            "INSERT INTO supplier_products
                 (id, tenant_id, supplier_id, product_id, unit_cost_cents,
                  min_order_quantity, pack_size, is_preferred)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(generate_id("spp"))
        .bind(tenant_id)
        .bind(&input.supplier_id)
        .bind(&input.product_id)
        .bind(input.unit_cost_cents)
        .bind(min_order_quantity)
        .bind(&input.pack_size)
        .bind(input.is_preferred.unwrap_or(false))
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Aynı ürünü satan tedarikçileri fiyata göre sıralar ve farkı hesaplar.
///
/// `annual_volume` verilirse yıllık tasarruf hesaplanır; verilmezse
/// `yearly_saving_cents` `None` olur — hacim bilinmiyken tasarruf uydurulmaz.
pub async fn compare_supplier_prices(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
    annual_volume: Option<f64>,
) -> Result<PriceGap, String> {
    let product_name: String =
        sqlx::query_scalar("SELECT name FROM products WHERE id = ? AND tenant_id = ?")
            .bind(product_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "NOT_FOUND: ürün bulunamadı".to_string())?;

    let rows = sqlx::query(
        "SELECT s.id AS supplier_id, s.name AS supplier_name, sp.unit_cost_cents,
                sp.min_order_quantity, sp.is_preferred,
                s.lead_time_days, s.payment_term_days
           FROM supplier_products sp
           JOIN suppliers s ON s.id = sp.supplier_id AND s.tenant_id = sp.tenant_id
          WHERE sp.tenant_id = ? AND sp.product_id = ? AND s.is_active = 1
          ORDER BY sp.unit_cost_cents ASC",
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut comparison: Vec<SupplierPriceRow> = Vec::new();
    for row in &rows {
        comparison.push(SupplierPriceRow {
            supplier_id: row.try_get("supplier_id").map_err(|e| e.to_string())?,
            supplier_name: row.try_get("supplier_name").map_err(|e| e.to_string())?,
            unit_cost_cents: row.try_get("unit_cost_cents").map_err(|e| e.to_string())?,
            min_order_quantity: row
                .try_get("min_order_quantity")
                .map_err(|e| e.to_string())?,
            lead_time_days: row.try_get("lead_time_days").map_err(|e| e.to_string())?,
            payment_term_days: row
                .try_get("payment_term_days")
                .map_err(|e| e.to_string())?,
            is_preferred: row.try_get("is_preferred").map_err(|e| e.to_string())?,
            premium_over_cheapest_cents: None,
            yearly_saving_cents: None,
        });
    }

    // Fiyatı girilmemiş tedarikçiler: `supplier_products.unit_cost_cents`
    // NOT NULL olduğu için "eksik fiyat" yalnız ürüne hiç fiyat girilmemiş
    // tedarikçide anlamlıdır.
    let eksik: Vec<String> = sqlx::query_scalar(
        "SELECT s.name
           FROM suppliers s
          WHERE s.tenant_id = ? AND s.is_active = 1
            AND s.id NOT IN (
                SELECT sp.supplier_id FROM supplier_products sp
                 WHERE sp.tenant_id = ? AND sp.product_id = ?
            )
          ORDER BY s.name ASC",
    )
    .bind(tenant_id)
    .bind(tenant_id)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let cheapest = comparison.first().cloned();
    for row in comparison.iter_mut() {
        if let Some(ref best) = cheapest {
            let fark = row.unit_cost_cents - best.unit_cost_cents;
            row.premium_over_cheapest_cents = Some(fark);
            row.yearly_saving_cents = annual_volume
                .filter(|volume| volume.is_finite())
                .map(|volume| (fark as f64 * volume).round() as i64);
        }
    }

    Ok(PriceGap {
        product_id: product_id.to_string(),
        product_name,
        compared_count: comparison.len(),
        missing_price_count: eksik.len(),
        cheapest_supplier_id: cheapest.as_ref().map(|row| row.supplier_id.clone()),
        cheapest_supplier_name: cheapest.as_ref().map(|row| row.supplier_name.clone()),
        cheapest_unit_cost_cents: cheapest.as_ref().map(|row| row.unit_cost_cents),
        missing_price_suppliers: eksik,
        rows: comparison,
    })
}
