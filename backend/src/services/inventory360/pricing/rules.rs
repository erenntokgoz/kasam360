use serde::Deserialize;
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::optional_text;

use super::PricingRule;

pub(super) const GECERLI_KURAL_TURLERI: [&str; 4] = ["HAPPY_HOUR", "OGLE", "AKSAM", "OZEL"];

/// `HH:MM` biçimini doğrular. Serbest metin kabul edilmez: bozuk saat
/// karşılaştırması sessizce kuralı hiç uygulamaz ve happy hour hiç çalışmaz.
pub(super) fn validate_time(value: &str) -> Result<(), String> {
    let parcalar: Vec<&str> = value.split(':').collect();
    if parcalar.len() != 2 {
        return Err(format!("VALIDATION: saat SS:DD biçiminde değil: {value}"));
    }
    let saat: u32 = parcalar[0]
        .parse()
        .map_err(|_| format!("VALIDATION: saat okunamadı: {value}"))?;
    let dakika: u32 = parcalar[1]
        .parse()
        .map_err(|_| format!("VALIDATION: dakika okunamadı: {value}"))?;
    if saat > 23 || dakika > 59 {
        return Err(format!("VALIDATION: saat aralık dışında: {value}"));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingRuleInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: Option<String>,
    pub discount_percent: i64,
    pub start_time: String,
    pub end_time: String,
    pub days_of_week: Option<String>,
    pub product_ids: Option<String>,
    pub category_ids: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub is_active: Option<bool>,
    pub priority: Option<i64>,
}
pub async fn upsert_pricing_rule(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: PricingRuleInput,
) -> Result<PricingRule, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("VALIDATION: kural adı boş olamaz".into());
    }
    let kind = input.kind.unwrap_or_else(|| "HAPPY_HOUR".to_string());
    if !GECERLI_KURAL_TURLERI.contains(&kind.as_str()) {
        return Err(format!(
            "VALIDATION: kural türü geçersiz, izin verilenler: {}",
            GECERLI_KURAL_TURLERI.join(", ")
        ));
    }
    // %100 ve üzeri indirim fiyat sıfırlamadır; komisyon ve KDV tabanını
    // bozduğu için kapsam dışı bırakıldı.
    if input.discount_percent <= 0 || input.discount_percent > 90 {
        return Err("VALIDATION: indirim 1-90 arasında olmalı".into());
    }
    validate_time(&input.start_time)?;
    validate_time(&input.end_time)?;
    // Bitiş başlangıçtan **önce** olabilir: gece yarısını aşan pencere
    // ("22:00"–"02:00") yalnız bu şekilde yazılabilir. Eşitlik ise sıfır
    // uzunluklu penc demektir ve kural hiç çalışmaz.
    if input.end_time == input.start_time {
        return Err("VALIDATION: kural bitiş saati başlangıçtan farklı olmalı".into());
    }

    let is_active = input.is_active.unwrap_or(true);
    let priority = input.priority.unwrap_or(100);

    let id = match input.id {
        Some(ref existing) => {
            ensure_owned(conn, "dynamic_pricing_rules", existing, tenant_id).await?;
            sqlx::query(
                "UPDATE dynamic_pricing_rules
                    SET name = ?, kind = ?, discount_percent = ?, start_time = ?,
                        end_time = ?, days_of_week = ?, product_ids = ?,
                        category_ids = ?, valid_from = ?, valid_to = ?, is_active = ?,
                        priority = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(name)
            .bind(&kind)
            .bind(input.discount_percent)
            .bind(&input.start_time)
            .bind(&input.end_time)
            .bind(&input.days_of_week)
            .bind(&input.product_ids)
            .bind(&input.category_ids)
            .bind(&input.valid_from)
            .bind(&input.valid_to)
            .bind(is_active)
            .bind(priority)
            .bind(existing)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            existing.clone()
        }
        None => {
            let id = generate_id("dpr");
            sqlx::query(
                "INSERT INTO dynamic_pricing_rules
                     (id, tenant_id, name, kind, discount_percent, start_time, end_time,
                      days_of_week, product_ids, category_ids, valid_from, valid_to,
                      is_active, priority, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(tenant_id)
            .bind(name)
            .bind(&kind)
            .bind(input.discount_percent)
            .bind(&input.start_time)
            .bind(&input.end_time)
            .bind(&input.days_of_week)
            .bind(&input.product_ids)
            .bind(&input.category_ids)
            .bind(&input.valid_from)
            .bind(&input.valid_to)
            .bind(is_active)
            .bind(priority)
            .bind(actor_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
    };

    Ok(PricingRule {
        id,
        name: name.to_string(),
        kind,
        discount_percent: input.discount_percent,
        start_time: input.start_time,
        end_time: input.end_time,
        days_of_week: input.days_of_week,
        product_ids: input.product_ids,
        category_ids: input.category_ids,
        valid_from: input.valid_from,
        valid_to: input.valid_to,
        is_active,
        priority,
    })
}

pub async fn list_pricing_rules(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<PricingRule>, String> {
    let rows = sqlx::query(
        "SELECT id, name, kind, discount_percent, start_time, end_time, days_of_week,
                product_ids, category_ids, valid_from, valid_to, is_active, priority
           FROM dynamic_pricing_rules
          WHERE tenant_id = ?
          ORDER BY is_active DESC, priority DESC, start_time ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(PricingRule {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            kind: row.try_get("kind").map_err(|e| e.to_string())?,
            discount_percent: row.try_get("discount_percent").map_err(|e| e.to_string())?,
            start_time: row.try_get("start_time").map_err(|e| e.to_string())?,
            end_time: row.try_get("end_time").map_err(|e| e.to_string())?,
            days_of_week: optional_text(&row, "days_of_week")?,
            product_ids: optional_text(&row, "product_ids")?,
            category_ids: optional_text(&row, "category_ids")?,
            valid_from: optional_text(&row, "valid_from")?,
            valid_to: optional_text(&row, "valid_to")?,
            is_active: row.try_get("is_active").map_err(|e| e.to_string())?,
            priority: row.try_get("priority").map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}
