//! Tekrar uygulama ve sonuç sorgulama testleri.
//!
//! İki süreçli test, bu test ikilisini ikinci kez başlatır: alt süreç kendi
//! SQLite dosyasını açar, işlemi uygular ve hata senaryosunda yanıt vermeden
//! ölür. Bellek içi iki havuz bu durumu kanıtlayamazdı.

use super::*;
use crate::services::audit_service::AuditLock;
use crate::services::cari::{CardFields, CariOp, OpenDebtInput, RecordPaymentInput};
use serde_json::json;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::{Path, PathBuf};
use std::process::Command;
use tokio::sync::Mutex;

const TENANT: &str = "tnt_a";
const CHILD_DB: &str = "KASAM360_TEST_CHILD_DB";
const CHILD_OP: &str = "KASAM360_TEST_CHILD_OP";
const CHILD_MODE: &str = "KASAM360_TEST_CHILD_MODE";
const CHILD_TEST: &str = "services::lan_sync::op_log::tests::alt_surec_girisi";

async fn file_pool(path: &Path) -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("dosya veritabanı açılır");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    pool
}

fn operation(id: &str, intent: &str, op: CariOp) -> Operation {
    Operation {
        operation_id: id.to_string(),
        tenant_id: TENANT.to_string(),
        device_id: "dev_a".to_string(),
        actor_id: "usr_1".to_string(),
        actor_role: "OWNER".to_string(),
        intent_sha256: intent_hash(op.kind(), &json!(intent)),
        op: LogOp::Cari(Box::new(op)),
        created_at: "2026-10-30T10:00:00Z".to_string(),
    }
}

fn card_op() -> Operation {
    operation(
        "op_card",
        "card",
        CariOp::CreateCard {
            directory_type: "CUSTOMER".to_string(),
            card: CardFields {
                directory_id: "dir_1".to_string(),
                name: "Ayşe Yıldız".to_string(),
                phone: None,
                email: None,
                tax_no: None,
                tax_office: None,
                address: None,
                credit_limit_cents: None,
                notes: None,
            },
            created_at: "2026-10-30T10:00:00Z".to_string(),
        },
    )
}

fn debt_op() -> Operation {
    operation(
        "op_debt",
        "debt",
        CariOp::OpenDebt(OpenDebtInput {
            debt_id: "dbt_1".to_string(),
            directory_id: "dir_1".to_string(),
            debt_type: "GIVEN".to_string(),
            amount_cents: 10_000,
            due_date: Some("2026-11-15".to_string()),
            is_cash: false,
            order_id: None,
            description: None,
            created_at: "2026-10-30T10:00:00Z".to_string(),
        }),
    )
}

fn payment_op(operation_id: &str, amount_cents: i64, expected_version: i64) -> Operation {
    operation(
        operation_id,
        &format!("pay:{amount_cents}"),
        CariOp::RecordPayment(RecordPaymentInput {
            payment_id: format!("pmt_{operation_id}"),
            debt_id: "dbt_1".to_string(),
            amount_cents,
            payment_method: "BANK_TRANSFER".to_string(),
            actor_id: "usr_1".to_string(),
            notes: None,
            expected_version,
            cash_movement_id: None,
            shift_id: None,
            created_at: "2026-10-30T11:00:00Z".to_string(),
        }),
    )
}

async fn run(pool: &SqlitePool, mutex: &Mutex<()>, op: &Operation) -> OperationOutcome {
    let lock = AuditLock::new(mutex.lock().await);
    execute_local(pool, &lock, op).await.expect("işlem yürür")
}

async fn remaining(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar(
        "SELECT remaining_amount_cents FROM debts WHERE id = 'dbt_1' AND tenant_id = ?",
    )
    .bind(TENANT)
    .fetch_one(pool)
    .await
    .expect("bakiye okunur")
}

async fn payment_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM debt_payments WHERE tenant_id = ?")
        .bind(TENANT)
        .fetch_one(pool)
        .await
        .expect("ödeme sayısı okunur")
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kasam360_{name}_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("geçici klasör açılır");
    dir
}

