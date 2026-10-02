//! Net bakiye motoru testleri (Faz 9).
//!
//! Kapsam: beş hesap türünün her biri için ayrı test + sessiz hata testi.
//! Her test tek bir kuralı kanıtlar; "motor çalışıyor" genellemesi yapılmaz.

use crate::services::ledger_service::{net_balance, AccountClass};
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

async fn seed_debt(
    pool: &sqlx::SqlitePool,
    id: &str,
    directory_id: &str,
    debt_type: &str,
    remaining: i64,
) {
    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, status, is_cash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, datetime('now'))",
    )
    .bind(id)
    .bind(TENANT)
    .bind(directory_id)
    .bind(debt_type)
    .bind(remaining)
    .bind(remaining)
    .execute(pool)
    .await
    .expect("borç kaydı eklenir");
}

// ============================================================================
// HESAP TÜRÜ 1 — Toptancı (borç)
// ============================================================================

#[tokio::test]
async fn supplier_debt_counts_as_payable() {
    let p = pool().await;
    seed_directory(&p, "dir_sup", "Toptancı Ltd.", "SUPPLIER").await;
    seed_debt(&p, "dbt_1", "dir_sup", "TAKEN", 75_000).await;

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye hesaplanır");

    assert_eq!(r.payable_cents, 75_000, "toptancı borcu 75000 olmalı");
    assert_eq!(r.receivable_cents, 0, "toptancı alacağı olmamalı");
    assert_eq!(r.net_balance_cents, -75_000, "net negatif olmalı");

    let pos = r.positions.iter().find(|p| p.directory_id == "dir_sup").expect("kart var");
    assert_eq!(pos.account_class, AccountClass::Supplier);
    assert_eq!(pos.account_class.label(), "Toptancı Borcu");
    assert_eq!(pos.open_debts, 1);
}

#[tokio::test]
async fn supplier_given_is_receivable() {
    // Neden ayrı test: aynı sınıf içinde yön değişebilir. Toptancıya verilen
    // avans alacaktır; sınıf "Toptancı Borcu" olsa bile yön GIVEN'dır.
    let p = pool().await;
    seed_directory(&p, "dir_sup", "Toptancı Ltd.", "SUPPLIER").await;
    seed_debt(&p, "dbt_1", "dir_sup", "GIVEN", 12_000).await;

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye hesaplanır");

    assert_eq!(r.receivable_cents, 12_000);
    assert_eq!(r.payable_cents, 0);
    assert_eq!(r.net_balance_cents, 12_000);
}

// ============================================================================
// HESAP TÜRÜ 2 — Müşteri Veresiye (alacak)
// ============================================================================

#[tokio::test]
async fn customer_veresiye_counts_as_receivable() {
    let p = pool().await;
    seed_directory(&p, "dir_cus", "Müşteri Ayşe", "CUSTOMER").await;
    seed_debt(&p, "dbt_1", "dir_cus", "GIVEN", 40_000).await;
    seed_debt(&p, "dbt_2", "dir_cus", "GIVEN", 10_000).await;

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye hesaplanır");

    assert_eq!(
        r.receivable_cents, 50_000,
        "iki veresiye kaydı birleştirilmeli (40000 + 10000)"
    );
    assert_eq!(r.net_balance_cents, 50_000);

    let pos = r.positions.iter().find(|p| p.directory_id == "dir_cus").expect("kart var");
    assert_eq!(pos.account_class, AccountClass::CustomerVeresiye);
    assert_eq!(pos.account_class.label(), "Müşteri Veresiye");
    assert_eq!(pos.open_debts, 2, "kayıt yığmak yerine kart birleşmeli");
}

// ============================================================================
// HESAP TÜRÜ 3 — Personel (hakediş / avans)
// ============================================================================

#[tokio::test]
async fn staff_advance_is_receivable_and_unpaid_salary_is_payable() {
    let p = pool().await;
    seed_directory(&p, "dir_stf_a", "Garson Ali", "STAFF").await;
    seed_directory(&p, "dir_stf_b", "Aşçı Veli", "STAFF").await;

    // Ali avans aldı → işletmeye alacaklı
    seed_debt(&p, "dbt_adv", "dir_stf_a", "GIVEN", 5_000).await;
    // Veli'nin hakedişi ödenmedi → işletme borçlu
    seed_debt(&p, "dbt_sal", "dir_stf_b", "TAKEN", 30_000).await;

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye hesaplanır");

    assert_eq!(r.receivable_cents, 5_000, "personel avansı alacak");
    assert_eq!(r.payable_cents, 30_000, "ödenmemiş hakediş borç");
    assert_eq!(r.net_balance_cents, -25_000);

    let staff_total = r
        .by_class
        .iter()
        .find(|(c, _)| *c == AccountClass::Staff)
        .map(|(_, total)| *total)
        .expect("Personel sınıfı toplamı var");
    assert_eq!(staff_total, -25_000, "Personel sınıfı tek kalemde birleşmeli");
}

