//! P&L çift sayım testleri (Faz 9).
//!
//! Kapsam: peşin satış, veresiye tahsilatı, **çift sayım yolu**, kiracı
//! izolasyonu, dönem filtresi ve sessiz hata yasağı.

use crate::services::pnl_service::{financial_report, DateRange};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");
const TENANT: &str = "tenant_a";

async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(SCHEMA)
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    pool
}

async fn seed_table(pool: &sqlx::SqlitePool, id: &str, tenant: &str) {
    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, current_total)
         VALUES (?, ?, 'Masa 1', 'AVAILABLE', 0)",
    )
    .bind(id)
    .bind(tenant)
    .execute(pool)
    .await
    .expect("masa eklenir");
}

async fn seed_order(
    pool: &sqlx::SqlitePool,
    id: &str,
    tenant: &str,
    total: i64,
    status: &str,
    created_at: &str,
) {
    let table_id = format!("tbl_{}", id);
    seed_table(pool, &table_id, tenant).await;
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(tenant)
    .bind(&table_id)
    .bind(status)
    .bind(total)
    .bind(created_at)
    .execute(pool)
    .await
    .expect("sipariş eklenir");
}

async fn seed_directory(pool: &sqlx::SqlitePool, id: &str, name: &str) {
    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, credit_limit_cents, created_at)
         VALUES (?, ?, ?, 'CUSTOMER', 0, datetime('now'))",
    )
    .bind(id)
    .bind(TENANT)
    .bind(name)
    .execute(pool)
    .await
    .expect("cari kart eklenir");
}

async fn seed_debt(pool: &sqlx::SqlitePool, id: &str, order_id: Option<&str>, amount: i64, created_at: &str) {
    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, status, is_cash, order_id, created_at)
         VALUES (?, ?, 'dir_cus', 'GIVEN', ?, ?, 'PENDING', 0, ?, ?)",
    )
    .bind(id)
    .bind(TENANT)
    .bind(amount)
    .bind(amount)
    .bind(order_id)
    .bind(created_at)
    .execute(pool)
    .await
    .expect("borç eklenir");
}

async fn seed_payment(pool: &sqlx::SqlitePool, id: &str, debt_id: &str, amount: i64, created_at: &str) {
    sqlx::query(
        "INSERT INTO debt_payments (id, tenant_id, debt_id, amount_cents, payment_method,
                                    actor_id, created_at)
         VALUES (?, ?, ?, ?, 'CASH', 'usr_1', ?)",
    )
    .bind(id)
    .bind(TENANT)
    .bind(debt_id)
    .bind(amount)
    .bind(created_at)
    .execute(pool)
    .await
    .expect("tahsilat eklenir");
}

async fn seed_expense(pool: &sqlx::SqlitePool, category: &str, amount: i64, date: &str) {
    sqlx::query(
        "INSERT INTO general_expenses (id, tenant_id, category, amount_cents, payment_method,
                                        actor_id, expense_date, created_at)
         VALUES (?, ?, ?, ?, 'BANK_TRANSFER', 'usr_1', ?, datetime('now'))",
    )
    .bind(format!("exp_{}_{}", category, date))
    .bind(TENANT)
    .bind(category)
    .bind(amount)
    .bind(date)
    .execute(pool)
    .await
    .expect("gider eklenir");
}

async fn report(pool: &sqlx::SqlitePool) -> crate::services::pnl_service::FinancialReport {
    financial_report(pool, TENANT, &None).await.expect("P&L üretilir")
}

// ============================================================================
// ÇİFT SAYIM — düzeltmenin asıl kanıtı
// ============================================================================

#[tokio::test]
async fn debt_payment_of_a_paid_order_is_not_counted_twice() {
    // Çift sayım yolu: adisyon peşin kapatıldı (orders PAID) ve aynı adisyon
    // için müşteri borcu açıldı; müşteri borcu kapatınca aynı para ikinci kez
    // gelir olarak sayılıyordu.
    let p = pool().await;
    seed_order(&p, "ord_1", TENANT, 100_000, "PAID", "2026-10-05 20:00:00").await;
    seed_directory(&p, "dir_cus", "Müşteri Ayşe").await;
    seed_debt(&p, "dbt_1", Some("ord_1"), 100_000, "2026-10-05 20:05:00").await;
    seed_payment(&p, "pay_1", "dbt_1", 100_000, "2026-10-25 11:00:00").await;

    let r = report(&p).await;

    assert_eq!(r.total_sales_revenue_cents, 100_000);
    assert_eq!(
        r.total_debt_collected_cents, 0,
        "siparişi zaten PAID olan borcun tahsilatı gelir olarak tekrar sayılmamalı"
    );
    assert_eq!(
        r.total_revenue_cents, 100_000,
        "100 TL peşin + 100 TL tahsilat = 200 TL görünmemeli"
    );
}

