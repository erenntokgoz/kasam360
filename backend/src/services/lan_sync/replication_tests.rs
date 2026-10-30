//! Gerçek SQLite dosyaları ve gerçek bağlantılarla çok cihazlı yazma ve arıza sınavı.
//!
//! Her test ayrı veritabanı ve eşitleme döngüsü kurar; cihaz kaybı döngünün kapatılmasıdır.
//! Yazmalar komutların kullandığı `begin_write` yolundan geçer.

use super::runtime::LanSync;
use super::write_tx::WritePool;
use crate::commands::{CartItemDto, PaymentPayloadDto};
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::order_settlement::settle_order_payment;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

pub(super) const TENANT: &str = "tnt_a";

pub(super) struct Device {
    pub(super) pool: SqlitePool,
    pub(super) sync: LanSync,
}

pub(super) async fn device(name: &str) -> Device {
    let dir = std::env::temp_dir().join(format!("kasam360_rep_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("klasör");
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(dir.join(format!("{name}.sqlite")))
                .create_if_missing(true)
                .foreign_keys(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
                .busy_timeout(Duration::from_secs(5)),
        )
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    let sync = LanSync::new(pool.clone(), Arc::new(Mutex::new(())), "127.0.0.1");
    Device { pool, sync }
}

macro_rules! wait_until {
    ($what:literal, $condition:expr) => {{
        let mut satisfied = false;
        for _ in 0..300 {
            if $condition {
                satisfied = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(satisfied, "beklenen durum oluşmadı: {}", $what);
    }};
}

pub(super) use wait_until;

async fn seed(pool: &SqlitePool) {
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
         INSERT INTO users (id, tenant_id, role, name) VALUES ('usr_1', 'tnt_a', 'OWNER', 'Sahip');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents)
            VALUES ('prd_1', 'tnt_a', 'cat_1', 'Çay', 1000);
         INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity,
                                        remaining_quantity, unit_cost_cents)
            VALUES ('bat_1', 'tnt_a', 'prd_1', 50, 50, 10);
         INSERT INTO tables (id, tenant_id, name, status, current_total)
            VALUES ('tbl_1', 'tnt_a', 'Masa 1', 'OCCUPIED', 1000);
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents)
            VALUES ('ord_1', 'tnt_a', 'tbl_1', 'IN_PROGRESS', 1000);
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents, status)
            VALUES ('itm_1', 'tnt_a', 'ord_1', 'prd_1', 1, 1000, 'Pending');",
    )
    .execute(pool)
    .await
    .expect("işletme");
}