// ============================================================================
// HESAP TÜRÜ 4 — Sabit Gider (fatura)
// ============================================================================

#[tokio::test]
async fn fixed_expense_invoice_counts_as_payable() {
    let p = pool().await;
    seed_directory(&p, "dir_fix", "Elektrik Faturası", "FIXED_EXPENSE").await;
    seed_debt(&p, "dbt_inv", "dir_fix", "TAKEN", 22_500).await;

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye hesaplanır");

    assert_eq!(r.payable_cents, 22_500);
    let pos = r.positions.iter().find(|p| p.directory_id == "dir_fix").expect("kart var");
    assert_eq!(pos.account_class, AccountClass::FixedExpense);
    assert_eq!(pos.account_class.label(), "Sabit Gider");
}

// ============================================================================
// HESAP TÜRÜ 5 — Patron Şahsi (sermaye çekimi)
// ============================================================================

#[tokio::test]
async fn owner_personal_is_equity_withdrawal_not_receivable() {
    let p = pool().await;
    seed_directory(&p, "dir_own", "Patron Şahsi", "OWNER_PERSONAL").await;
    seed_debt(&p, "dbt_draw", "dir_own", "GIVEN", 50_000).await;

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye hesaplanır");

    assert_eq!(
        r.receivable_cents, 0,
        "sermaye çekimi alacak sayılmamalı — para işletmeden çıktı"
    );
    assert_eq!(r.owner_withdrawal_cents, 50_000, "çekim ayrı kalemde");
    assert_eq!(
        r.net_balance_cents, -50_000,
        "sermaye çekimi net bakiyeyi düşürmeli"
    );

    let pos = r.positions.iter().find(|p| p.directory_id == "dir_own").expect("kart var");
    assert_eq!(pos.account_class, AccountClass::OwnerPersonal);
    assert_eq!(pos.account_class.label(), "Patron Şahsi");
}

// ============================================================================
// BİRLEŞTİRME — beş sınıfın toplamı tek net rakamda
// ============================================================================

#[tokio::test]
async fn five_account_classes_merge_into_one_net_number() {
    let p = pool().await;
    seed_directory(&p, "dir_sup", "Toptancı", "SUPPLIER").await;
    seed_directory(&p, "dir_cus", "Müşteri", "CUSTOMER").await;
    seed_directory(&p, "dir_stf", "Personel", "STAFF").await;
    seed_directory(&p, "dir_fix", "Sabit Gider", "FIXED_EXPENSE").await;
    seed_directory(&p, "dir_own", "Patron Şahsi", "OWNER_PERSONAL").await;

    seed_debt(&p, "d_1", "dir_sup", "TAKEN", 100_000).await; // borç
    seed_debt(&p, "d_2", "dir_cus", "GIVEN", 80_000).await; // alacak
    seed_debt(&p, "d_3", "dir_stf", "GIVEN", 10_000).await; // alacak
    seed_debt(&p, "d_4", "dir_fix", "TAKEN", 15_000).await; // borç
    seed_debt(&p, "d_5", "dir_own", "GIVEN", 5_000).await; // sermaye çekimi

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye hesaplanır");

    assert_eq!(r.receivable_cents, 90_000, "80k müşteri + 10k personel");
    assert_eq!(r.payable_cents, 115_000, "100k toptancı + 15k sabit gider");
    assert_eq!(r.owner_withdrawal_cents, 5_000);
    assert_eq!(
        r.net_balance_cents, -30_000,
        "90000 - 115000 - 5000 = -30000"
    );
    assert_eq!(r.by_class.len(), 5, "beş sınıfın toplamı dönmeli");
}

// ============================================================================
// KİRACİ İZOLASYONU
// ============================================================================

#[tokio::test]
async fn other_tenant_debt_is_excluded() {
    let p = pool().await;
    seed_directory(&p, "dir_cus", "Müşteri", "CUSTOMER").await;
    seed_debt(&p, "d_1", "dir_cus", "GIVEN", 10_000).await;

    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, status, is_cash, created_at)
         VALUES ('d_foreign', 'tenant_b', 'dir_cus', 'GIVEN', 999_000, 999_000,
                 'PENDING', 0, datetime('now'))",
    )
    .execute(&p)
    .await
    .expect("yabancı borç eklenir");

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye hesaplanır");

    assert_eq!(
        r.receivable_cents, 10_000,
        "başka kiracının 999000'i sızmamalı"
    );
    assert_eq!(r.net_balance_cents, 10_000);
}

// ============================================================================
// KAPALI KAYITLAR VE SIFIRLAR
// ============================================================================