#[tokio::test]
async fn genuine_veresiye_collection_is_still_counted() {
    // Düzeltme aşırıya kaçmamalı: siparişi PAID olmayan veresiye tahsilatı
    // gelirdir ve sayılmalıdır. Aksi hâlde tüm veresiye gelir kaybolur.
    let p = pool().await;
    seed_order(&p, "ord_1", TENANT, 100_000, "IN_PROGRESS", "2026-10-05 20:00:00").await;
    seed_directory(&p, "dir_cus", "Müşteri Ayşe").await;
    seed_debt(&p, "dbt_1", Some("ord_1"), 100_000, "2026-10-05 20:05:00").await;
    seed_payment(&p, "pay_1", "dbt_1", 100_000, "2026-10-25 11:00:00").await;

    let r = report(&p).await;

    assert_eq!(r.total_sales_revenue_cents, 0, "IN_PROGRESS sipariş peşin gelir değildir");
    assert_eq!(r.total_debt_collected_cents, 100_000, "veresiye tahsilatı gelirdir");
    assert_eq!(r.total_revenue_cents, 100_000);
}

#[tokio::test]
async fn debt_without_order_link_is_always_counted() {
    // Cari kart açığı (avans, geçmiş borç) siparişe bağlı değildir; süzgeç
    // bunları yanlışlıkla elemesin.
    let p = pool().await;
    seed_directory(&p, "dir_cus", "Müşteri Ayşe").await;
    seed_debt(&p, "dbt_1", None, 40_000, "2026-10-05 20:05:00").await;
    seed_payment(&p, "pay_1", "dbt_1", 40_000, "2026-10-25 11:00:00").await;

    let r = report(&p).await;

    assert_eq!(r.total_debt_collected_cents, 40_000);
}

// ============================================================================
// TEMEL KÂR/ZARAR
// ============================================================================

#[tokio::test]
async fn cash_sale_minus_expense_equals_net_profit() {
    let p = pool().await;
    seed_order(&p, "ord_1", TENANT, 500_000, "PAID", "2026-10-05 20:00:00").await;
    seed_expense(&p, "RENT", 120_000, "2026-10-05").await;

    let r = report(&p).await;

    assert_eq!(r.total_revenue_cents, 500_000);
    assert_eq!(r.total_expenses_cents, 120_000);
    assert_eq!(r.net_profit_cents, 380_000);
}

#[tokio::test]
async fn unpaid_orders_are_not_revenue() {
    let p = pool().await;
    seed_order(&p, "ord_1", TENANT, 300_000, "IN_PROGRESS", "2026-10-05 20:00:00").await;
    seed_order(&p, "ord_2", TENANT, 200_000, "CANCELLED", "2026-10-05 21:00:00").await;

    let r = report(&p).await;

    assert_eq!(r.total_revenue_cents, 0, "ödenmemiş ve iptal sipariş gelir değildir");
}

// ============================================================================
// BİLANÇO
// ============================================================================

#[tokio::test]
async fn open_balances_split_into_receivable_and_payable() {
    let p = pool().await;
    seed_directory(&p, "dir_cus", "Müşteri Ayşe").await;
    seed_debt(&p, "dbt_given", None, 60_000, "2026-10-05 20:05:00").await;

    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, status, is_cash, created_at)
         VALUES ('dbt_taken', ?, 'dir_cus', 'TAKEN', 80_000, 80_000, 'PENDING', 0, datetime('now'))",
    )
    .bind(TENANT)
    .execute(&p)
    .await
    .expect("borç eklenir");

    let r = report(&p).await;

    assert_eq!(r.receivables_cents, 60_000);
    assert_eq!(r.payables_cents, 80_000);
}

// ============================================================================
// DÖNEM FİLTRESİ VE KİRACI İZOLASYONU
// ============================================================================

