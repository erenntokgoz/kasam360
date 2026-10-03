use sqlx::{Row, SqliteConnection};

use super::windows::active_service_window;
use super::{EffectivePrice, PriceSource};
use crate::services::inventory360::optional_text;

pub(super) struct PricingRuleRow {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub discount_percent: i64,
    pub start_time: String,
    pub end_time: String,
    pub days_of_week: Option<String>,
    pub product_ids: Option<String>,
    pub category_ids: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub is_active: bool,
}
/// HH:MM karsilastirmasi metin sirasiyla yapilabilir (9:30 < 10:00),
/// bu yuzden ayristirma gerekmez. Gece yarisi asan kural (22:00-02:00)
/// iki parcaya bolunur, aksi halde hic calismaz.

fn rule_applies_now(rule: &PricingRuleRow, now_time: &str, now_date: &str, weekday: u32) -> bool {
    if !rule.is_active {
        return false;
    }
    if let Some(ref from) = rule.valid_from {
        if now_date < from.as_str() {
            return false;
        }
    }
    if let Some(ref to) = rule.valid_to {
        if now_date > to.as_str() {
            return false;
        }
    }
    if let Some(ref days) = rule.days_of_week {
        let gunler: Vec<&str> = days.split(',').map(|d| d.trim()).collect();
        let bulundu = gunler
            .iter()
            .any(|gun| gun.parse::<u32>().map(|n| n == weekday).unwrap_or(false));
        if !bulundu {
            return false;
        }
    }

    let (baslangic, bitis) = (rule.start_time.as_str(), rule.end_time.as_str());
    if bitis > baslangic {
        now_time >= baslangic && now_time < bitis
    } else {
        // Gece yarısını aşan kural: akşam kısmı ya da sabah kısmında olmalı.
        now_time >= baslangic || now_time < bitis
    }
}

fn id_listi_contains(ham: &Option<String>, id: &str) -> bool {
    match ham {
        Some(liste) => liste.split(',').any(|adet| adet.trim() == id),
        None => false,
    }
}

