//! Cari ekstre yerel gün sınırı testleri.
//!
//! Borç ve tahsilat zamanları UTC yazılır; ekstre dönemi yerel günlerdir.

use crate::services::ledger_statement::directory_statement_at;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");
const TENANT: &str = "tenant_a";
/// Türkiye saati: UTC+3.
const OFFSET: i64 = 180;

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
    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, credit_limit_cents, created_at)
         VALUES ('dir_1', ?, 'Müşteri', 'CUSTOMER', 0, datetime('now'))",
    )
    .bind(TENANT)
    .execute(&pool)
    .await
    .expect("cari kart");
    pool
}

async fn debt(pool: &sqlx::SqlitePool, id: &str, amount: i64, utc_created_at: &str) {
    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, status, is_cash, created_at)
         VALUES (?, ?, 'dir_1', 'GIVEN', ?, ?, 'PENDING', 0, ?)",
    )
    .bind(id)
    .bind(TENANT)
    .bind(amount)
    .bind(amount)
    .bind(utc_created_at)
    .execute(pool)
    .await
    .expect("borç");
}

#[tokio::test]
async fn yerel_gece_yarisindan_sonra_acilan_borc_o_gunun_ekstresindedir() {
    let p = pool().await;
    // Yerel 10 Kasım 01:51 = UTC 9 Kasım 22:51. Bugünün ekstresinde görünmelidir.
    debt(&p, "debt_gece", 185_050, "2026-11-09 22:51:00").await;

    let today = directory_statement_at(&p, TENANT, "dir_1", "2026-11-10", "2026-11-10", OFFSET)
        .await
        .expect("bugün");
    assert_eq!(today.opening_balance_cents, 0, "önceki döneme düşmez");
    assert_eq!(today.lines.len(), 1);
    assert_eq!(today.total_debit_cents, 185_050);

    let yesterday = directory_statement_at(&p, TENANT, "dir_1", "2026-11-09", "2026-11-09", OFFSET)
        .await
        .expect("dün");
    assert!(yesterday.lines.is_empty(), "dünün ekstresinde olmaz");
    assert_eq!(yesterday.closing_balance_cents, 0);
}

#[tokio::test]
async fn gun_sonu_ve_ertesi_gun_basi_dogru_tarafa_duser() {
    let p = pool().await;
    // Yerel 23:59:59 ve ertesi gün 00:00:00 (UTC 20:59:59 / 21:00:00).
    debt(&p, "debt_a", 100, "2026-11-10 20:59:59").await;
    debt(&p, "debt_b", 200, "2026-11-10 21:00:00").await;

    let day = directory_statement_at(&p, TENANT, "dir_1", "2026-11-10", "2026-11-10", OFFSET)
        .await
        .expect("gün");
    assert_eq!(day.total_debit_cents, 100);
    let next = directory_statement_at(&p, TENANT, "dir_1", "2026-11-11", "2026-11-11", OFFSET)
        .await
        .expect("ertesi gün");
    assert_eq!(next.opening_balance_cents, 100);
    assert_eq!(next.total_debit_cents, 200);
}

#[tokio::test]
async fn bozuk_tarih_sessizce_bos_ekstre_vermez() {
    let p = pool().await;
    let result = directory_statement_at(&p, TENANT, "dir_1", "dün", "bugün", OFFSET).await;
    assert!(result.is_err());
}
