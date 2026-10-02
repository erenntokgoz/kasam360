//! Faz 10 analitik servisi — giriş noktası.
//!
//! Hesap mantığı iki modüle bölünmüştür; bu dosya yalnız birleştirir ve
//! dışarıya açtığı yüzeyi tanımlar. Böylece hiçbiri 500 satır sınırını aşmaz.
//!
//! - `analytics_product`: ürün marjı, BCG, ürün kombinasyonları
//! - `analytics_time`: yoğun saat, aylık hedef, rakip fiyat, void oranı
//!
//! Finansal kural (AGENTS.md §3.4): bilinmeyen maliyet, hedef oranı veya
//! ciro 0'a dönüştürülmez; `None`/`NULL` olarak yukarı taşınır.

pub mod analytics_product;
#[cfg(test)]
mod analytics_product_tests;
pub mod analytics_time;
#[cfg(test)]
mod analytics_time_tests;
pub mod analytics_types;

use sqlx::SqlitePool;

use analytics_types::{AnalyticsMetrics, AnalyticsRange};

pub use analytics_product::{
    bcg_classify, bcg_counts, combinations, median, product_margins,
};
pub use analytics_time::{
    competitor_price_gaps, current_month, monthly_target_status, peak_hours, void_loss_rate,
};
pub use analytics_types::{
    quadrant_label, AnalyticsMetrics as Metrics, BcgCounts, BcgEntry, BcgQuadrant,
    CompetitorPriceGap, MonthlyTargetStatus, PeakHourBucket, ProductCombination, ProductMargin,
    VoidLossRate,
};

/// Tüm metrikleri tek çağrıda toplar.
///
/// `min_support` kombinasyon eşiğidir; 0 veya negatif değer SQL'de 1'e
/// çekilir, aksi halde "her ürün her ürünle birlikte" gürültüsü rapora girer.
pub async fn analytics_metrics(pool: &SqlitePool,
    tenant_id: &str,
    range: &AnalyticsRange,
    min_support: i64,
) -> Result<AnalyticsMetrics, String>
{
    let margins = product_margins(pool, tenant_id, range).await?;
    let bcg_matrix = bcg_classify(&margins)?;
    let counts = bcg_counts(&bcg_matrix);
    let combos = combinations(pool, tenant_id, range, min_support).await?;
    let hours = peak_hours(pool, tenant_id, range).await?;
    let targets = monthly_target_status(pool, tenant_id, &current_month()).await?;
    let gaps = competitor_price_gaps(pool, tenant_id).await?;
    let void_loss = void_loss_rate(pool, tenant_id, range).await?;

    // Aralık verilmediyse ekranda gösterilecek tarih de yoktur; sunucu saati
    // değil, kullanıcının seçimi belirler.
    Ok(AnalyticsMetrics {
        from: range.as_ref().map(|(from, _)| from.clone()),
        to: range.as_ref().map(|(_, to)| to.clone()),
        currency: "TRY".to_string(),
        product_margins: margins,
        bcg_matrix,
        bcg_counts: counts,
        combinations: combos,
        peak_hours: hours,
        monthly_targets: targets,
        competitor_gaps: gaps,
        void_loss: Some(void_loss),
    })
}