//! Bütçe ve tekrarlayan gider testleri (Faz 9).
//!
//! Kapsam: limit karşılaştırması, %80 uyarı eşiği, ay filtresi, kiracı
//! izolasyonu, ay sonu sıkıştırma ve `AGENTS.md §3.4` sessiz hata yasağı.

use crate::services::budget_service::{budget_status, days_in_month, month_prefix_from_iso, recurring_due};
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

async fn seed_limit(pool: &sqlx::SqlitePool, tenant: &str, category: &str, limit: i64) {
    sqlx::query(
        "INSERT INTO budget_limits (id, tenant_id, category, monthly_limit_cents, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))",
    )
    .bind(format!("bl_{}_{}", tenant, category))
    .bind(tenant)
    .bind(category)
    .bind(limit)
    .execute(pool)
    .await
    .expect("bütçe limiti eklenir");
}

async fn seed_expense(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    category: &str,
    amount: i64,
    date: &str,
) {
    sqlx::query(
        "INSERT INTO general_expenses (id, tenant_id, category, amount_cents, payment_method,
                                        actor_id, expense_date, created_at)
         VALUES (?, ?, ?, ?, 'BANK_TRANSFER', 'usr_1', ?, datetime('now'))",
    )
    .bind(format!("exp_{}_{}_{}", tenant, category, date))
    .bind(tenant)
    .bind(category)
    .bind(amount)
    .bind(date)
    .execute(pool)
    .await
    .expect("gider eklenir");
}

// ============================================================================
// BÜTÇE
// ============================================================================

#[tokio::test]
async fn budget_below_limit_is_ok() {
    let p = pool().await;
    seed_limit(&p, TENANT, "RENT", 100_000).await;
    seed_expense(&p, TENANT, "RENT", 40_000, "2026-10-05").await;

    let s = budget_status(&p, TENANT, Some("2026-10-15"))
        .await
        .expect("bütçe okunur");

    assert_eq!(s.len(), 1);
    assert_eq!(s[0].spent_cents, 40_000);
    assert_eq!(s[0].remaining_cents, 60_000);
    assert_eq!(s[0].used_percent, 40);
    assert!(!s[0].is_exceeded);
    assert!(!s[0].is_near_limit);
}

#[tokio::test]
async fn budget_near_limit_warns_at_eighty_percent() {
    let p = pool().await;
    seed_limit(&p, TENANT, "UTILITIES", 100_000).await;
    seed_expense(&p, TENANT, "UTILITIES", 80_000, "2026-10-05").await;

    let s = budget_status(&p, TENANT, Some("2026-10-15"))
        .await
        .expect("bütçe okunur");

    assert_eq!(s[0].used_percent, 80);
    assert!(
        s[0].is_near_limit,
        "limitin %80'i uyarı eşiği; 80_000/100_000 uyarmalı"
    );
    assert!(!s[0].is_exceeded);
}

#[tokio::test]
async fn budget_exceeded_reports_negative_remaining() {
    let p = pool().await;
    seed_limit(&p, TENANT, "RENT", 100_000).await;
    seed_expense(&p, TENANT, "RENT", 130_000, "2026-10-05").await;

    let s = budget_status(&p, TENANT, Some("2026-10-15"))
        .await
        .expect("bütçe okunur");

    assert!(s[0].is_exceeded);
    assert_eq!(s[0].remaining_cents, -30_000, "aşım negatif kalmalı");
    assert_eq!(s[0].used_percent, 130);
    assert!(
        !s[0].is_near_limit,
        "aşıldıysa 'yaklaştı' uyarısı yanıltıcı olur; aşım uyarısı verilir"
    );
}

#[tokio::test]
async fn budget_only_counts_selected_month() {
    let p = pool().await;
    seed_limit(&p, TENANT, "RENT", 100_000).await;
    seed_expense(&p, TENANT, "RENT", 30_000, "2026-09-05").await; // geçen ay
    seed_expense(&p, TENANT, "RENT", 20_000, "2026-11-05").await; // gelecek ay
    seed_expense(&p, TENANT, "RENT", 50_000, "2026-10-05").await; // bu ay

    let s = budget_status(&p, TENANT, Some("2026-10-15"))
        .await
        .expect("bütçe okunur");

    assert_eq!(
        s[0].spent_cents, 50_000,
        "yalnız içinde bulunulan ay sayılmalı; geçen ve gelecek ay karışmamalı"
    );
}

#[tokio::test]
async fn budget_excludes_other_tenant() {
    let p = pool().await;
    seed_limit(&p, TENANT, "RENT", 100_000).await;
    seed_limit(&p, "tenant_b", "RENT", 100_000).await;
    seed_expense(&p, TENANT, "RENT", 10_000, "2026-10-05").await;
    seed_expense(&p, "tenant_b", "RENT", 99_000, "2026-10-05").await;

    let s = budget_status(&p, TENANT, Some("2026-10-15"))
        .await
        .expect("bütçe okunur");

    assert_eq!(s.len(), 1, "yalnız kendi limitin görünmeli");
    assert_eq!(s[0].spent_cents, 10_000, "başka kiracının 99000'i sızmamalı");
}