#[tokio::test]
async fn date_range_excludes_other_months() {
    let p = pool().await;
    seed_order(&p, "ord_a", TENANT, 100_000, "PAID", "2026-09-10 20:00:00").await;
    seed_order(&p, "ord_b", TENANT, 200_000, "PAID", "2026-10-10 20:00:00").await;
    seed_expense(&p, "OTHER", 50_000, "2026-10-10").await;

    let r: DateRange = Some(("2026-10-01".to_string(), "2026-10-31".to_string()));
    let rep = financial_report(&p, TENANT, &r).await.expect("P&L üretilir");

    assert_eq!(rep.total_revenue_cents, 200_000, "yalnız Ekim geliri sayılmalı");
    assert_eq!(rep.total_expenses_cents, 50_000);
    assert_eq!(
        rep.expenses_by_category.len(),
        1,
        "Eylül gideri kategori kırılımına da sızmamalı"
    );
}

#[tokio::test]
async fn other_tenant_is_excluded_everywhere() {
    let p = pool().await;
    seed_order(&p, "ord_a", TENANT, 100_000, "PAID", "2026-10-10 20:00:00").await;
    seed_order(&p, "ord_x", "tenant_b", 900_000, "PAID", "2026-10-11 20:00:00").await;
    seed_expense(&p, "OTHER", 50_000, "2026-10-10").await;

    let r = report(&p).await;

    assert_eq!(r.total_revenue_cents, 100_000, "başka kiracının 9.000 TL'si sızmamalı");
}

// ============================================================================
// KATEGORİ KRILIMI VE TREND
// ============================================================================

#[tokio::test]
async fn expense_categories_are_grouped_and_sorted() {
    let p = pool().await;
    seed_expense(&p, "RENT", 100_000, "2026-10-01").await;
    seed_expense(&p, "RENT", 50_000, "2026-10-02").await;
    seed_expense(&p, "UTILITIES", 30_000, "2026-10-03").await;

    let r = report(&p).await;

    assert_eq!(r.expenses_by_category.len(), 2);
    assert_eq!(r.expenses_by_category[0].category, "RENT");
    assert_eq!(r.expenses_by_category[0].total_cents, 150_000);
    assert_eq!(r.expenses_by_category[0].count, 2);
    assert_eq!(r.expenses_by_category[1].total_cents, 30_000);
}

#[tokio::test]
async fn monthly_trend_applies_the_same_dedupe_rule() {
    // Aylık grafik de çift sayımlıysa patron grafikte iki kat kâr görür;
    // ana toplamla grafik çelişmemelidir.
    let p = pool().await;
    seed_order(&p, "ord_1", TENANT, 100_000, "PAID", "2026-10-05 20:00:00").await;
    seed_directory(&p, "dir_cus", "Müşteri Ayşe").await;
    seed_debt(&p, "dbt_1", Some("ord_1"), 100_000, "2026-10-05 20:05:00").await;
    seed_payment(&p, "pay_1", "dbt_1", 100_000, "2026-10-25 11:00:00").await;

    let r = report(&p).await;

    assert_eq!(r.monthly_trend.len(), 1);
    assert_eq!(r.monthly_trend[0].month, "2026-10");
    assert_eq!(
        r.monthly_trend[0].revenue_cents, 100_000,
        "grafik ana toplamla aynı sayıyı göstermeli"
    );
    assert_eq!(
        r.monthly_trend[0].revenue_cents, r.total_revenue_cents,
        "aylık grafik ile dönem toplamı çelişmemeli"
    );
}

// ============================================================================
// SESSİZ HATA YASAĞI (AGENTS.md §3.4)
// ============================================================================

#[tokio::test]
async fn broken_orders_column_returns_err_not_zero() {
    // P&L sıfır dönerse patron "zarar yok" sanır. Hata dönmeli.
    let p = pool().await;
    sqlx::raw_sql("ALTER TABLE orders DROP COLUMN total_cents")
        .execute(&p)
        .await
        .expect("kolon düşürülür");

    let result = financial_report(&p, TENANT, &None).await;

    assert!(
        result.is_err(),
        "kırık sipariş tablosunda `Err` dönmeli; sessiz 0 dönmemeli"
    );
}

#[tokio::test]
async fn empty_business_reports_zero_without_error() {
    let p = pool().await;
    let r = report(&p).await;

    assert_eq!(r.total_revenue_cents, 0);
    assert_eq!(r.total_expenses_cents, 0);
    assert_eq!(r.net_profit_cents, 0);
    assert!(r.expenses_by_category.is_empty());
    assert!(r.monthly_trend.is_empty());
}