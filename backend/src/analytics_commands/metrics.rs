//! Faz 10 komut katmanı: rapor merkezi analitikleri (SPEC §34, §25).
//!
//! Bu katman yalnız yetki, kiracı sınırı ve doğrulama yapar; hesaplama
//! `analytics_service` içindedir. Böylece servis saf SQL/logic kalır, komut ise
//! yetki matrisini tek yerde toplar.

use crate::db::DbPool;
use crate::id_generator;
use crate::rbac;
use crate::rbac::Role;
use crate::services::analytics_service as svc;
use crate::services::analytics_service::analytics_types::AnalyticsRange;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Girdi doğrulama
// ---------------------------------------------------------------------------

/// Tarih aralığı. `from`/`to` ISO-8601 metindir; karşılaştırma leksikografiktir
/// ve aynı biçimdeki ISO zaman damgalarıyla doğru sıralanır.
#[derive(Debug, Clone, Deserialize)]
pub struct AnalyticsRangeDto {
    pub from: Option<String>,
    pub to: Option<String>,
}

/// Aralık uçlarının kendi içinde tutarlı olmasını zorunlu kılar. Yalnız bir
/// uç verilmişse hata verilir: kısmi aralık, kasıtsız bir filtre gibi görünür
/// ama raporu sessizce daraltır.
fn parse_range(dto: Option<AnalyticsRangeDto>) -> Result<AnalyticsRange, String> {
    let Some(dto) = dto else {
        return Ok(None);
    };
    match (dto.from, dto.to) {
        (None, None) => Ok(None),
        (Some(from), Some(to)) => {
            if from > to {
                return Err(format!("tarih araligi ters: {from} > {to}"));
            }
            Ok(Some((from, to)))
        }
        _ => Err("tarih araliginda from ve to birlikte verilmelidir".to_string()),
    }
}