/// Ürünün o an geçerli fiyatını çözer ve kaynağını döndürür.
///
/// `now` verilmezse sistem saati kullanılır. Testlerin deterministik olması
/// için zaman dışarıdan verilebilir.
pub async fn effective_price(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
    now: Option<chrono::DateTime<chrono::Local>>,
) -> Result<EffectivePrice, String> {
    let row = sqlx::query(
        "SELECT price_cents, is_86, stockout_reason FROM products WHERE id = ? AND tenant_id = ?",
    )
    .bind(product_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: ürün bulunamadı".to_string())?;

    let base_price_cents: i64 = row.try_get("price_cents").map_err(|e| e.to_string())?;
    let is_86d: bool = row.try_get("is_86").map_err(|e| e.to_string())?;
    let stockout_reason = optional_text(&row, "stockout_reason")?;

    let simdi = now.unwrap_or_else(chrono::Local::now);
    let now_time = simdi.format("%H:%M").to_string();
    let now_date = simdi.format("%Y-%m-%d").to_string();
    // ISO hafta günü: 1 = Pazartesi ... 7 = Pazar
    let weekday = simdi.format("%u").to_string().parse::<u32>().unwrap_or(1);

    // 1) Fiyat dondurma: taahhüt en güçlü sinyaldir.
    let dondurma: Option<i64> = sqlx::query_scalar(
        "SELECT frozen_price_cents FROM price_freezes
          WHERE tenant_id = ? AND product_id = ? AND is_active = 1
            AND valid_from <= ? AND valid_to >= ?
          ORDER BY valid_to DESC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(&now_date)
    .bind(&now_date)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(frozen) = dondurma {
        return Ok(EffectivePrice {
            product_id: product_id.to_string(),
            base_price_cents,
            final_price_cents: frozen,
            source: PriceSource::Frozen,
            discount_cents: base_price_cents.saturating_sub(frozen),
            rule_id: None,
            rule_name: None,
            is_86d,
            stockout_reason,
            service_window: active_service_window(conn, tenant_id, now_time.as_str()).await?,
        });
    }

    // 2) Dinamik kural (happy hour dahil). Öncelik yüksek olan kazanır.
    let rule_rows = sqlx::query(
        "SELECT id, name, kind, discount_percent, start_time, end_time, days_of_week,
                product_ids, category_ids, valid_from, valid_to, is_active, priority
           FROM dynamic_pricing_rules
          WHERE tenant_id = ? AND is_active = 1
          ORDER BY priority DESC, discount_percent DESC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let category_id: String =
        sqlx::query_scalar("SELECT category_id FROM products WHERE id = ? AND tenant_id = ?")
            .bind(product_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_default();

    for raw in &rule_rows {
        let rule = PricingRuleRow {
            id: raw.try_get("id").map_err(|e| e.to_string())?,
            name: raw.try_get("name").map_err(|e| e.to_string())?,
            kind: raw.try_get("kind").map_err(|e| e.to_string())?,
            discount_percent: raw.try_get("discount_percent").map_err(|e| e.to_string())?,
            start_time: raw.try_get("start_time").map_err(|e| e.to_string())?,
            end_time: raw.try_get("end_time").map_err(|e| e.to_string())?,
            days_of_week: optional_text(raw, "days_of_week")?,
            product_ids: optional_text(raw, "product_ids")?,
            category_ids: optional_text(raw, "category_ids")?,
            valid_from: optional_text(raw, "valid_from")?,
            valid_to: optional_text(raw, "valid_to")?,
            is_active: raw.try_get("is_active").map_err(|e| e.to_string())?,
        };

        // Kural ürüne veya kategoriye sınırlıysa eşleşmeli; sınırsızsa tüm menüye
        // uygulanır.
        let hedefli = id_listi_contains(&rule.product_ids, product_id)
            || id_listi_contains(&rule.category_ids, &category_id);
        let hedefsiz = rule.product_ids.is_none() && rule.category_ids.is_none();
        if !hedefli && !hedefsiz {
            continue;
        }
        if !rule_applies_now(&rule, now_time.as_str(), now_date.as_str(), weekday) {
            continue;
        }

        // İndirim kuruş üzerinden hesaplanır ve aşağı yuvarlanır: 1 kuruş
        // kazanç müşteriye düşer, işletmeye değil.
        let discounted =
            (base_price_cents as f64 * (100 - rule.discount_percent) as f64 / 100.0).floor() as i64;

        return Ok(EffectivePrice {
            product_id: product_id.to_string(),
            base_price_cents,
            final_price_cents: discounted,
            source: PriceSource::DynamicRule,
            discount_cents: base_price_cents.saturating_sub(discounted),
            rule_id: Some(rule.id),
            rule_name: Some(format!("{} ({})", rule.name, rule.kind)),
            is_86d,
            stockout_reason,
            service_window: active_service_window(conn, tenant_id, now_time.as_str()).await?,
        });
    }

    // 3) Aktif fiyat listesi
    let today = now_date.as_str();
    let liste_fiyat: Option<i64> = sqlx::query_scalar(
        "SELECT pli.price_cents
           FROM price_list_items pli
           JOIN price_lists pl ON pl.id = pli.price_list_id AND pl.tenant_id = pli.tenant_id
          WHERE pli.tenant_id = ? AND pli.product_id = ? AND pl.is_active = 1
            AND (pl.valid_from IS NULL OR pl.valid_from <= ?)
            AND (pl.valid_to IS NULL OR pl.valid_to >= ?)
          ORDER BY pli.price_cents ASC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(product_id)
    .bind(today)
    .bind(today)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let (final_price_cents, source) = match liste_fiyat {
        Some(price) => (price, PriceSource::PriceList),
        None => (base_price_cents, PriceSource::ProductPrice),
    };

    Ok(EffectivePrice {
        product_id: product_id.to_string(),
        base_price_cents,
        final_price_cents,
        source,
        discount_cents: base_price_cents.saturating_sub(final_price_cents),
        rule_id: None,
        rule_name: None,
        is_86d,
        stockout_reason,
        service_window: active_service_window(conn, tenant_id, now_time.as_str()).await?,
    })
}
