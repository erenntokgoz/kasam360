//! Elle açılıp kapanan tarife: gündüz, gece, canlı müzik veya özel.
//!
//! Neden dinamik kuraldan ayrı: kural saate bağlı çalışır ve yalnız indirim yapar.
//! Canlı müzik gecesi takvimden okunamaz; patron "şimdi" der ve zam da gerekir. Saat
//! tahmini yerine açık düğme, kasiyerin müşteriye fiyatı savunmasını da kolaylaştırır.
//!
//! Aynı anda tek tarife açıktır. İki tarife üst üste binerse fiyatın nereden geldiği
//! söylenemez; bunu veritabanındaki kısmi tekil indeks de garanti eder.
//!
//! Tarife yalnız bundan sonra adisyona eklenen kalemi etkiler: kalem fiyatı eklendiği
//! anda `order_items` satırına yazılır (AGENTS.md §7.5).

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;

const VALID_KINDS: [&str; 4] = ["GUNDUZ", "GECE", "CANLI_MUZIK", "OZEL"];
const MIN_PERCENT: i64 = -90;
const MAX_PERCENT: i64 = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TariffInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
    pub percent: i64,
    /// Boş veya yok: tüm ürünler.
    pub product_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PriceTariff {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub percent: i64,
    pub product_ids: Vec<String>,
    pub is_active: bool,
    pub activated_at: Option<String>,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<PriceTariff, String> {
    let product_ids: Option<String> = row.try_get("product_ids").map_err(text_error)?;
    Ok(PriceTariff {
        id: row.try_get("id").map_err(text_error)?,
        name: row.try_get("name").map_err(text_error)?,
        kind: row.try_get("kind").map_err(text_error)?,
        percent: row.try_get("percent").map_err(text_error)?,
        product_ids: product_ids
            .map(|ids| ids.split(',').map(str::to_string).collect())
            .unwrap_or_default(),
        is_active: row.try_get("is_active").map_err(text_error)?,
        activated_at: row.try_get("activated_at").map_err(text_error)?,
    })
}

/// Kuruşun altı atılır: yuvarlama farkı müşterinin lehinedir ve iki cihaz aynı sonucu bulur.
pub(super) fn apply_percent(base_cents: i64, percent: i64) -> Result<i64, String> {
    i64::try_from(i128::from(base_cents) * i128::from(100 + percent) / 100)
        .map_err(|_| "OVERFLOW: tarife fiyatı taştı".to_string())
}

pub async fn list_tariffs(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<PriceTariff>, String> {
    let rows = sqlx::query(
        "SELECT id, name, kind, percent, product_ids, is_active, activated_at
           FROM price_tariffs WHERE tenant_id = ?
          ORDER BY is_active DESC, created_at ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter().map(from_row).collect()
}

pub async fn active_tariff(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Option<PriceTariff>, String> {
    let row = sqlx::query(
        "SELECT id, name, kind, percent, product_ids, is_active, activated_at
           FROM price_tariffs WHERE tenant_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    row.as_ref().map(from_row).transpose()
}

async fn ensure_products(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_ids: &[String],
) -> Result<(), String> {
    for product_id in product_ids {
        if product_id.contains(',') {
            return Err("VALIDATION: ürün kimliği geçersiz".into());
        }
        ensure_owned(conn, "products", product_id, tenant_id).await?;
    }
    Ok(())
}

pub async fn save_tariff(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: TariffInput,
) -> Result<String, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("VALIDATION: tarife adı boş olamaz".into());
    }
    if !VALID_KINDS.contains(&input.kind.as_str()) {
        return Err("VALIDATION: tarife türü geçersiz".into());
    }
    if input.percent == 0 || !(MIN_PERCENT..=MAX_PERCENT).contains(&input.percent) {
        return Err(format!(
            "VALIDATION: oran {MIN_PERCENT} ile {MAX_PERCENT} arasında olmalı ve sıfır olamaz"
        ));
    }
    let products = input.product_ids.unwrap_or_default();
    ensure_products(conn, tenant_id, &products).await?;
    let stored = (!products.is_empty()).then(|| products.join(","));

    match input.id {
        Some(id) => {
            ensure_owned(conn, "price_tariffs", &id, tenant_id).await?;
            // Açık tarife değişirse aynı gece iki fiyat oluşur; önce kapatılır.
            let changed = sqlx::query(
                "UPDATE price_tariffs
                    SET name = ?, kind = ?, percent = ?, product_ids = ?,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND tenant_id = ? AND is_active = 0",
            )
            .bind(name)
            .bind(&input.kind)
            .bind(input.percent)
            .bind(&stored)
            .bind(&id)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
            if changed.rows_affected() == 0 {
                return Err("CONFLICT: açık tarife değiştirilemez, önce kapatın".into());
            }
            Ok(id)
        }
        None => {
            let id = generate_id("trf");
            sqlx::query(
                "INSERT INTO price_tariffs
                     (id, tenant_id, name, kind, percent, product_ids, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(tenant_id)
            .bind(name)
            .bind(&input.kind)
            .bind(input.percent)
            .bind(&stored)
            .bind(actor_id)
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
            Ok(id)
        }
    }
}

/// `tariff_id` yoksa açık tarife kapanır ve menü fiyatına dönülür.
pub async fn set_active_tariff(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    tariff_id: Option<&str>,
) -> Result<(), String> {
    if let Some(id) = tariff_id {
        ensure_owned(conn, "price_tariffs", id, tenant_id).await?;
    }
    sqlx::query(
        "UPDATE price_tariffs SET is_active = 0, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    if let Some(id) = tariff_id {
        sqlx::query(
            "UPDATE price_tariffs
                SET is_active = 1, activated_at = ?, activated_by = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND tenant_id = ?",
        )
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(actor_id)
        .bind(id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    }
    Ok(())
}

pub async fn delete_tariff(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    tariff_id: &str,
) -> Result<(), String> {
    ensure_owned(conn, "price_tariffs", tariff_id, tenant_id).await?;
    let removed =
        sqlx::query("DELETE FROM price_tariffs WHERE id = ? AND tenant_id = ? AND is_active = 0")
            .bind(tariff_id)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
    if removed.rows_affected() == 0 {
        return Err("CONFLICT: açık tarife silinemez, önce kapatın".into());
    }
    Ok(())
}