#[tokio::test]
async fn paid_debts_are_excluded() {
    let p = pool().await;
    seed_directory(&p, "dir_cus", "Müşteri", "CUSTOMER").await;
    seed_debt(&p, "d_open", "dir_cus", "GIVEN", 10_000).await;
    seed_debt(&p, "d_paid", "dir_cus", "GIVEN", 90_000).await;

    sqlx::query("UPDATE debts SET status = 'PAID', remaining_amount_cents = 0 WHERE id = 'd_paid'")
        .execute(&p)
        .await
        .expect("borç kapanır");

    let r = net_balance(&p, TENANT, false).await.expect("net bakiye hesaplanır");

    assert_eq!(r.receivable_cents, 10_000, "ödenmiş borç sayılmamalı");
}

// ============================================================================
// AGENTS.md §3.4 — FİNANSAL SESSİZ HATA
// ============================================================================

#[test]
fn unknown_directory_type_returns_err_not_zero() {
    // Neden sınıflandırıcı doğrudan test ediliyor: `directories.type` sütununda
    // `CHECK` kısıtı var, yani veritabanı "GHOST" tipini zaten reddediyor.
    // Buna rağmen motor güvenli tarafta kalmalı: bilinmeyen tip sessizce
    // varsayılan sınıfa (alacak) düşürülürse patrona yanlış yönde net bakiye
    // bildirilir. Şema kısıtı kaldırılırsa hata mesajı ne diyeceğini burada
    // sabitliyoruz.
    let err = AccountClass::from_directory_type("GHOST")
        .expect_err("bilinmeyen tip hata dönmeli, varsayılan sınıf dönmemeli");

    assert!(
        err.contains("Bilinmeyen cari tipi"),
        "hata bilgi taşımalı, alınan: {}",
        err
    );
    assert!(
        err.contains("GHOST"),
        "hata hangi değeri reddettiğini söylemeli, alınan: {}",
        err
    );
}

#[test]
fn known_directory_types_map_to_distinct_classes() {
    assert_eq!(
        AccountClass::from_directory_type("SUPPLIER").unwrap(),
        AccountClass::Supplier
    );
    assert_eq!(
        AccountClass::from_directory_type("CUSTOMER").unwrap(),
        AccountClass::CustomerVeresiye
    );
    assert_eq!(
        AccountClass::from_directory_type("STAFF").unwrap(),
        AccountClass::Staff
    );
    assert_eq!(
        AccountClass::from_directory_type("FIXED_EXPENSE").unwrap(),
        AccountClass::FixedExpense
    );
    assert_eq!(
        AccountClass::from_directory_type("OWNER_PERSONAL").unwrap(),
        AccountClass::OwnerPersonal
    );
}

#[tokio::test]
async fn broken_column_returns_err_not_zero() {
    let p = pool().await;

    // `debts` tablosundaki para kolonunu düşürüp toplam sorgusunu kırıyoruz.
    sqlx::raw_sql("ALTER TABLE debts DROP COLUMN remaining_amount_cents")
        .execute(&p)
        .await
        .expect("kolon düşürülür");

    let result = net_balance(&p, TENANT, false).await;

    assert!(
        result.is_err(),
        "kırık şemada motor `Err` dönmeli; `0` değil. Sessiz sıfır P&L'yi bozardı."
    );
    let message = result.expect_err("hata bekleniyordu");
    assert!(
        message.contains("Açık bakiyeler okunamadı"),
        "hata bağlamı taşımalı, alınan: {}",
        message
    );
}

// ============================================================================
// SINIF ETİKETLERİ
// ============================================================================

#[test]
fn account_class_labels_are_turkish_and_distinct() {
    let classes = [
        AccountClass::Supplier,
        AccountClass::CustomerVeresiye,
        AccountClass::Staff,
        AccountClass::FixedExpense,
        AccountClass::OwnerPersonal,
    ];
    let labels: Vec<&str> = classes.iter().map(|c| c.label()).collect();
    let badges: Vec<&str> = classes.iter().map(|c| c.badge()).collect();

    assert_eq!(
        labels,
        vec![
            "Toptancı Borcu",
            "Müşteri Veresiye",
            "Personel",
            "Sabit Gider",
            "Patron Şahsi"
        ]
    );

    let mut unique_labels = labels.clone();
    unique_labels.sort();
    unique_labels.dedup();
    assert_eq!(unique_labels.len(), 5, "etiketler birbirinden ayrışmalı");

    let mut unique_badges = badges.clone();
    unique_badges.sort();
    unique_badges.dedup();
    assert_eq!(unique_badges.len(), 5, "rozetler birbirinden ayrışmalı");

    assert!(AccountClass::OwnerPersonal.is_equity_withdrawal());
    assert!(!AccountClass::Supplier.is_equity_withdrawal());
}

#[tokio::test]
async fn empty_ledger_returns_zero_without_error() {
    let p = pool().await;
    let r = net_balance(&p, TENANT, false).await.expect("boş defter hata vermemeli");

    assert_eq!(r.net_balance_cents, 0);
    assert!(r.positions.is_empty());
}

// ============================================================================
// VERESİYE İLE MASA KAPATMA — "KASA DEĞİŞMEDİ" KANITI
// ============================================================================

