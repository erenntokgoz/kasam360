//! Faz 10 analitik servisi — zaman, hedef, rakip fiyat ve iptal bölümü.
//!
//! Bu dosya `analytics_product.rs` ile birlikte `analytics_service` modülünü
//! oluşturur; ikisi de aynı 500 satır sınırına uyar.

use sqlx::{Row, SqlitePool};

use super::analytics_types::{
    AnalyticsRange, CompetitorPriceGap, MonthlyTargetStatus, PeakHourBucket, VoidLossRate,
};
use super::analytics_product::REVENUE_CORE;

// ---------------------------------------------------------------------------
// 2.4 — Yoğun saat kovaları (0–23)
// ---------------------------------------------------------------------------

/// Veri yoksa 24 kova yine de döner; eksik saat "satış yok" demektir, silinmez.
/// Böylece grafik, eksik kova nedeniyle yanlış zaman aralığını göstermez.
pub async fn peak_hours(pool: &SqlitePool,
    tenant_id: &str,
    range: &AnalyticsRange,
) -> Result<Vec<PeakHourBucket>, String>
{
    let (from, to) = super::analytics_product::date_filter(range);
    let sql = format!(
        "SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS hour,
                COUNT(DISTINCT o.id) AS orders,
                SUM(oi.total_cents) AS revenue_cents
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
          WHERE o.tenant_id = ?1 AND o.status IN ('PAID','VOID'){from}{to}
          GROUP BY hour
          ORDER BY hour",
    );

    let rows = sqlx::query(&sql)
        .bind(tenant_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut by_hour: std::collections::HashMap<i64, PeakHourBucket> =
        std::collections::HashMap::new();
    for r in rows {
        let hour: i64 = r.try_get("hour").map_err(|e| e.to_string())?;
        by_hour.insert(
            hour,
            PeakHourBucket {
                hour,
                revenue_cents: r.try_get("revenue_cents").map_err(|e| e.to_string())?,
                orders: r.try_get("orders").map_err(|e| e.to_string())?,
            },
        );
    }

    Ok((0..24)
        .map(|h| {
            by_hour.remove(&h).unwrap_or(PeakHourBucket {
                hour: h,
                revenue_cents: 0,
                orders: 0,
            })
        })
        .collect())
}

// ---------------------------------------------------------------------------
// 2.5 — Aylık hedef gerçekleşme durumu
// ---------------------------------------------------------------------------

/// `ALL` kategorisi tüm kategorileri toplar; kategori satırı kendi adını toplar.
/// Gerçekleşme ciroya göre hesaplanır (`void` tutarları gider olarak kalır).
pub async fn monthly_target_status(pool: &SqlitePool,
    tenant_id: &str,
    month: &str,
) -> Result<Vec<MonthlyTargetStatus>, String>
{
    let rows = sqlx::query(
        "SELECT t.month, t.category, t.target_cents,
                COALESCE((
                    SELECT SUM(oi.total_cents)
                      FROM orders o
                      JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
                      JOIN products p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id
                      LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id = o.tenant_id
                     WHERE o.tenant_id = ?1
                       AND o.status IN ('PAID','VOID')
                       AND strftime('%Y-%m', o.created_at) = ?2
                       AND (t.category = 'ALL' OR c.name = t.category)
                ), 0) AS actual_cents
           FROM monthly_targets t
          WHERE t.tenant_id = ?1 AND t.month = ?2
          ORDER BY t.category",
    )
    .bind(tenant_id)
    .bind(month)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let target_cents: i64 = r.try_get("target_cents").map_err(|e| e.to_string())?;
        let actual_cents: i64 = r.try_get("actual_cents").map_err(|e| e.to_string())?;
        // Hedef 0 ise oran hesaplanamaz: "sınırsız aşıldı" değil, tanım eksik.
        let achieved_percent = if target_cents > 0 {
            Some((actual_cents as f64 / target_cents as f64 * 100.0).round() as i64)
        } else {
            None
        };
        out.push(MonthlyTargetStatus {
            month: r.try_get("month").map_err(|e| e.to_string())?,
            category: r.try_get("category").map_err(|e| e.to_string())?,
            target_cents,
            actual_cents,
            difference_cents: actual_cents - target_cents,
            achieved_percent,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// 2.6 — Rakip fiyat farkı
// ---------------------------------------------------------------------------

/// `gap_cents = bizim - rakip`: negatifse biz daha pahalıyız. Her ürün+rakip
/// için yalnız **en güncel** gözlem kullanılır; geçmiş silinmez.
pub async fn competitor_price_gaps(pool: &SqlitePool,
    tenant_id: &str,
) -> Result<Vec<CompetitorPriceGap>, String>
{
    let rows = sqlx::query(
        "SELECT cp.product_id,
                COALESCE(p.name, cp.product_id) AS product_name,
                p.price_cents AS our_price_cents,
                cp.competitor_name,
                cp.price_cents AS competitor_price_cents,
                cp.observed_at
           FROM competitor_prices cp
           JOIN products p ON p.id = cp.product_id AND p.tenant_id = cp.tenant_id
          WHERE cp.tenant_id = ?1
            AND cp.observed_at = (
                SELECT MAX(cp2.observed_at) FROM competitor_prices cp2
                 WHERE cp2.tenant_id = cp.tenant_id
                   AND cp2.product_id = cp.product_id
                   AND cp2.competitor_name = cp.competitor_name)
          ORDER BY cp.product_id, cp.competitor_name",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let our_price_cents: i64 = r.try_get("our_price_cents").map_err(|e| e.to_string())?;
        let competitor_price_cents: i64 = r
            .try_get("competitor_price_cents")
            .map_err(|e| e.to_string())?;
        let gap_cents = our_price_cents - competitor_price_cents;
        // Yüzde, rakip fiyatına göre normalize edilir; rakip 0 ise oran tanımsızdır.
        let gap_percent = if competitor_price_cents > 0 {
            (gap_cents as f64 / competitor_price_cents as f64 * 100.0).round() as i64
        } else {
            0
        };
        out.push(CompetitorPriceGap {
            product_id: r.try_get("product_id").map_err(|e| e.to_string())?,
            product_name: r.try_get("product_name").map_err(|e| e.to_string())?,
            competitor_name: r.try_get("competitor_name").map_err(|e| e.to_string())?,
            our_price_cents,
            competitor_price_cents,
            gap_cents,
            gap_percent,
            observed_at: r.try_get("observed_at").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// 2.7 — İptal (void) kayıp oranı
// ---------------------------------------------------------------------------

/// Toplam ciro 0 ise oran `None`: "sıfır kayıp" değil, "hesaplanamaz".
/// Sayaçlar da ciroyla aynı evreni kullanır (`PAID` + `VOID`), böylece
/// `voided_orders / total_orders` her zaman ciro oranıyla tutarlıdır.
pub async fn void_loss_rate(pool: &SqlitePool,
    tenant_id: &str,
    range: &AnalyticsRange,
) -> Result<VoidLossRate, String>
{
    let (from, to) = super::analytics_product::date_filter(range);
    let sql = format!(
        "SELECT
           COALESCE(SUM(CASE WHEN o.status = 'VOID' THEN oi.total_cents ELSE 0 END), 0) AS voided_cents,
           COALESCE(SUM(CASE WHEN o.status = 'VOID' THEN oi.total_cents ELSE 0 END), 0)
           + COALESCE(SUM(CASE WHEN o.status = 'PAID' THEN oi.total_cents ELSE 0 END), 0) AS total_cents,
           COUNT(DISTINCT CASE WHEN o.status = 'VOID' THEN o.id END) AS voided_orders,
           COUNT(DISTINCT o.id) AS total_orders
         {REVENUE_CORE}{from}{to}",
    );
    let r = sqlx::query(&sql)
        .bind(tenant_id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

    let voided_cents: i64 = r.try_get("voided_cents").map_err(|e| e.to_string())?;
    let total_cents: i64 = r.try_get("total_cents").map_err(|e| e.to_string())?;
    let void_rate_percent = if total_cents > 0 {
        Some((voided_cents as f64 / total_cents as f64 * 100.0).round() as i64)
    } else {
        None
    };
    Ok(VoidLossRate {
        voided_cents,
        total_cents,
        void_rate_percent,
        voided_orders: r.try_get("voided_orders").map_err(|e| e.to_string())?,
        total_orders: r.try_get("total_orders").map_err(|e| e.to_string())?,
    })
}

// ---------------------------------------------------------------------------
// Zaman yardımcısı
// ---------------------------------------------------------------------------

/// Hedefler ve rakip fiyatları ay bazında yönetilir; UTC ayı kullanılır.
pub fn current_month() -> String {
    chrono::Utc::now().format("%Y-%m").to_string()
}