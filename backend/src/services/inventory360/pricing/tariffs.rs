//! Tarife elle ya da belirlenen saat, gün ve tarih aralığında kendiliğinden açılır.
//! Elle açılan tarife, o an penceresi gelen zamanlı tarifenin önüne geçer.
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
    #[serde(default)]
    pub schedule: Option<TariffSchedule>,
}

/// Boş alan sınır koymaz. `enabled` kapalıyken ayarlar silinmeden tarife durur.
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TariffSchedule {
    pub enabled: bool,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub days_of_week: Vec<u32>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
}

impl TariffSchedule {
    /// Gece yarısını aşan aralıkta (22:00-02:00) sabah kısmı önceki günün saatidir.
    fn covers(&self, time: &str, date: &str, weekday: u32) -> bool {
        let in_dates = self.valid_from.as_deref().is_none_or(|from| date >= from)
            && self.valid_to.as_deref().is_none_or(|to| date <= to);
        let (in_time, day) = match (self.start_time.as_deref(), self.end_time.as_deref()) {
            (Some(start), Some(end)) if start < end => (time >= start && time < end, weekday),
            (Some(start), Some(end)) if time < end && time < start => {
                (true, if weekday == 1 { 7 } else { weekday - 1 })
            }
            (Some(start), Some(_)) => (time >= start, weekday),
            _ => (true, weekday),
        };
        self.enabled
            && in_dates
            && in_time
            && (self.days_of_week.is_empty() || self.days_of_week.contains(&day))
    }

    fn validate(&self) -> Result<(), String> {
        let is_time = |value: &str| chrono::NaiveTime::parse_from_str(value, "%H:%M").is_ok();
        let is_date = |value: &str| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok();
        match (self.start_time.as_deref(), self.end_time.as_deref()) {
            (None, None) => {}
            (Some(start), Some(end)) if is_time(start) && is_time(end) && start != end => {}
            _ => return Err("VALIDATION: başlangıç ve bitiş saati geçersiz".into()),
        }
        if self.valid_from.as_deref().is_some_and(|d| !is_date(d))
            || self.valid_to.as_deref().is_some_and(|d| !is_date(d))
        {
            return Err("VALIDATION: tarih geçersiz".into());
        }
        if let (Some(from), Some(to)) = (&self.valid_from, &self.valid_to) {
            if from > to {
                return Err("VALIDATION: bitiş tarihi başlangıçtan önce olamaz".into());
            }
        }
        if self.days_of_week.iter().any(|day| !(1..=7).contains(day)) {
            return Err("VALIDATION: gün geçersiz".into());
        }
        Ok(())
    }
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
    pub schedule: Option<TariffSchedule>,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<PriceTariff, String> {
    let product_ids: Option<String> = row.try_get("product_ids").map_err(text_error)?;
    let days: Option<String> = row.try_get("days_of_week").map_err(text_error)?;
    let schedule = TariffSchedule {
        enabled: row.try_get("schedule_on").map_err(text_error)?,
        start_time: row.try_get("start_time").map_err(text_error)?,
        end_time: row.try_get("end_time").map_err(text_error)?,
        days_of_week: days
            .iter()
            .flat_map(|list| list.split(','))
            .filter_map(|day| day.parse().ok())
            .collect(),
        valid_from: row.try_get("valid_from").map_err(text_error)?,
        valid_to: row.try_get("valid_to").map_err(text_error)?,
    };
    let has_schedule = schedule.start_time.is_some()
        || schedule.valid_from.is_some()
        || schedule.valid_to.is_some()
        || !schedule.days_of_week.is_empty();
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
        schedule: has_schedule.then_some(schedule),
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
        "SELECT id, name, kind, percent, product_ids, is_active, activated_at,
                schedule_on, start_time, end_time, days_of_week, valid_from, valid_to
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
    tariff_at(conn, tenant_id, chrono::Local::now()).await
}

/// Önce elle açılan, yoksa penceresi gelen en yeni zamanlı tarife geçerlidir.
pub(super) async fn tariff_at(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    now: chrono::DateTime<chrono::Local>,
) -> Result<Option<PriceTariff>, String> {
    use chrono::Datelike;
    let rows = sqlx::query(
        "SELECT id, name, kind, percent, product_ids, is_active, activated_at,
                schedule_on, start_time, end_time, days_of_week, valid_from, valid_to
           FROM price_tariffs WHERE tenant_id = ? AND (is_active = 1 OR schedule_on = 1)
          ORDER BY is_active DESC, created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    let time = now.format("%H:%M").to_string();
    let date = now.format("%Y-%m-%d").to_string();
    let weekday = now.weekday().number_from_monday();
    for row in &rows {
        let tariff = from_row(row)?;
        let is_due = tariff
            .schedule
            .as_ref()
            .is_some_and(|plan| plan.covers(&time, &date, weekday));
        if tariff.is_active || is_due {
            return Ok(Some(tariff));
        }
    }
    Ok(None)
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
    let schedule = input.schedule.unwrap_or_default();
    schedule.validate()?;
    let days = (!schedule.days_of_week.is_empty()).then(|| {
        let list: Vec<String> = schedule.days_of_week.iter().map(u32::to_string).collect();
        list.join(",")
    });
    let products = input.product_ids.unwrap_or_default();
    ensure_products(conn, tenant_id, &products).await?;
    let stored = (!products.is_empty()).then(|| products.join(","));

    match input.id {
        Some(id) => {
            ensure_owned(conn, "price_tariffs", &id, tenant_id).await?;
            // Açık tarife değişirse aynı gece iki fiyat oluşur; önce kapatılır.
            let changed = sqlx::query(
                "UPDATE price_tariffs
                    SET name = ?, kind = ?, percent = ?, product_ids = ?, schedule_on = ?,
                        start_time = ?, end_time = ?, days_of_week = ?, valid_from = ?,
                        valid_to = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND tenant_id = ? AND is_active = 0",
            )
            .bind(name)
            .bind(&input.kind)
            .bind(input.percent)
            .bind(&stored)
            .bind(schedule.enabled)
            .bind(&schedule.start_time)
            .bind(&schedule.end_time)
            .bind(&days)
            .bind(&schedule.valid_from)
            .bind(&schedule.valid_to)
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
                     (id, tenant_id, name, kind, percent, product_ids, created_by, schedule_on,
                      start_time, end_time, days_of_week, valid_from, valid_to)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(tenant_id)
            .bind(name)
            .bind(&input.kind)
            .bind(input.percent)
            .bind(&stored)
            .bind(actor_id)
            .bind(schedule.enabled)
            .bind(&schedule.start_time)
            .bind(&schedule.end_time)
            .bind(&days)
            .bind(&schedule.valid_from)
            .bind(&schedule.valid_to)
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
