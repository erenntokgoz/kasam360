//! Faz 10 analitik servisi — BCG ve kombinasyon bölümü (SPEC §34, §25).
//!
//! Tüm sorgular `tenant_id` ile filtrelenir; hiçbir para değeri float olarak
//! taşınmaz. Maliyet yalnız FIFO `inventory_batches.unit_cost_cents` kaynağından
//! gelir; parti yoksa `NULL` döner, `0` uydurulmaz.

use sqlx::{Row, SqlitePool};

use super::analytics_types::{
    AnalyticsRange, BcgCounts, BcgEntry, BcgQuadrant, ProductCombination, ProductMargin,
};

/// Uygulanmış ciro ve adet. `PAID` ve `VOID` birlikte çalışır: iptal edilen
/// siparişin tutarı kasada bir giderdir, hasılat değildir.
pub(crate) const REVENUE_CORE: &str = "FROM orders o
     JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
     JOIN products p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id
     LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id = o.tenant_id
    WHERE o.tenant_id = ?1 AND o.status IN ('PAID','VOID')";

/// Tarih filtresi SQL parçası. Aralık verilmemişse içinde bulunulan ay seçilir:
/// "tüm zaman" raporu, hedefler ve stokla birlikte okunduğunda anlamsızlaşır.
pub(crate) fn date_filter(range: &AnalyticsRange) -> (String, String) {
    match range {
        Some((from, to)) => (
            format!(" AND o.created_at >= '{from}'"),
            format!(" AND o.created_at <= '{to}'"),
        ),
        None => (
            " AND o.created_at >= date('now','start of month')".to_string(),
            String::new(),
        ),
    }
}

// ---------------------------------------------------------------------------
// 2.1 — Ürün kâr marjı (BCG girdisi)
// ---------------------------------------------------------------------------