#[tokio::test]
async fn ayni_kimlik_bir_kez_uygulanir_ve_ayni_sonucu_doner() {
    let dir = temp_dir("tekrar");
    let pool = file_pool(&dir.join("a.sqlite")).await;
    let mutex = Mutex::new(());
    run(&pool, &mutex, &card_op()).await;
    run(&pool, &mutex, &debt_op()).await;

    let first = run(&pool, &mutex, &payment_op("op_pay", 4_000, 0)).await;
    let second = run(&pool, &mutex, &payment_op("op_pay", 4_000, 0)).await;

    assert_eq!(first, second);
    assert_eq!(first.status, OperationStatus::Applied);
    assert_eq!(remaining(&pool).await, 6_000);
    assert_eq!(payment_count(&pool).await, 1);
}

#[tokio::test]
async fn ayni_kimlik_farkli_icerikle_reddedilir() {
    let dir = temp_dir("catisma");
    let pool = file_pool(&dir.join("a.sqlite")).await;
    let mutex = Mutex::new(());
    run(&pool, &mutex, &card_op()).await;
    run(&pool, &mutex, &debt_op()).await;
    run(&pool, &mutex, &payment_op("op_pay", 4_000, 0)).await;

    let lock = AuditLock::new(mutex.lock().await);
    let error = execute_local(&pool, &lock, &payment_op("op_pay", 9_000, 0))
        .await
        .expect_err("farklı içerik reddedilir");
    assert!(error.starts_with("CONFLICT"), "{error}");
    assert_eq!(remaining(&pool).await, 6_000);
}

#[tokio::test]
async fn is_kurali_reddi_kalici_sonuctur_ve_para_yazmaz() {
    let dir = temp_dir("red");
    let pool = file_pool(&dir.join("a.sqlite")).await;
    let mutex = Mutex::new(());
    run(&pool, &mutex, &card_op()).await;
    run(&pool, &mutex, &debt_op()).await;

    let rejected = run(&pool, &mutex, &payment_op("op_over", 50_000, 0)).await;
    let repeated = run(&pool, &mutex, &payment_op("op_over", 50_000, 0)).await;

    assert_eq!(rejected.status, OperationStatus::Rejected);
    assert_eq!(rejected, repeated);
    assert_eq!(remaining(&pool).await, 10_000);
    assert_eq!(payment_count(&pool).await, 0);
    let audit: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_ledger WHERE tenant_id = ? AND action = 'debt:paid'",
    )
    .bind(TENANT)
    .fetch_one(&pool)
    .await
    .expect("denetim okunur");
    assert_eq!(audit, 0, "reddedilen ödeme denetim zincirine işlenmez");
}

#[tokio::test]
async fn eski_gorunumle_ikinci_odeme_reddedilir() {
    let dir = temp_dir("surum");
    let pool = file_pool(&dir.join("a.sqlite")).await;
    let mutex = Mutex::new(());
    run(&pool, &mutex, &card_op()).await;
    run(&pool, &mutex, &debt_op()).await;
    run(&pool, &mutex, &payment_op("op_a", 4_000, 0)).await;

    let stale = run(&pool, &mutex, &payment_op("op_b", 4_000, 0)).await;

    assert_eq!(stale.status, OperationStatus::Rejected);
    assert!(stale.error.expect("hata").starts_with("CONFLICT"));
    assert_eq!(remaining(&pool).await, 6_000);
}

#[tokio::test]
async fn sonuc_baska_kiraciya_sizmaz() {
    let dir = temp_dir("kiraci");
    let pool = file_pool(&dir.join("a.sqlite")).await;
    let mutex = Mutex::new(());
    run(&pool, &mutex, &card_op()).await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    assert!(lookup(&mut conn, "tnt_b", "op_card", None).await.is_err());
    assert!(lookup(&mut conn, "tnt_b", "op_yok", None)
        .await
        .expect("sorgu")
        .is_none());
}

fn spawn_child(db: &Path, op: &Operation, mode: &str) -> std::process::Output {
    Command::new(std::env::current_exe().expect("test ikilisi"))
        .args([CHILD_TEST, "--exact", "--nocapture", "--test-threads=1"])
        .env(CHILD_DB, db)
        .env(CHILD_OP, serde_json::to_string(op).expect("işlem kodlanır"))
        .env(CHILD_MODE, mode)
        .output()
        .expect("alt süreç çalışır")
}

