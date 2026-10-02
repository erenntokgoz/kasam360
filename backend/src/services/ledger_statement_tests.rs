//! Cari ekstre ve tediye makbuzu testleri (Faz 9).
//!
//! Kapsam: yön işareti, açılış bakiyesi, kiracı izolasyonu, kronolojik sıra,
//! sessiz hata yasağı ve 80mm sütun genişliği.

use crate::services::ledger_statement::{
    directory_statement, format_cents, payment_receipt_lines, ReceiptLine,
};
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

async fn seed_directory(
    pool: &sqlx::SqlitePool,
    id: &str,
    tenant: &str,
    name: &str,
    dir_type: &str,
) {
    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, credit_limit_cents, created_at)
         VALUES (?, ?, ?, ?, 0, datetime('now'))",
    )
    .bind(id)
    .bind(tenant)
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
    amount: i64,
    created_at: &str,
) {
    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, status, is_cash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)",
    )
    .bind(id)
    .bind(TENANT)
    .bind(directory_id)
    .bind(debt_type)
    .bind(amount)
    .bind(amount)
    .bind(created_at)
    .execute(pool)
    .await
    .expect("borç kaydı eklenir");
}

async fn seed_payment(
    pool: &sqlx::SqlitePool,
    id: &str,
    debt_id: &str,
    amount: i64,
    created_at: &str,
) {
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
    .expect("tahsilat kaydı eklenir");
}

const FROM: &str = "2026-10-01";
const TO: &str = "2026-10-31";

// ============================================================================
// MÜŞTERİ EKSTRESİ — yön: veresiye artırır, tahsilat azaltır
// ============================================================================

#[tokio::test]
async fn customer_statement_open_raises_and_payment_lowers_balance() {
    let p = pool().await;
    seed_directory(&p, "dir_cus", TENANT, "Müşteri Ayşe", "CUSTOMER").await;
    seed_debt(&p, "debt_1", "dir_cus", "GIVEN", 87_500, "2026-10-05 10:00:00").await;
    seed_payment(&p, "pay_1", "debt_1", 37_500, "2026-10-20 12:00:00").await;

    let s = directory_statement(&p, TENANT, "dir_cus", FROM, TO)
        .await
        .expect("ekstre üretilir");

    assert_eq!(s.opening_balance_cents, 0);
    assert_eq!(s.lines.len(), 2, "bir borç + bir tahsilat");
    assert_eq!(s.lines[0].kind, "BORC_ACILDI");
    assert_eq!(s.lines[0].signed_amount_cents, 87_500, "veresiye bakiyeyi artırır");
    assert_eq!(s.lines[0].balance_after_cents, 87_500);
    assert_eq!(s.lines[1].kind, "TAHSILAT");
    assert_eq!(s.lines[1].signed_amount_cents, -37_500, "tahsilat bakiyeyi azaltır");
    assert_eq!(s.lines[1].balance_after_cents, 50_000);
    assert_eq!(s.closing_balance_cents, 50_000);
    assert_eq!(s.total_debit_cents, 87_500);
    assert_eq!(s.total_credit_cents, 37_500);
}

// ============================================================================
// TOPTANCI EKSTRESİ — yön tersten okunur
// ============================================================================

#[tokio::test]
async fn supplier_statement_reads_direction_in_reverse() {
    let p = pool().await;
    seed_directory(&p, "dir_sup", TENANT, "Toptancı Ltd.", "SUPPLIER").await;
    seed_debt(&p, "debt_2", "dir_sup", "TAKEN", 200_000, "2026-10-03 09:00:00").await;
    seed_payment(&p, "pay_2", "debt_2", 200_000, "2026-10-18 09:00:00").await;

    let s = directory_statement(&p, TENANT, "dir_sup", FROM, TO)
        .await
        .expect("ekstre üretilir");

    assert_eq!(s.lines[0].kind, "BORC_ACILDI");
    assert_eq!(
        s.lines[0].signed_amount_cents, -200_000,
        "toptancıya borçlanmak bakiyeyi azaltır: net bakiye ile aynı yön"
    );
    assert_eq!(s.lines[0].balance_after_cents, -200_000);
    assert_eq!(
        s.lines[1].kind, "TEDIYE",
        "toplancıya ödeme 'tahsilat' değil 'tediye' olarak adlandırılır"
    );
    assert_eq!(
        s.lines[1].signed_amount_cents, 200_000,
        "toplancıya ödedikçe borc kapanır, bakiye sıfıra döner"
    );
    assert_eq!(
        s.closing_balance_cents, 0,
        "tüm borç ödendi: ekstre kapanışta sıfır olmalı"
    );
    assert_eq!(
        s.total_credit_cents, 200_000,
        "kredi (alacak) toplamı alışverişi gösterir"
    );
}