/// Otorite yük altında değişebilir; reddedilen katılım yeni kodla güncel otoriteden tekrarlanır.
pub(super) async fn join_cluster(devices: &[Device], next: &Device) {
    let mut last = String::new();
    for _ in 0..20 {
        let Some(authority) = devices
            .iter()
            .find(|device| device.sync.status().role == Some(super::engine::Role::Leader))
        else {
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        };
        let code = authority
            .sync
            .create_pairing_code(TENANT, "Kasa", "127.0.0.1", 0)
            .await;
        let joined = match code {
            Ok((code, _)) => next.sync.join(&code, TENANT, "Terminal", 0).await,
            Err(error) => Err(error),
        };
        match joined {
            Ok(()) => return,
            Err(error) => last = error,
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("katılım başarısız: {last}");
}

/// Kümeyi kurar; dönen cihazların ilki başlangıçtaki otoritedir.
pub(super) async fn cluster(count: usize) -> Vec<Device> {
    let first = device("d0").await;
    seed(&first.pool).await;
    let mut devices = vec![first];
    devices[0]
        .sync
        .create_pairing_code(TENANT, "Kasa", "127.0.0.1", 0)
        .await
        .expect("kod");
    wait_until!("otorite", devices[0].sync.status().state == "READY");
    for index in 1..count {
        let next = device(&format!("d{index}")).await;
        join_cluster(&devices, &next).await;
        devices.push(next);
        for existing in &devices {
            wait_until!(
                "üyelik yayıldı",
                existing.sync.status().members.len() == index + 1
                    && existing.sync.status().state == "READY"
            );
        }
    }
    devices
}

pub(super) async fn add_product(pool: &SqlitePool, id: &str) -> Result<(), String> {
    let mut tx = pool.begin_write().await?;
    sqlx::query(
        "INSERT INTO products (id, tenant_id, category_id, name, price_cents)
         VALUES (?, 'tnt_a', 'cat_1', 'Yeni', 500)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await
}

/// Kasiyerin yapacağı gibi yeniden dener. Sonucu belirsiz işlemde önce kayda bakar:
/// aynı satırı ikinci kez yazmak yerine yazılıp yazılmadığını sorar.
pub(super) async fn add_with_retry(pool: &SqlitePool, id: &str) -> Result<(), String> {
    let mut last = String::new();
    for _ in 0..40 {
        if has_product(pool, id).await {
            return Ok(());
        }
        match add_product(pool, id).await {
            Err(error)
                if [
                    "SYNC_RETRY",
                    "QUORUM_LOST",
                    "NO_CONNECTION",
                    "PENDING_RESULT",
                ]
                .iter()
                .any(|code| error.starts_with(code)) =>
            {
                last = error;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            other => return other,
        }
    }
    Err(last)
}

pub(super) async fn has_product(pool: &SqlitePool, id: &str) -> bool {
    let found: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("sorgu");
    found == 1
}

fn cash_payment(id: &str) -> PaymentPayloadDto {
    PaymentPayloadDto {
        transaction_id: id.to_string(),
        order_id: Some("ord_1".to_string()),
        timestamp: "2026-10-30T10:00:00Z".to_string(),
        method: "CASH".to_string(),
        amount_tendered: 1000,
        total_amount: 1000,
        change_amount: None,
        items: vec![CartItemDto {
            id: "itm_1".to_string(),
            product: serde_json::json!({}),
            quantity: 1,
            ..CartItemDto::default()
        }],
        splits: None,
        notes: None,
        customer_ref: None,
        cashier_id: Some("usr_1".to_string()),
        terminal_id: None,
        idempotency_key: None,
        global_discount: None,
        approval_token: None,
        actor_id: Some("usr_1".to_string()),
        debt_directory_id: None,
    }
}

async fn pay(pool: &SqlitePool, id: &str) -> Result<(), String> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    settle_order_payment(&mut tx, &lock, &cash_payment(id), TENANT, "OWNER").await?;
    tx.commit().await
}

/// Otorite el değiştirirken istemci gibi yeniden dener; `SYNC_RETRY` asıl sınavdır, kalır.
async fn pay_through_failover(pool: &SqlitePool, id: &str) -> Result<(), String> {
    for _ in 0..40 {
        match pay(pool, id).await {
            Err(error)
                if error.starts_with("QUORUM_LOST") || error.starts_with("NO_CONNECTION") =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            other => return other,
        }
    }
    Err("QUORUM_LOST: süre doldu".to_string())
}

async fn sales(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE event_type = 'SALE_SETTLED'")
        .fetch_one(pool)
        .await
        .expect("satış")
}

async fn stock(pool: &SqlitePool) -> f64 {
    sqlx::query_scalar("SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_1'")
        .fetch_one(pool)
        .await
        .expect("stok")
}

async fn audit_tail(pool: &SqlitePool) -> (i64, String) {
    sqlx::query_as("SELECT COUNT(*), COALESCE(MAX(current_hash), '') FROM audit_ledger")
        .fetch_one(pool)
        .await
        .expect("defter")
}

pub(super) async fn state_index(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT state_index FROM sync_cluster")
        .fetch_one(pool)
        .await
        .expect("durum")
}

#[tokio::test]
async fn takipciden_yazma_cogunlukla_iki_cihaza_da_yazilir() {
    let devices = cluster(2).await;
    add_with_retry(&devices[1].pool, "prd_b")
        .await
        .expect("takipçi");
    assert!(
        has_product(&devices[1].pool, "prd_b").await,
        "cevaptan önce uygulanır"
    );
    wait_until!("otorite aldı", has_product(&devices[0].pool, "prd_b").await);

    add_with_retry(&devices[0].pool, "prd_a")
        .await
        .expect("otorite");
    wait_until!("takipçi aldı", has_product(&devices[1].pool, "prd_a").await);
}

#[tokio::test]
async fn denetim_zinciri_iki_cihazda_birebir_ayni_kalir() {
    let devices = cluster(2).await;
    for (index, device) in devices.iter().enumerate() {
        let mut written = Err(String::new());
        for _ in 0..40 {
            let mutex = Mutex::new(());
            let lock = AuditLock::new(mutex.lock().await);
            let mut tx = device.pool.begin_write().await.expect("tx");
            let ctx = AuditContext::new(
                TENANT.to_string(),
                "usr_1".to_string(),
                "OWNER".to_string(),
                category::FINANS,
                "test:zincir",
                format!("kayit_{index}"),
                serde_json::json!({ "sira": index }),
                chrono::Utc::now().to_rfc3339(),
            )
            .expect("kayıt");
            AuditService::append(&mut tx, &lock, &ctx)
                .await
                .expect("defter");
            written = tx.commit().await;
            if written.is_ok() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        written.expect("onay");
        wait_until!(
            "iki cihaz aynı durumda",
            state_index(&devices[0].pool).await == state_index(&devices[1].pool).await
        );
    }
    assert_eq!(
        audit_tail(&devices[0].pool).await,
        audit_tail(&devices[1].pool).await
    );
}

#[tokio::test]
async fn ayni_kalemi_iki_kasa_ayni_anda_tahsil_edemez() {
    let devices = cluster(2).await;
    let (first, second) = tokio::join!(
        pay_through_failover(&devices[0].pool, "txn_a"),
        pay_through_failover(&devices[1].pool, "txn_b")
    );
    let accepted = [first.is_ok(), second.is_ok()]
        .iter()
        .filter(|ok| **ok)
        .count();
    assert_eq!(accepted, 1, "{first:?} {second:?}");

    for device in &devices {
        for _ in 0..200 {
            if sales(&device.pool).await == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(
            sales(&device.pool).await,
            1,
            "{:?} {:?} {:?}",
            device.sync.status().detail,
            device.sync.status().state,
            (&first, &second)
        );
        assert_eq!(stock(&device.pool).await, 49.0, "stok tek kez düşer");
    }
    // Reddedilen kasa aynı isteği yeniler: taze durumda hesabın kapandığını görür.
    let loser = if first.is_err() {
        &devices[0]
    } else {
        &devices[1]
    };
    let retry = pay_through_failover(&loser.pool, "txn_c")
        .await
        .expect_err("kapalı adisyon");
    assert!(retry.starts_with("ORDER_CLOSED"), "{retry}");
    assert_eq!(sales(&devices[0].pool).await, 1);
}

#[tokio::test]
async fn ayni_masaya_es_zamanli_yazmalar_kaybolmaz() {
    let devices = cluster(3).await;
    let (a, b, c) = tokio::join!(
        add_with_retry(&devices[0].pool, "prd_0"),
        add_with_retry(&devices[1].pool, "prd_1b"),
        add_with_retry(&devices[2].pool, "prd_2")
    );
    a.expect("birinci");
    b.expect("ikinci");
    c.expect("üçüncü");
    for device in &devices {
        for id in ["prd_0", "prd_1b", "prd_2"] {
            wait_until!("satır ulaştı", has_product(&device.pool, id).await);
        }
    }
}