/// `YYYY-MM` biçimini zorunlu kılar: yıl sırası ters veya ay 13 olamaz.
fn validate_month(raw: &str) -> Result<(), String> {
    let parts: Vec<&str> = raw.split('-').collect();
    if parts.len() != 2 {
        return Err(format!("ay YYYY-MM biciminde olmali: {raw}"));
    }
    let year: i64 = parts[0].parse().map_err(|_| format!("gecersiz yil: {raw}"))?;
    let month: u32 = parts[1].parse().map_err(|_| format!("gecersiz ay: {raw}"))?;
    if !(1970..=9999).contains(&year) {
        return Err(format!("yil aralik disinda: {raw}"));
    }
    if !(1..=12).contains(&month) {
        return Err(format!("ay 1-12 araliginda olmali: {raw}"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Çıktı DTO'ları (frontend kontratı — snake_case, reportTypes.ts ile birebir)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ProductMarginDto {
    pub product_id: String,
    pub product_name: String,
    pub category_name: String,
    pub units_sold: i64,
    pub revenue_cents: i64,
    pub unit_cost_cents: Option<i64>,
    pub gross_profit_cents: Option<i64>,
    pub margin_percent: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BcgEntryDto {
    pub product_id: String,
    pub product_name: String,
    pub quadrant: String,
    pub quadrant_label: String,
    pub units_sold: i64,
    pub margin_percent: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BcgCountsDto {
    pub star: i64,
    pub plowhorse: i64,
    pub cash_cow: i64,
    pub dog: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CombinationDto {
    pub product_a_id: String,
    pub product_a_name: String,
    pub product_b_id: String,
    pub product_b_name: String,
    pub support: i64,
    pub confidence_percent: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PeakBucketDto {
    pub hour: i64,
    pub revenue_cents: i64,
    pub orders: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetStatusDto {
    pub month: String,
    pub category: String,
    pub target_cents: i64,
    pub actual_cents: i64,
    pub difference_cents: i64,
    pub achieved_percent: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompetitorGapDto {
    pub product_id: String,
    pub product_name: String,
    pub competitor_name: String,
    pub our_price_cents: i64,
    pub competitor_price_cents: i64,
    pub gap_cents: i64,
    pub gap_percent: i64,
    pub observed_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoidLossDto {
    pub voided_cents: i64,
    pub total_cents: i64,
    pub void_rate_percent: Option<i64>,
    pub voided_orders: i64,
    pub total_orders: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsMetricsDto {
    pub from: Option<String>,
    pub to: Option<String>,
    pub currency: String,
    pub product_margins: Vec<ProductMarginDto>,
    pub bcg_matrix: Vec<BcgEntryDto>,
    pub bcg_counts: BcgCountsDto,
    pub combinations: Vec<CombinationDto>,
    pub peak_hours: Vec<PeakBucketDto>,
    pub monthly_targets: Vec<TargetStatusDto>,
    pub competitor_gaps: Vec<CompetitorGapDto>,
    pub void_loss: Option<VoidLossDto>,
}

/// Aylık hedef girdisi.
#[derive(Debug, Clone, Deserialize)]
pub struct MonthTargetInput {
    /// `YYYY-MM`
    pub month: String,
    /// Kategori adı veya tüm kategoriler için `ALL`.
    pub category: String,
    pub target_cents: i64,
}

/// Rakip fiyat gözlemi girdisi.
#[derive(Debug, Clone, Deserialize)]
pub struct CompetitorPriceInput {
    pub product_id: String,
    pub competitor_name: String,
    pub price_cents: i64,
}

// ---------------------------------------------------------------------------
// Yetki
// ---------------------------------------------------------------------------

/// Rapor okuma: yalnız OWNER ve MANAGER (AGENTS.md §6 yetki matrisi, "Raporlar").
/// KITCHEN/WAITER/CASHER rapor göremez; MASTER platform ekranındadır.
fn require_reporting_read(actor_role: &str) -> Result<(), String> {
    rbac::require_any_present(Some(actor_role), &[Role::Owner, Role::Manager]).map(|_| ())
}

/// Rapor yazma: yalnız OWNER. Hedef ve rakip fiyatı işletme politikasıdır;
/// müdür hedefi değiştiremez, aksi halde "hedefi tutturdum" iddiası doğrulanamaz.
fn require_reporting_write(actor_role: &str) -> Result<(), String> {
    rbac::require_any_present(Some(actor_role), &[Role::Owner]).map(|_| ())
}

// ---------------------------------------------------------------------------
// Komutlar
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_analytics_metrics(
    pool: tauri::State<'_, DbPool>,
    tenant_id: String,
    actor_role: String,
    range: Option<AnalyticsRangeDto>,
    min_support: Option<i64>,
) -> Result<AnalyticsMetricsDto, String> {
    require_reporting_read(&actor_role)?;
    let range = parse_range(range)?;
    // Destek eşiği 1'in altına düşürülemez: 0 eşiği her ürün çiftini listelerdi.
    let min_support = min_support.unwrap_or(2).max(1);
    let m = svc::analytics_metrics(&pool, &tenant_id, &range, min_support).await?;

    Ok(AnalyticsMetricsDto {
        from: m.from,
        to: m.to,
        currency: m.currency,
        product_margins: m
            .product_margins
            .into_iter()
            .map(|p| ProductMarginDto {
                product_id: p.product_id,
                product_name: p.product_name,
                category_name: p.category_name,
                units_sold: p.units_sold,
                revenue_cents: p.revenue_cents,
                unit_cost_cents: p.unit_cost_cents,
                gross_profit_cents: p.gross_profit_cents,
                margin_percent: p.margin_percent,
            })
            .collect(),
        bcg_matrix: m
            .bcg_matrix
            .into_iter()
            // Alanlar sırayla taşındığı için etiket önce hesaplanır.
            .map(|b| {
                let label = svc::quadrant_label(b.quadrant).to_string();
                BcgEntryDto {
                    quadrant: format!("{:?}", b.quadrant),
                    quadrant_label: label,
                    product_id: b.product_id,
                    product_name: b.product_name,
                    units_sold: b.units_sold,
                    margin_percent: b.margin_percent,
                }
            })
            .collect(),
        bcg_counts: BcgCountsDto {
            star: m.bcg_counts.star,
            plowhorse: m.bcg_counts.plowhorse,
            cash_cow: m.bcg_counts.cash_cow,
            dog: m.bcg_counts.dog,
        },
        combinations: m
            .combinations
            .into_iter()
            .map(|c| CombinationDto {
                product_a_id: c.product_a_id,
                product_a_name: c.product_a_name,
                product_b_id: c.product_b_id,
                product_b_name: c.product_b_name,
                support: c.support,
                confidence_percent: c.confidence_percent,
            })
            .collect(),
        peak_hours: m
            .peak_hours
            .into_iter()
            .map(|b| PeakBucketDto {
                hour: b.hour,
                revenue_cents: b.revenue_cents,
                orders: b.orders,
            })
            .collect(),
        monthly_targets: m
            .monthly_targets
            .into_iter()
            .map(|t| TargetStatusDto {
                month: t.month,
                category: t.category,
                target_cents: t.target_cents,
                actual_cents: t.actual_cents,
                difference_cents: t.difference_cents,
                achieved_percent: t.achieved_percent,
            })
            .collect(),
        competitor_gaps: m
            .competitor_gaps
            .into_iter()
            .map(|g| CompetitorGapDto {
                product_id: g.product_id,
                product_name: g.product_name,
                competitor_name: g.competitor_name,
                our_price_cents: g.our_price_cents,
                competitor_price_cents: g.competitor_price_cents,
                gap_cents: g.gap_cents,
                gap_percent: g.gap_percent,
                observed_at: g.observed_at,
            })
            .collect(),
        void_loss: m.void_loss.map(|v| VoidLossDto {
            voided_cents: v.voided_cents,
            total_cents: v.total_cents,
            void_rate_percent: v.void_rate_percent,
            voided_orders: v.voided_orders,
            total_orders: v.total_orders,
        }),
    })
}

/// Aylık hedef ekler veya günceller (UPSERT). Aynı kiracı/ay/kategori için
/// tek satır tutulur; hedef sayacı her güncellemede artmaz.
#[tauri::command]
pub async fn set_monthly_target(
    pool: tauri::State<'_, DbPool>,
    tenant_id: String,
    actor_role: String,
    input: MonthTargetInput,
) -> Result<(), String> {
    require_reporting_write(&actor_role)?;
    validate_month(&input.month)?;
    if input.target_cents < 0 {
        return Err("hedef negatif olamaz".to_string());
    }
    // "ALL" yalnız büyük harf saklanır; küçük harf sessizce yanlış kovaya yazılır.
    let category = input.category.trim();
    if category.is_empty() {
        return Err("kategori bos olamaz".to_string());
    }
    let category = if category.eq_ignore_ascii_case("all") {
        "ALL".to_string()
    } else {
        category.to_string()
    };

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO monthly_targets
             (id, tenant_id, month, category, target_cents, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (tenant_id, month, category)
         DO UPDATE SET target_cents = excluded.target_cents,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .bind(id_generator::generate_id("tgt"))
    .bind(&tenant_id)
    .bind(&input.month)
    .bind(&category)
    .bind(input.target_cents)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Rakip fiyat gözlemi ekler. Geçmiş silinmez: her gözlem ayrı satırdır,
/// raporlar ürün+rakip çiftinin en güncel gözlemini kullanır.
#[tauri::command]
pub async fn set_competitor_price(
    pool: tauri::State<'_, DbPool>,
    tenant_id: String,
    actor_role: String,
    input: CompetitorPriceInput,
) -> Result<(), String> {
    require_reporting_write(&actor_role)?;
    if input.price_cents < 0 {
        return Err("rakip fiyat negatif olamaz".to_string());
    }
    let competitor = input.competitor_name.trim();
    if competitor.is_empty() {
        return Err("rakip adi bos olamaz".to_string());
    }
    if input.product_id.trim().is_empty() {
        return Err("urun bos olamaz".to_string());
    }

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    // Ürünün bu kiracıya ait olduğunu doğrula: yabancı ürün kimliği sızdırılamaz.
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM products WHERE tenant_id = ?1 AND id = ?2")
            .bind(&tenant_id)
            .bind(&input.product_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err("urun bulunamadi".to_string());
    }

    sqlx::query(
        "INSERT INTO competitor_prices
             (id, tenant_id, product_id, competitor_name, price_cents, observed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(id_generator::generate_id("cmp"))
    .bind(&tenant_id)
    .bind(&input.product_id)
    .bind(competitor)
    .bind(input.price_cents)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}