fn child_outcome(output: &std::process::Output) -> OperationOutcome {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .find_map(|line| line.split_once("OUTCOME=").map(|(_, value)| value))
        .unwrap_or_else(|| panic!("alt süreç sonuç vermedi: {stdout}"));
    serde_json::from_str(line).expect("sonuç çözülür")
}

/// Normal test turunda boş geçer; yalnız iki süreçli test bu girişi çağırır.
#[tokio::test]
async fn alt_surec_girisi() {
    let Ok(db) = std::env::var(CHILD_DB) else {
        return;
    };
    let pool = file_pool(Path::new(&db)).await;
    let op: Operation =
        serde_json::from_str(&std::env::var(CHILD_OP).expect("işlem")).expect("işlem çözülür");
    let mutex = Mutex::new(());
    match std::env::var(CHILD_MODE).expect("kip").as_str() {
        "QUERY" => {
            let mut conn = pool.acquire().await.expect("bağlantı");
            let outcome = lookup(&mut conn, TENANT, &op.operation_id, None)
                .await
                .expect("sorgu")
                .unwrap_or_else(|| OperationOutcome::unknown(&op.operation_id));
            println!("OUTCOME={}", serde_json::to_string(&outcome).expect("kod"));
        }
        // Kalıcı yazmadan sonra, yanıttan önce ölüm: istemci sonucu göremez.
        "CRASH_AFTER_COMMIT" => {
            run(&pool, &mutex, &op).await;
            pool.close().await;
            std::process::exit(9);
        }
        _ => {
            let outcome = run(&pool, &mutex, &op).await;
            println!("OUTCOME={}", serde_json::to_string(&outcome).expect("kod"));
        }
    }
}

#[tokio::test]
async fn iki_surec_ve_iki_dosyada_islem_bir_kez_uygulanir_sonuc_sorgulanir() {
    let dir = temp_dir("iki_surec");
    let (db_a, db_b) = (dir.join("a.sqlite"), dir.join("b.sqlite"));
    let source = file_pool(&db_a).await;
    let mutex = Mutex::new(());
    let setup = [card_op(), debt_op()];
    for op in &setup {
        run(&source, &mutex, op).await;
        let output = spawn_child(&db_b, op, "APPLY");
        assert_eq!(child_outcome(&output).status, OperationStatus::Applied);
    }

    // Kaynakta uygulanan ödeme hedef süreçte ilk kez, sonra tekrar uygulanır.
    let payment = payment_op("op_pay", 4_000, 0);
    let on_source = run(&source, &mutex, &payment).await;
    let first = child_outcome(&spawn_child(&db_b, &payment, "APPLY"));
    let repeat = child_outcome(&spawn_child(&db_b, &payment, "APPLY"));
    assert_eq!(on_source, first, "iki cihazda aynı kalıcı sonuç oluşmalı");
    assert_eq!(first, repeat);

    // Hedef süreç kalıcı yazmadan sonra yanıt vermeden ölür.
    let second_payment = payment_op("op_crash", 1_000, 1);
    let crashed = spawn_child(&db_b, &second_payment, "CRASH_AFTER_COMMIT");
    assert_eq!(
        crashed.status.code(),
        Some(9),
        "alt süreç yanıt vermeden ölmeli"
    );

    // İstemci körlemesine ikinci kez yazmaz: önce sorar, sonra tekrarda da
    // tek ödeme kalır.
    let queried = child_outcome(&spawn_child(&db_b, &second_payment, "QUERY"));
    assert_eq!(queried.status, OperationStatus::Applied);
    let retried = child_outcome(&spawn_child(&db_b, &second_payment, "APPLY"));
    assert_eq!(queried, retried);

    let unseen = child_outcome(&spawn_child(&db_b, &payment_op("op_yok", 1, 2), "QUERY"));
    assert_eq!(unseen.status, OperationStatus::Unknown);

    let target = file_pool(&db_b).await;
    assert_eq!(remaining(&target).await, 5_000);
    assert_eq!(payment_count(&target).await, 2);
    assert_eq!(remaining(&source).await, 6_000);
}
