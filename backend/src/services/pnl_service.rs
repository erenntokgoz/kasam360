//! Kâr/zarar (P&L) motoru (Faz 9).
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
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // ------------------------------------------------------------------
    // 1. Peşin satış geliri — yalnız PAID siparişler
    // ------------------------------------------------------------------
    let total_sales_revenue_cents: i64 = match range {
        Some((s, e)) => sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_cents), 0) FROM orders
             WHERE tenant_id = ? AND status = 'PAID' AND created_at >= ? AND created_at <= ?",
        )
        .bind(tenant_id)
        .bind(s)
        .bind(e)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| format!("Satış geliri toplanamadı: {}", err))?,
        None => sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_cents), 0) FROM orders
             WHERE tenant_id = ? AND status = 'PAID'",
        )
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| format!("Satış geliri toplanamadı: {}", err))?,
    };

    // ------------------------------------------------------------------
    // 2. Veresiye tahsilatı — çift sayımlı satırlar hariç
    // ------------------------------------------------------------------
    let total_debt_collected_cents: i64 = match range {
        Some((s, e)) => sqlx::query_scalar(
            "SELECT COALESCE(SUM(dp.amount_cents), 0) FROM debt_payments dp
             JOIN debts d ON d.id = dp.debt_id AND d.tenant_id = dp.tenant_id
             WHERE dp.tenant_id = ? AND d.type = 'GIVEN'
               AND date(dp.created_at) >= date(?) AND date(dp.created_at) <= date(?)
               AND NOT EXISTS (
                   SELECT 1 FROM orders o
                   WHERE o.id = d.order_id AND o.tenant_id = d.tenant_id AND o.status = 'PAID'
               )",
        )
        .bind(tenant_id)
        .bind(s)
        .bind(e)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| format!("Alacak tahsilatı toplanamadı: {}", err))?,
        None => sqlx::query_scalar(
            "SELECT COALESCE(SUM(dp.amount_cents), 0) FROM debt_payments dp
             JOIN debts d ON d.id = dp.debt_id AND d.tenant_id = dp.tenant_id
             WHERE dp.tenant_id = ? AND d.type = 'GIVEN'
               AND NOT EXISTS (
                   SELECT 1 FROM orders o
                   WHERE o.id = d.order_id AND o.tenant_id = d.tenant_id AND o.status = 'PAID'
               )",
        )
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| format!("Alacak tahsilatı toplanamadı: {}", err))?,
    };

    let total_revenue_cents = total_sales_revenue_cents + total_debt_collected_cents;

    // ------------------------------------------------------------------
    // 3. Gider
    // ------------------------------------------------------------------
    let total_expenses_cents: i64 = match range {
        Some((s, e)) => sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM general_expenses
             WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ?",
        )
        .bind(tenant_id)
        .bind(s)
        .bind(e)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| format!("Genel gider toplanamadı: {}", err))?,
        None => sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM general_expenses WHERE tenant_id = ?",
        )
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| format!("Genel gider toplanamadı: {}", err))?,
    };

    let net_profit_cents = total_revenue_cents - total_expenses_cents;

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
    let cat_rows = match range {
        Some((s, e)) => sqlx::query(
            "SELECT category, SUM(amount_cents) AS total_cents, COUNT(*) AS count
             FROM general_expenses
             WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ?
             GROUP BY category ORDER BY total_cents DESC",
        )
        .bind(tenant_id)
        .bind(s)
        .bind(e)
        .fetch_all(&mut *conn)
        .await
        .map_err(|err| format!("Gider kategorileri okunamadı: {}", err))?,
        None => sqlx::query(
            "SELECT category, SUM(amount_cents) AS total_cents, COUNT(*) AS count
             FROM general_expenses WHERE tenant_id = ?
             GROUP BY category ORDER BY total_cents DESC",
        )
        .bind(tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|err| format!("Gider kategorileri okunamadı: {}", err))?,
    };

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
    let trend_rows = sqlx::query(
        "SELECT strftime('%Y-%m', created_at) AS month, SUM(total_cents) AS revenue_cents
         FROM orders
         WHERE tenant_id = ? AND status = 'PAID'
         GROUP BY month ORDER BY month DESC LIMIT 6",
    )
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
               AND strftime('%Y-%m', dp.created_at) = ?
               AND NOT EXISTS (
                   SELECT 1 FROM orders o
                   WHERE o.id = d.order_id AND o.tenant_id = d.tenant_id AND o.status = 'PAID'
               )",
        )
        .bind(tenant_id)
        .bind(&month)
        .fetch_one(&mut *conn)
        .await
        .map_err(|err| format!("{} ayı tahsilatı okunamadı: {}", month, err))?;

        let expense_cents: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM general_expenses
             WHERE tenant_id = ? AND strftime('%Y-%m', expense_date) = ?",
        )
        .bind(tenant_id)
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