// ============================================================================
// AÇILIŞ BAKİYESİ
// ============================================================================

#[tokio::test]
async fn prior_period_debt_flows_into_opening_balance() {
    let p = pool().await;
    seed_directory(&p, "dir_cus", TENANT, "Müşteri Ayşe", "CUSTOMER").await;
    seed_debt(&p, "debt_old", "dir_cus", "GIVEN", 120_000, "2026-09-12 15:00:00").await;
    seed_debt(&p, "debt_new", "dir_cus", "GIVEN", 30_000, "2026-10-05 15:00:00").await;

    let s = directory_statement(&p, TENANT, "dir_cus", FROM, TO)
        .await
        .expect("ekstre üretilir");

    assert_eq!(
        s.opening_balance_cents, 120_000,
        "önceki dönemin borcu açılışa taşınmalı"
    );
    assert_eq!(s.lines.len(), 1, "yalnız dönem içi hareket satır olur");
    assert_eq!(s.lines[0].balance_after_cents, 150_000);
    assert_eq!(s.closing_balance_cents, 150_000);
}

#[tokio::test]
async fn paid_prior_debt_is_not_carried_into_opening() {
    let p = pool().await;
    seed_directory(&p, "dir_cus", TENANT, "Müşteri Ayşe", "CUSTOMER").await;
    seed_debt(&p, "debt_old", "dir_cus", "GIVEN", 120_000, "2026-09-12 15:00:00").await;
    seed_payment(&p, "pay_old", "debt_old", 120_000, "2026-09-20 15:00:00").await;
    sqlx::query("UPDATE debts SET status = 'PAID', remaining_amount_cents = 0 WHERE id = ?")
        .bind("debt_old")
        .execute(&p)
        .await
        .expect("borç kapanır");

    let s = directory_statement(&p, TENANT, "dir_cus", FROM, TO)
        .await
        .expect("ekstre üretilir");

    assert_eq!(
        s.opening_balance_cents, 0,
        "geçen dönem kapanmış borç açılışa taşınmaz"
    );
    assert_eq!(s.closing_balance_cents, 0);
}

// ============================================================================
// SIRALAMA, İZOLASYON, HATA
// ============================================================================

#[tokio::test]
async fn statement_lines_are_chronological() {
    let p = pool().await;
    seed_directory(&p, "dir_cus", TENANT, "Müşteri Ayşe", "CUSTOMER").await;
    seed_debt(&p, "debt_1", "dir_cus", "GIVEN", 10_000, "2026-10-25 20:00:00").await;
    seed_payment(&p, "pay_1", "debt_1", 4_000, "2026-10-02 08:00:00").await;
    seed_debt(&p, "debt_2", "dir_cus", "GIVEN", 6_000, "2026-10-11 08:00:00").await;

    let s = directory_statement(&p, TENANT, "dir_cus", FROM, TO)
        .await
        .expect("ekstre üretilir");

    assert_eq!(s.lines[0].created_at, "2026-10-02 08:00:00");
    assert_eq!(s.lines[1].created_at, "2026-10-11 08:00:00");
    assert_eq!(s.lines[2].created_at, "2026-10-25 20:00:00");
    assert_eq!(
        s.closing_balance_cents, 12_000,
        "sıralama görüntüsel; yürüyen bakiye toplamla tutmalı"
    );
}

#[tokio::test]
async fn statement_excludes_other_tenant_directory() {
    let p = pool().await;
    seed_directory(&p, "dir_cus", TENANT, "Müşteri Ayşe", "CUSTOMER").await;
    seed_directory(&p, "dir_yd", "tenant_b", "Yabancı", "CUSTOMER").await;

    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, status, is_cash, created_at)
         VALUES ('debt_x', 'tenant_b', 'dir_yd', 'GIVEN', 999_999, 999_999, 'PENDING', 0,
                 '2026-10-05 10:00:00')",
    )
    .execute(&p)
    .await
    .expect("yabancı borç eklenir");

    let s = directory_statement(&p, TENANT, "dir_cus", FROM, TO)
        .await
        .expect("ekstre üretilir");

    assert_eq!(s.closing_balance_cents, 0, "başka kiracının 999.999 TL'si sızmamalı");
    assert!(s.lines.is_empty());
}

