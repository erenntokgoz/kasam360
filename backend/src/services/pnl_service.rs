//! Kâr/zarar (P&L) motoru.
//!
//! ## Çift sayım kuralı
//!
//! Gelir **iki ayrı tablodan** toplanır: `orders` (peşin satış) ve
//! `debt_payments` (veresiye tahsilatı). Bu iki küme **ayrışmazsa** aynı para
//! iki kez sayılır. Somut çift sayım yolu:
//!
//! 1. Adisyon peşin kapatılır → `orders.status = 'PAID'`, para `orders`tan sayılır.
//! 2. Aynı adisyon için cari borç açılır (`debts.order_id` dolu, `type = 'GIVEN'`).
//! 3. Müşteri borcu kapatır → `debt_payments` kaydı yazılır, para **ikinci kez** sayılır.
//!
//! Düzeltme: `debt_payments` toplamına giren satırlar, bağlı siparişi
//! `orders`ta zaten `PAID` olan borçlar **hariç tutulur**. Böylece her kuruş
//! tam olarak bir kez sayılır; hiçbir gelir kaybolmaz, yalnız tekrarlar elenir.

use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone)]
pub struct CategorySummary {
    pub category: String,
    pub total_cents: i64,
    pub count: i64,
}

#[derive(Debug, Clone)]
pub struct MonthTrend {
    pub month: String,
    pub revenue_cents: i64,
    pub expense_cents: i64,
    pub profit_cents: i64,
}

#[derive(Debug, Clone)]
pub struct FinancialReport {
    pub total_revenue_cents: i64,
    pub total_sales_revenue_cents: i64,
    pub total_debt_collected_cents: i64,
    pub total_cogs_cents: i64,
    pub total_refunds_cents: i64,
    /// Satışların içindeki KDV. İşletmenin parası değildir, kârdan çıkar.
    pub total_vat_cents: i64,
    pub gross_profit_cents: i64,
    /// Dönemde partisi olmadan düşülen satış kalemi sayısı. Sıfır değilse
    /// maliyet eksik, kâr gerçeğinden yüksektir; ekran kârı yaklaşık gösterir.
    pub cost_missing_lines: i64,
    pub total_expenses_cents: i64,
    pub net_profit_cents: i64,
    pub receivables_cents: i64,
    pub payables_cents: i64,
    pub expenses_by_category: Vec<CategorySummary>,
    pub monthly_trend: Vec<MonthTrend>,
}

/// Tarih aralığı: `None` ise tüm zaman anlamına gelir.
pub type DateRange = Option<(String, String)>;

/// İşletmenin gelir, gider, kâr/zarar ve bilanço özetini hesaplar.
///
/// ## Sessiz hata yasağı (AGENTS.md §3.4)
///
/// Her toplam `Result` üzerinden `?` ile yükseltilir. `unwrap_or(0)` veya
/// `COALESCE` yalnızca **gerçekten satır olmayan** durumda meşrudur: satır yok
/// demek "bu ay gider yok" demektir, "sorgu patladı" demek değildir. Bu yüzden
/// `COALESCE` toplam sorgularının içindedir, `fetch_one` hatası ise `?` ile
/// yukarı çıkar.
pub async fn financial_report(
    pool: &SqlitePool,
    tenant_id: &str,
    range: &DateRange,
) -> Result<FinancialReport, String> {
    financial_report_at(pool, tenant_id, range, 0).await
}

/// `YYYY-AA-GG` gün sınırlarını yerel saatin UTC karşılığına çevirir: `[başlangıç, bitiş)`.
///
/// Neden: siparişler ve defter UTC yazılır; `date(created_at)` ile gün karşılaştırmak
/// yerel gece yarısından sonraki ilk saatleri (TR'de 00:00-03:00) önceki güne atıyordu ve
/// ay sınırındaki satış yanlış ayın kârına giriyordu. Pano aynı yarı açık yerel sınırı kullanır.
pub(crate) fn utc_bounds(
    start: &str,
    end: &str,
    offset_minutes: i64,
) -> Result<(String, String), String> {
    let day = |value: &str| {
        let text = value.trim().get(..10).unwrap_or("");
        chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
            .map_err(|_| "INVALID_ARGUMENT: tarih YYYY-AA-GG olmalıdır".to_string())
    };
    let offset = chrono::Duration::minutes(offset_minutes);
    let from = day(start)?.and_time(chrono::NaiveTime::MIN) - offset;
    let to = day(end)?
        .succ_opt()
        .ok_or_else(|| "INVALID_ARGUMENT: bitiş tarihi aralık dışı".to_string())?
        .and_time(chrono::NaiveTime::MIN)
        - offset;
    let format = "%Y-%m-%d %H:%M:%S";
    Ok((
        from.format(format).to_string(),
        to.format(format).to_string(),
    ))
}