pub async fn product_margins(pool: &SqlitePool,
    tenant_id: &str,
    range: &AnalyticsRange,
) -> Result<Vec<ProductMargin>, String>
{
    let (from, to) = date_filter(range);
    let sql = format!(
        "SELECT p.id AS product_id, COALESCE(p.name, p.id) AS product_name,
                COALESCE(c.name, 'Kategori yok') AS category_name,
                SUM(oi.quantity) AS units,
                SUM(oi.total_cents) AS revenue
         {REVENUE_CORE}{from}{to}
         GROUP BY p.id, p.name, c.name",
    );

    let rows = sqlx::query(&sql)
        .bind(tenant_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut costs: std::collections::HashMap<String, Option<i64>> =
        std::collections::HashMap::new();
    for (pid, cost) in average_unit_costs(pool, tenant_id).await? {
        costs.insert(pid, cost);
    }

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let product_id: String = r.try_get("product_id").map_err(|e| e.to_string())?;
        let units: i64 = r.try_get("units").map_err(|e| e.to_string())?;
        let revenue: i64 = r.try_get("revenue").map_err(|e| e.to_string())?;
        let unit_cost = costs.get(&product_id).copied().flatten();
        // Maliyet bilinmiyorsa kâr `None`; sıfır kâr "zararsız" anlamına gelmez.
        let gross_profit_cents = unit_cost.map(|c| revenue - (c * units));
        let margin_percent = gross_profit_cents.and_then(|g| {
            if revenue > 0 {
                Some((g as f64 / revenue as f64 * 100.0).round() as i64)
            } else {
                None
            }
        });
        out.push(ProductMargin {
            product_id,
            product_name: r.try_get("product_name").map_err(|e| e.to_string())?,
            category_name: r.try_get("category_name").map_err(|e| e.to_string())?,
            units_sold: units,
            revenue_cents: revenue,
            unit_cost_cents: unit_cost,
            gross_profit_cents,
            margin_percent,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// 2.2 — BCG sınıflandırma (medyan eşikler)
// ---------------------------------------------------------------------------

/// FIFO ortalama birim maliyet. Ürün başına tek satır döner; tükenmiş parti
/// ortalamayı bozmaz, yalnız `NULL` (bilinmeyen maliyet) üretir.
async fn average_unit_costs(pool: &SqlitePool,
    tenant_id: &str,
) -> Result<Vec<(String, Option<i64>)>, String>
{
    let rows = sqlx::query(
        "SELECT b.product_id,
                CAST(SUM(b.initial_qty * b.unit_cost_cents)
                     / NULLIF(SUM(b.remaining_qty), 0) AS INTEGER) AS avg_cost
           FROM inventory_batches b
          WHERE b.tenant_id = ?1
            AND b.product_id IS NOT NULL
            AND b.remaining_qty > 0
          GROUP BY b.product_id",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push((
            r.try_get::<String, _>("product_id")
                .map_err(|e| e.to_string())?,
            r.try_get::<Option<i64>, _>("avg_cost")
                .map_err(|e| e.to_string())?,
        ));
    }
    Ok(out)
}

/// Medyan: tek sayıda eleman tam orta, çift sayıda iki ortanın atılmış ortalaması.
/// Boş girdi `None` döner; "0. çeyrek" uydurmak sınıflandırmayı yanıltır.
pub fn median(values: &[i64]) -> Option<i64> {
    if values.is_empty() {
        return None;
    }
    let mut v = values.to_vec();
    v.sort_unstable();
    let mid = v.len() / 2;
    if v.len() % 2 == 1 {
        Some(v[mid])
    } else {
        // Taşma koruması: iki medyan doğrudan toplanırsa i64::MAX aşılır.
        // Bölme/parçalama aynı sonucu taşmasız verir.
        let (a, b) = (v[mid - 1], v[mid]);
        Some(a / 2 + b / 2 + (a % 2 + b % 2) / 2)
    }
}

/// Eşikler raporun kendi medyanından türetilir; işletmenin gizli sabiti yoktur.
/// Marjı bilinmeyen ürün sınıflandırılamaz ve `margin_percent: None` ile döner.
pub fn bcg_classify(margins: &[ProductMargin]) -> Result<Vec<BcgEntry>, String> {
    let known: Vec<i64> = margins.iter().filter_map(|m| m.margin_percent).collect();
    let margin_median =
        median(&known).ok_or_else(|| "BCG icin en az bir urunun maliyeti bilinmeli".to_string())?;
    let units: Vec<i64> = margins.iter().map(|m| m.units_sold).collect();
    let volume_median =
        median(&units).ok_or_else(|| "birim medyani hesaplanamadi".to_string())?;

    Ok(margins
        .iter()
        .map(|m| {
            let high_volume = m.units_sold >= volume_median;
            let quadrant = match (high_volume, m.margin_percent) {
                (true, Some(mg)) if mg >= margin_median => BcgQuadrant::Star,
                (true, Some(_)) => BcgQuadrant::CashCow,
                (false, Some(mg)) if mg >= margin_median => BcgQuadrant::Plowhorse,
                (false, Some(_)) => BcgQuadrant::Dog,
                // Maliyeti bilinmeyen ürün yanlış kovaya düşürülmez.
                (_, None) => BcgQuadrant::Dog,
            };
            BcgEntry {
                product_id: m.product_id.clone(),
                product_name: m.product_name.clone(),
                quadrant,
                units_sold: m.units_sold,
                margin_percent: m.margin_percent,
            }
        })
        .collect())
}

pub fn bcg_counts(entries: &[BcgEntry]) -> BcgCounts {
    let mut c = BcgCounts::default();
    for e in entries {
        match e.quadrant {
            BcgQuadrant::Star => c.star += 1,
            BcgQuadrant::Plowhorse => c.plowhorse += 1,
            BcgQuadrant::CashCow => c.cash_cow += 1,
            BcgQuadrant::Dog => c.dog += 1,
        }
    }
    c
}

// ---------------------------------------------------------------------------
// 2.3 — Aynı siparişte birlikte satılan ürün çiftleri
// ---------------------------------------------------------------------------

/// Ürün kimliği - ad eşlemesi. `IN` listesi bind edilemediği için kimlikler
/// tek tek bağlanır; kiracı sınırı korunur.
async fn product_names(pool: &SqlitePool,
    tenant_id: &str,
    ids: &[String],
) -> Result<std::collections::HashMap<String, String>, String>
{
    if ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT id, name FROM products WHERE tenant_id = ");
    qb.push_bind(tenant_id);
    qb.push(" AND id IN (");
    let mut sep = qb.separated(", ");
    for id in ids {
        sep.push_bind(id);
    }
    qb.push(")");
    let rows = qb.build().fetch_all(pool).await.map_err(|e| e.to_string())?;

    let mut map = std::collections::HashMap::with_capacity(rows.len());
    for r in rows {
        map.insert(
            r.try_get::<String, _>("id").map_err(|e| e.to_string())?,
            r.try_get::<String, _>("name").map_err(|e| e.to_string())?,
        );
    }
    Ok(map)
}

/// Destek eşiğinin altındaki çiftler gürültüdür; `HAVING COUNT(*) >= min_support`
/// ile SQL içinde elenir. `min_support` 0 ise her çift listelenirdi.
pub async fn combinations(pool: &SqlitePool,
    tenant_id: &str,
    range: &AnalyticsRange,
    min_support: i64,
) -> Result<Vec<ProductCombination>, String>
{
    let (from, to) = date_filter(range);
    let sql = format!(
        "SELECT a.product_id AS a_id, b.product_id AS b_id, COUNT(*) AS support
           FROM order_items a
           JOIN order_items b
             ON b.order_id = a.order_id AND b.tenant_id = a.tenant_id
            AND b.product_id > a.product_id
           JOIN orders o ON o.id = a.order_id AND o.tenant_id = a.tenant_id
          WHERE a.tenant_id = ?1 AND o.status IN ('PAID','VOID'){from}{to}
          GROUP BY a.product_id, b.product_id
          HAVING COUNT(*) >= {}
          ORDER BY support DESC, a.product_id, b.product_id
          LIMIT 50",
        min_support.max(1)
    );

    let total_orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE tenant_id = ?1 AND status IN ('PAID','VOID')",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let rows = sqlx::query(&sql)
        .bind(tenant_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut ids = Vec::with_capacity(rows.len() * 2);
    for r in &rows {
        ids.push(r.try_get::<String, _>("a_id").map_err(|e| e.to_string())?);
        ids.push(r.try_get::<String, _>("b_id").map_err(|e| e.to_string())?);
    }
    ids.sort();
    ids.dedup();
    let names = product_names(pool, tenant_id, &ids).await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let a_id: String = r.try_get("a_id").map_err(|e| e.to_string())?;
        let b_id: String = r.try_get("b_id").map_err(|e| e.to_string())?;
        let support: i64 = r.try_get("support").map_err(|e| e.to_string())?;
        // Pay yüzdesi = bu çiftin göründüğü sipariş / toplam ciro siparişi.
        let confidence_percent = if total_orders > 0 {
            (support as f64 / total_orders as f64 * 100.0).round() as i64
        } else {
            0
        };
        out.push(ProductCombination {
            product_a_name: names.get(&a_id).cloned().unwrap_or_else(|| a_id.clone()),
            product_b_name: names.get(&b_id).cloned().unwrap_or_else(|| b_id.clone()),
            product_a_id: a_id,
            product_b_id: b_id,
            support,
            confidence_percent,
        });
    }
    Ok(out)
}