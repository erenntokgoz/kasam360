//! Veresiye masa kapatma testleri (Faz 9).
//!
//! Kritik kural: veresiye kapatmak KASAYA DOKUNMAZ. Masanın hesabı borçlu kalır,
//! para kasada değil müşterinin bakiyesindedir. Kasa hareketi üreten bir masa
//! kapatma, bankada olmayan parayı kasada gösterir.

use crate::services::ledger_service::net_balance;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
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

async fn seed_directory(pool: &sqlx::SqlitePool, id: &str, name: &str, dir_type: &str) {
    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, credit_limit_cents, created_at)
         VALUES (?, ?, ?, ?, 0, datetime('now'))",
    )
    .bind(id)
    .bind(TENANT)
    .bind(name)
    .bind(dir_type)
    .execute(pool)
    .await
    .expect("cari kart eklenir");
}

#[tokio::test]
async fn veresiye_settlement_does_not_touch_cash_drawer() {
    // Zorunlu kanıt: veresiye ile kapatılan adisyon kasa hareketi üretmemeli.
    let p = pool().await;
    seed_directory(&p, "dir_cus", "Müşteri Ayşe", "CUSTOMER").await;

    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements")
        .fetch_one(&p)
        .await
        .expect("kasa sayımı");

    let mut tx = p.begin().await.expect("işlem başlar");
    let settlement =
        crate::services::ledger_service::record_veresiye_settlement(
            &mut tx,
            TENANT,
            "dir_cus",
            "ord_01",
            87_500,
            Some("Masa 4 — veresiye"),
        )
        .await
        .expect("veresiye kaydı açılır");
    tx.commit().await.expect("işlem kapanır");

    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements")
        .fetch_one(&p)
        .await
        .expect("kasa sayımı");

    assert_eq!(
        before, after,
        "veresiye kasa hareketi üretmemeli: {} -> {}",
        before,
        after
    );

    let cash_total: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(amount_cents), 0) FROM cash_movements")
        .fetch_one(&p)
        .await
        .expect("kasa toplamı");
    assert_eq!(cash_total, 0, "kasada hiç para hareketi olmamalı");

    // Buna karşılık borç açılmış olmalı.
    assert_eq!(settlement.amount_cents, 87_500);
    let debt_row = sqlx::query(
        "SELECT type, status, total_amount_cents, remaining_amount_cents
         FROM debts WHERE id = ?",
    )
    .bind(&settlement.debt_id)
    .fetch_one(&p)
    .await
    .expect("borç kaydı var");

    assert_eq!(debt_row.try_get::<String, _>("type").unwrap(), "GIVEN");
    assert_eq!(debt_row.try_get::<String, _>("status").unwrap(), "PENDING");
    assert_eq!(debt_row.try_get::<i64, _>("total_amount_cents").unwrap(), 87_500);
    assert_eq!(
        debt_row.try_get::<i64, _>("remaining_amount_cents").unwrap(),
        87_500,
        "borç tam olarak açılmalı, kısmen değil"
    );
}

#[tokio::test]
async fn veresiye_requires_customer_card() {
    let p = pool().await;
    seed_directory(&p, "dir_sup", "Toptancı Ltd.", "SUPPLIER").await;
    seed_directory(&p, "dir_own", "Patron Şahsi", "OWNER_PERSONAL").await;

    let mut tx = p.begin().await.expect("işlem başlar");

    let err = crate::services::ledger_service::record_veresiye_settlement(
        &mut tx, TENANT, "dir_sup", "ord_01", 1_000, None,
    )
    .await
    .expect_err("tedarikçi kartına veresiye açılamaz");
    assert!(err.contains("CUSTOMER"), "hata: {}", err);

    let err = crate::services::ledger_service::record_veresiye_settlement(
        &mut tx, TENANT, "dir_own", "ord_01", 1_000, None,
    )
    .await
    .expect_err("patron kartına veresiye açılamaz");
    assert!(err.contains("OWNER_PERSONAL"), "hata: {}", err);

    let err = crate::services::ledger_service::record_veresiye_settlement(
        &mut tx, TENANT, "dir_yok", "ord_01", 1_000, None,
    )
    .await
    .expect_err("olmayan kart hata vermeli");
    assert!(err.contains("cari kartı seçilmelidir"), "hata: {}", err);

    let err = crate::services::ledger_service::record_veresiye_settlement(
        &mut tx, TENANT, "dir_sup", "ord_01", 0, None,
    )
    .await
    .expect_err("sıfır tutar hata vermeli");
    assert!(err.contains("0'dan büyük"), "hata: {}", err);

    tx.rollback().await.ok();
}

#[tokio::test]
async fn veresiye_of_other_tenant_is_rejected() {
    let p = pool().await;
    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, credit_limit_cents, created_at)
         VALUES ('dir_f', 'tenant_b', 'Yabancı Müşteri', 'CUSTOMER', 0, datetime('now'))",
    )
    .execute(&p)
    .await
    .expect("yabancı kart eklenir");

    let mut tx = p.begin().await.expect("işlem başlar");
    let err = crate::services::ledger_service::record_veresiye_settlement(
        &mut tx,
        TENANT,
        "dir_f",
        "ord_01",
        5_000,
        None,
    )
    .await
    .expect_err("başka kiracının kartı reddedilmeli");

    assert!(err.contains("cari kartı seçilmelidir"), "hata: {}", err);
    tx.rollback().await.ok();
}

#[tokio::test]
async fn veresiye_appears_in_net_balance_as_receivable() {
    // Neden: veresiye kaydı tutarsız kalırsa (borç açılmaz ya da yanlış yöne
    // açılırsa) motor onu yakalamalı.
    let p = pool().await;
    seed_directory(&p, "dir_cus", "Müşteri Ayşe", "CUSTOMER").await;

    let mut tx = p.begin().await.expect("işlem başlar");
    crate::services::ledger_service::record_veresiye_settlement(
        &mut tx, TENANT, "dir_cus", "ord_01", 42_000, None,
    )
    .await
    .expect("veresiye açılır");
    tx.commit().await.expect("işlem kapanır");

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye");

    assert_eq!(r.receivable_cents, 42_000, "veresiye alacak sayılmalı");
    assert_eq!(r.payable_cents, 0);
    assert_eq!(r.net_balance_cents, 42_000);
}