/// Yerel gün ofsetiyle (dakika) kâr/zarar. Ofset yalnız UTC saklanan satış, iade ve defter
/// zamanlarını yerel güne bağlar; gider tarihi zaten yerel gün metnidir.
pub async fn financial_report_at(
    pool: &SqlitePool,
    tenant_id: &str,
    range: &DateRange,
    utc_offset_minutes: i64,
) -> Result<FinancialReport, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    // Aralıksız rapor tüm zamandır; sınırlar tüm geçerli tarihleri kapsar.
    let (from_utc, to_utc) = match range {
        Some((s, e)) => utc_bounds(s, e, utc_offset_minutes)?,
        None => (
            "0001-01-01 00:00:00".to_string(),
            "9999-12-31 00:00:00".to_string(),
        ),
    };
    // Saat taşıyan gider UTC anıdır, yalnız tarih taşıyan elle girilen gider zaten yerel gündür.
    let day_shift = format!("{utc_offset_minutes:+} minutes");
    let (expense_from, expense_to) = match range {
        Some((s, e)) => (s.trim().to_string(), e.trim().to_string()),
        None => ("0001-01-01".to_string(), "9999-12-31".to_string()),
    };

    // ------------------------------------------------------------------
    // 1. Peşin satış geliri — yalnız PAID siparişler
    // ------------------------------------------------------------------
    let total_sales_revenue_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_cents), 0) FROM orders
         WHERE tenant_id = ? AND status = 'PAID'
           AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)",
    )
    .bind(tenant_id)
    .bind(&from_utc)
    .bind(&to_utc)
    .fetch_one(&mut *conn)
    .await
    .map_err(|err| format!("Satış geliri toplanamadı: {}", err))?;

    // ------------------------------------------------------------------
    // 2. Veresiye tahsilatı — çift sayımlı satırlar hariç
    // ------------------------------------------------------------------
    let total_debt_collected_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(dp.amount_cents), 0) FROM debt_payments dp
         JOIN debts d ON d.id = dp.debt_id AND d.tenant_id = dp.tenant_id
         WHERE dp.tenant_id = ? AND d.type = 'GIVEN'
           AND datetime(dp.created_at) >= datetime(?) AND datetime(dp.created_at) < datetime(?)
           AND NOT EXISTS (
               SELECT 1 FROM orders o
               WHERE o.id = d.order_id AND o.tenant_id = d.tenant_id AND o.status = 'PAID'
           )",
    )
    .bind(tenant_id)
    .bind(&from_utc)
    .bind(&to_utc)
    .fetch_one(&mut *conn)
    .await
    .map_err(|err| format!("Alacak tahsilatı toplanamadı: {}", err))?;

    let total_revenue_cents = total_sales_revenue_cents + total_debt_collected_cents;

    // ------------------------------------------------------------------
    // 2.5. Satılan Malın Maliyeti (COGS) ve İadeler
    // ------------------------------------------------------------------
    // Defterin mühürlü işlem zamanı (`timestamp`) kullanılır; `created_at` satırın diske
    // yazıldığı andır ve eşitleme/geri yükleme sonrası olayın gününü göstermez. Pano aynıdır.
    let total_cogs_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(CAST(json_extract(payload, '$.cogsTotalCents') AS INTEGER)), 0)
         FROM audit_ledger
         WHERE tenant_id = ? AND action = 'payment:settled_fifo'
           AND datetime(timestamp) >= datetime(?) AND datetime(timestamp) < datetime(?)",
    )
    .bind(tenant_id)
    .bind(&from_utc)
    .bind(&to_utc)
    .fetch_one(&mut *conn)
    .await
    .map_err(|err| format!("COGS toplanamadı: {}", err))?;

    let total_refunds_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM refunds
         WHERE tenant_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)",
    )
    .bind(tenant_id)
    .bind(&from_utc)
    .bind(&to_utc)
    .fetch_one(&mut *conn)
    .await
    .map_err(|err| format!("İadeler toplanamadı: {}", err))?;

    // Panorama ile aynı tanım: iki ekranda iki farklı kâr görünmemeli.
    let total_vat_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(i.tax_amount_cents), 0) FROM order_items i
         JOIN orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
         WHERE i.tenant_id = ? AND i.status != 'CANCELLED' AND o.status = 'PAID'
           AND datetime(o.created_at) >= datetime(?) AND datetime(o.created_at) < datetime(?)",
    )
    .bind(tenant_id)
    .bind(&from_utc)
    .bind(&to_utc)
    .fetch_one(&mut *conn)
    .await
    .map_err(|err| format!("KDV toplanamadı: {}", err))?;

    let gross_profit_cents =
        total_revenue_cents - total_refunds_cents - total_vat_cents - total_cogs_cents;

    // FIFO düşümü partisi olmayan tüketimi `untrackedDeficit` ile işaretler; o
    // kalemin maliyeti sıfır sayılmıştır. Sayı, kârın neden yaklaşık olduğunu söyler.
    let cost_missing_lines: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM order_items i
         JOIN orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
         JOIN events e ON e.tenant_id = i.tenant_id AND e.aggregate_id = i.stock_source_id
                      AND e.event_type = 'FIFO_STOCK_DEDUCTED'
         WHERE i.tenant_id = ? AND i.status != 'CANCELLED' AND o.status = 'PAID'
           AND CAST(json_extract(e.payload, '$.untrackedDeficit') AS REAL) > 0
           AND datetime(o.created_at) >= datetime(?) AND datetime(o.created_at) < datetime(?)",
    )
    .bind(tenant_id)
    .bind(&from_utc)
    .bind(&to_utc)
    .fetch_one(&mut *conn)
    .await
    .map_err(|err| format!("Maliyeti eksik satışlar sayılamadı: {}", err))?;

    // ------------------------------------------------------------------
    // 3. Gider (personel avansı gider değil, personelden alacaktır; kârdan düşülmez)
    // ------------------------------------------------------------------
    let total_expenses_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM general_expenses
         WHERE tenant_id = ? AND category <> 'STAFF_ADVANCE'
           AND (CASE WHEN length(expense_date) > 10 THEN date(expense_date, ?) ELSE substr(expense_date, 1, 10) END) >= date(?) AND (CASE WHEN length(expense_date) > 10 THEN date(expense_date, ?) ELSE substr(expense_date, 1, 10) END) <= date(?)",
    )
    .bind(tenant_id)
    .bind(&day_shift)
    .bind(&expense_from)
    .bind(&day_shift)
    .bind(&expense_to)
    .fetch_one(&mut *conn)
    .await
    .map_err(|err| format!("Genel gider toplanamadı: {}", err))?;

    let net_profit_cents = gross_profit_cents - total_expenses_cents;

    // ------------------------------------------------------------------
    // 4. Açık alacak / borç
    // ------------------------------------------------------------------
    let receivables_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(remaining_amount_cents), 0) FROM debts
         WHERE tenant_id = ? AND type = 'GIVEN' AND status != 'PAID'",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|err| format!("Açık alacak hesaplanamadı: {}", err))?;

    let payables_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(remaining_amount_cents), 0) FROM debts
         WHERE tenant_id = ? AND type = 'TAKEN' AND status != 'PAID'",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|err| format!("Açık borç hesaplanamadı: {}", err))?;

    // ------------------------------------------------------------------
    // 5. Gider kategorileri kırılımı (aralıksız: kategori dağılımı dönemin
    //    dışına taşmamalı, bu yüzden aynı aralık uygulanır)
    // ------------------------------------------------------------------
    let cat_rows = sqlx::query(
        "SELECT category, SUM(amount_cents) AS total_cents, COUNT(*) AS count
         FROM general_expenses
         WHERE tenant_id = ? AND category <> 'STAFF_ADVANCE'
           AND (CASE WHEN length(expense_date) > 10 THEN date(expense_date, ?) ELSE substr(expense_date, 1, 10) END) >= date(?) AND (CASE WHEN length(expense_date) > 10 THEN date(expense_date, ?) ELSE substr(expense_date, 1, 10) END) <= date(?)
         GROUP BY category ORDER BY total_cents DESC",
    )
    .bind(tenant_id)
    .bind(&day_shift)
    .bind(&expense_from)
    .bind(&day_shift)
    .bind(&expense_to)
    .fetch_all(&mut *conn)
    .await
    .map_err(|err| format!("Gider kategorileri okunamadı: {}", err))?;

    let mut expenses_by_category = Vec::with_capacity(cat_rows.len());
    for r in &cat_rows {
        expenses_by_category.push(CategorySummary {
            category: r.try_get("category").map_err(|e| e.to_string())?,
            total_cents: r.try_get("total_cents").map_err(|e| e.to_string())?,
            count: r.try_get("count").map_err(|e| e.to_string())?,
        });
    }

    // ------------------------------------------------------------------
    // 6. Aylık trend — gelir de çift sayım kuralına uyar
    // ------------------------------------------------------------------
    // Ay kovası yerel saate göre: UTC kovası ay sonu gecesini bir sonraki aya taşırdı.
    let shift = format!("{utc_offset_minutes:+} minutes");
    let trend_rows = sqlx::query(
        "SELECT strftime('%Y-%m', created_at, ?) AS month, SUM(total_cents) AS revenue_cents
         FROM orders
         WHERE tenant_id = ? AND status = 'PAID'
         GROUP BY month ORDER BY month DESC LIMIT 6",
    )
    .bind(&shift)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|err| format!("Aylık trend okunamadı: {}", err))?;

    let mut monthly_trend = Vec::with_capacity(trend_rows.len());
    for r in &trend_rows {
        let month: String = r.try_get("month").map_err(|e| e.to_string())?;
        let sales_revenue: i64 = r.try_get("revenue_cents").map_err(|e| e.to_string())?;

        let collected: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(dp.amount_cents), 0) FROM debt_payments dp
             JOIN debts d ON d.id = dp.debt_id AND d.tenant_id = dp.tenant_id
             WHERE dp.tenant_id = ? AND d.type = 'GIVEN'
               AND strftime('%Y-%m', dp.created_at, ?) = ?
               AND NOT EXISTS (
                   SELECT 1 FROM orders o
                   WHERE o.id = d.order_id AND o.tenant_id = d.tenant_id AND o.status = 'PAID'
               )",
        )
        .bind(tenant_id)
        .bind(&shift)
        .bind(&month)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| format!("{} ayı tahsilatı okunamadı: {}", month, err))?;

        let expense_cents: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM general_expenses
             WHERE tenant_id = ? AND category <> 'STAFF_ADVANCE' AND strftime('%Y-%m', CASE WHEN length(expense_date) > 10 THEN date(expense_date, ?) ELSE substr(expense_date, 1, 10) END) = ?",
        )
        .bind(tenant_id)
        .bind(&shift)
        .bind(&month)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| format!("{} ayı gideri okunamadı: {}", month, err))?;

        let revenue_cents = sales_revenue + collected;
        monthly_trend.push(MonthTrend {
            month,
            revenue_cents,
            expense_cents,
            profit_cents: revenue_cents - expense_cents,
        });
    }

    Ok(FinancialReport {
        total_revenue_cents,
        total_sales_revenue_cents,
        total_debt_collected_cents,
        total_cogs_cents,
        total_refunds_cents,
        total_vat_cents,
        gross_profit_cents,
        cost_missing_lines,
        total_expenses_cents,
        net_profit_cents,
        receivables_cents,
        payables_cents,
        expenses_by_category,
        monthly_trend,
    })
}

#[cfg(test)]
#[path = "pnl_service_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "pnl_cost_missing_tests.rs"]
mod cost_missing_tests;

#[cfg(test)]
#[path = "pnl_boundary_tests.rs"]
mod boundary_tests;