#[tokio::test]
async fn unknown_directory_returns_err() {
    let p = pool().await;
    let result = directory_statement(&p, TENANT, "dir_yok", FROM, TO).await;
    assert!(result.is_err(), "olmayan cari kart ekstre üretmemeli");
}

#[tokio::test]
async fn broken_debt_column_returns_err_not_zero() {
    // AGENTS.md §3.4: ekstre "0,00 TL bakiye" derse patron borcunu yok sayar.
    // Bozuk kolon hata dönmeli.
    let p = pool().await;
    seed_directory(&p, "dir_cus", TENANT, "Müşteri Ayşe", "CUSTOMER").await;
    seed_debt(&p, "debt_1", "dir_cus", "GIVEN", 50_000, "2026-10-05 10:00:00").await;

    sqlx::raw_sql("ALTER TABLE debts DROP COLUMN total_amount_cents")
        .execute(&p)
        .await
        .expect("kolon düşürülür");

    let result = directory_statement(&p, TENANT, "dir_cus", FROM, TO).await;

    assert!(
        result.is_err(),
        "kırık borç tablosunda `Err` dönmeli; sessiz 0 dönmemeli"
    );
}

// ============================================================================
// PARA BİÇİMLENDİRME
// ============================================================================

#[test]
fn format_cents_uses_turkish_thousands_separator() {
    assert_eq!(format_cents(0), "0.00 TL");
    assert_eq!(format_cents(5), "0.05 TL");
    assert_eq!(format_cents(87_500), "875.00 TL");
    assert_eq!(format_cents(1_234_567), "12.345.67 TL");
    assert_eq!(format_cents(1_000_000_00), "1.000.000.00 TL");
    assert_eq!(format_cents(-30_000), "-300.00 TL", "aşım negatif işaretlenmeli");
}

// ============================================================================
// 80mm TERMAL MAKBUZ
// ============================================================================

#[test]
fn receipt_lines_fit_80mm_and_carry_totals() {
    let lines: Vec<ReceiptLine> = payment_receipt_lines(
        "Müşteri Ayşe",
        "debt_01JABCDEFGHIJKLMNOP",
        "pay_01JQRSTUVWXYZ012345",
        37_500,
        50_000,
        "Nakit",
        "KISMEN ÖDENDİ",
        "2026-10-20 12:00:00",
    );

    let texts: Vec<&str> = lines.iter().map(|l| l.text.as_str()).collect();
    let joined = texts.join("\n");

    for line in texts.iter() {
        assert!(
            line.chars().count() <= 32,
            "80mm termal 32 sütun: {:?} aşıyor",
            line
        );
    }
    assert!(joined.contains("TEDIYE MAKBUZU"));
    assert!(joined.contains("Müşteri Ayşe"));
    assert!(joined.contains("375.00 TL"), "tahsilat tutarı makbuzda görünmeli");
    assert!(joined.contains("500.00 TL"), "kalan borç makbuzda görünmeli");
    assert!(
        joined.contains("Imza"),
        "imza alanı olmadan tediye makbuzu hukuken değersizdir"
    );
    assert!(joined.contains("Alik"));
}

#[test]
fn short_and_non_ascii_ids_do_not_panic() {
    // Neden: kimlik kısaltması bayt dilimiyle yapılırsa Türkçe karakterde
    // karakter sınırına ulaşmadan panik verir (AGENTS.md §3.1 panik yasağı).
    let lines = payment_receipt_lines(
        "Şahıs Şirketi Ğü Ö Ç",
        "kısa",
        "k",
        100,
        0,
        "Nakit",
        "ÖDENDİ",
        "2026-10-20",
    );
    for line in lines.iter() {
        assert!(line.text.chars().count() <= 32);
    }
    let texts: Vec<&str> = lines.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.join("\n").contains("Şahıs Şirketi Ğü Ö Ç"));
}