#[tokio::test]
async fn broken_budget_column_returns_err_not_zero() {
    // AGENTS.md §3.4: bütçe tablosu bozulursa "harcama 0" demek patronu
    // "bütçeye uyuyoruz" diye yanıltır. Hata dönmeli.
    let p = pool().await;
    seed_limit(&p, TENANT, "RENT", 100_000).await;

    sqlx::raw_sql("ALTER TABLE budget_limits DROP COLUMN monthly_limit_cents")
        .execute(&p)
        .await
        .expect("kolon düşürülür");

    let result = budget_status(&p, TENANT, Some("2026-10-15")).await;

    assert!(
        result.is_err(),
        "kırık bütçe tablosunda `Err` dönmeli; sessiz 0 dönmemeli"
    );
}

// ============================================================================
// TARİH YARDIMCISI
// ============================================================================

#[test]
fn month_prefix_parses_iso_and_rejects_garbage() {
    assert_eq!(month_prefix_from_iso("2026-10-05T10:00:00Z").unwrap(), "2026-10");
    assert_eq!(month_prefix_from_iso("2026-01").unwrap(), "2026-01");
    assert!(month_prefix_from_iso("2026").is_err());
    assert!(month_prefix_from_iso("26-10-05").is_err());
    assert!(month_prefix_from_iso("2026/10/05").is_err());
}

#[test]
fn days_in_month_handles_leap_years() {
    assert_eq!(days_in_month(2026, 1), 31);
    assert_eq!(days_in_month(2026, 2), 28);
    assert_eq!(days_in_month(2024, 2), 29); // artık yıl
    assert_eq!(days_in_month(2000, 2), 29); // 400'e bölünür
    assert_eq!(days_in_month(1900, 2), 28); // 100'e bölünür ama 400'e değil
    assert_eq!(days_in_month(2026, 4), 30);
}

// ============================================================================
// TEKRARLAYAN GİDER
// ============================================================================

async fn seed_recurring(
    pool: &sqlx::SqlitePool,
    id: &str,
    title: &str,
    category: &str,
    amount: i64,
    frequency: &str,
    due_day: i64,
    active: bool,
) {
    sqlx::query(
        "INSERT INTO recurring_expenses (id, tenant_id, title, category, amount_cents,
                                         frequency, due_day, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(id)
    .bind(TENANT)
    .bind(title)
    .bind(category)
    .bind(amount)
    .bind(frequency)
    .bind(due_day)
    .bind(if active { 1 } else { 0 })
    .execute(pool)
    .await
    .expect("tekrarlayan gider eklenir");
}

#[tokio::test]
async fn recurring_reports_overdue_and_today() {
    let p = pool().await;
    seed_recurring(&p, "rec_1", "Kira", "RENT", 250_000, "MONTHLY", 5, true).await;
    seed_recurring(&p, "rec_2", "Elektrik", "UTILITIES", 18_000, "MONTHLY", 20, true).await;

    let s = recurring_due(&p, TENANT, Some("2026-10-15"))
        .await
        .expect("tekrarlayan giderler okunur");

    assert_eq!(s.len(), 2);
    let kira = s.iter().find(|r| r.id == "rec_1").expect("kira var");
    let elektrik = s.iter().find(|r| r.id == "rec_2").expect("elektrik var");

    assert!(kira.is_overdue, "5 Ekim vadesi, bugün 15 Ekim: gecikmiş");
    assert!(!kira.is_due_today);
    assert!(!elektrik.is_overdue, "20 Ekim vadesi henüz gelmedi");
    assert_eq!(elektrik.due_day, 20);
}

#[tokio::test]
async fn recurring_due_today_is_flagged() {
    let p = pool().await;
    seed_recurring(&p, "rec_1", "Kira", "RENT", 250_000, "MONTHLY", 15, true).await;

    let s = recurring_due(&p, TENANT, Some("2026-10-15"))
        .await
        .expect("tekrarlayan giderler okunur");

    assert!(s[0].is_due_today, "bugün vadesi olan gider işaretlenmeli");
    assert!(!s[0].is_overdue);
}

#[tokio::test]
async fn recurring_day_31_is_clamped_in_february() {
    // Neden: kira çoğu işletmede her ayın 1'inde ödenir ama bazı sözleşmelerde
    // 31'inde olur. Şubat'ta 28/29'a sıkıştırılmazsa o ay kira hiç görünmez.
    let p = pool().await;
    seed_recurring(&p, "rec_1", "Kira", "RENT", 250_000, "MONTHLY", 31, true).await;

    let s = recurring_due(&p, TENANT, Some("2026-02-10"))
        .await
        .expect("tekrarlayan giderler okunur");

    assert_eq!(s[0].days_in_month, 28, "2026 Şubat 28 gün");
    assert_eq!(s[0].due_day, 28, "31 Şubat'ta 28'e sıkıştırılmalı");
    assert!(!s[0].is_overdue, "10 Şubat, 28 Şubat vadesinden önce: gecikmiş sayılmamalı");

    let s = recurring_due(&p, TENANT, Some("2024-02-10"))
        .await
        .expect("tekrarlayan giderler okunur");
    assert_eq!(s[0].due_day, 29, "artık yılda 29'a sıkıştırılmalı");
}

#[tokio::test]
async fn inactive_recurring_is_hidden() {
    let p = pool().await;
    seed_recurring(&p, "rec_1", "Kira", "RENT", 250_000, "MONTHLY", 5, true).await;
    seed_recurring(&p, "rec_2", "Eski Abonelik", "OTHER", 9_000, "MONTHLY", 5, false).await;

    let s = recurring_due(&p, TENANT, Some("2026-10-15"))
        .await
        .expect("tekrarlayan giderler okunur");

    assert_eq!(s.len(), 1, "pasif kayıt gizlenmeli");
    assert_eq!(s[0].id, "rec_1");
}