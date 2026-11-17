//! Tahsilat kapısı, ayar ve günlük testleri (simülatöre karşı).
//! Gerçek cihazla yapılmış sınama DEĞİLDİR.

use std::sync::Arc;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::gate::{self, DeviceConnector, SystemConnector};
use super::pairing::RejectingVerifier;
use super::receipt_draft::draft_for_payment;
use super::receipt_log;
use super::session::{OkcClient, SoftwareIdentity};
use super::settings::{self, ConnectionKind, OkcSettings};
use super::simulator::{
    Fault, SimulatedRegister, SimulatorTransport, SimulatorVerifier, SIMULATOR_SERIAL,
};
use super::types::{OkcError, OkcResult, TenderKind};
use crate::commands::{CartItemDto, PaymentPayloadDto, SplitPaymentDto};

const T: &str = "tnt_a";

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .in_memory(true)
                .foreign_keys(true),
        )
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents, tax_rate_bp) VALUES
            ('prd_1', 'tnt_a', 'cat_1', 'Çay', 100, 1000), ('prd_2', 'tnt_a', 'cat_1', 'Tost', 3000, 1000);
         INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES ('tbl_1', 'tnt_a', 'Masa 1', 'OCCUPIED', 3300);
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents) VALUES ('ord_1', 'tnt_a', 'tbl_1', 'IN_PROGRESS', 3300);
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status) VALUES
            ('itm_1', 'tnt_a', 'ord_1', 'prd_1', 3, 100, 1000, 273, 27, 300, 'Pending'),
            ('itm_2', 'tnt_a', 'ord_1', 'prd_2', 1, 3000, 1000, 2727, 273, 3000, 'Pending');",
    )
    .execute(&pool)
    .await
    .expect("adisyon");
    pool
}

struct SimConnector(SimulatedRegister);

impl DeviceConnector for SimConnector {
    fn connect(&self, _: &OkcSettings) -> OkcResult<OkcClient> {
        let mut client = OkcClient::new(
            Box::new(SimulatorTransport::new(self.0.clone())),
            SIMULATOR_SERIAL,
            Duration::from_millis(50),
            SoftwareIdentity::default(),
        );
        client.pair(&SimulatorVerifier)?;
        Ok(client)
    }
}

struct DownConnector;

impl DeviceConnector for DownConnector {
    fn connect(&self, _: &OkcSettings) -> OkcResult<OkcClient> {
        Err(OkcError::NotConnected("kablo takılı değil".to_string()))
    }
}

fn enabled_settings() -> OkcSettings {
    OkcSettings {
        enabled: true,
        connection_kind: ConnectionKind::Simulator,
        terminal_serial: SIMULATOR_SERIAL.to_string(),
        ..OkcSettings::default()
    }
}

fn payment(txn: &str, method: &str, amount: i64) -> PaymentPayloadDto {
    PaymentPayloadDto {
        transaction_id: txn.to_string(),
        order_id: Some("ord_1".to_string()),
        timestamp: "2026-11-17T10:00:00Z".to_string(),
        method: method.to_string(),
        amount_tendered: amount,
        total_amount: amount,
        change_amount: None,
        items: Vec::new(),
        splits: None,
        notes: None,
        customer_ref: None,
        cashier_id: Some("usr_1".to_string()),
        terminal_id: None,
        idempotency_key: None,
        approval_token: None,
        actor_id: Some("usr_1".to_string()),
        debt_directory_id: None,
    }
}

async fn issue(
    pool: &SqlitePool,
    connector: Arc<dyn DeviceConnector>,
    payload: &PaymentPayloadDto,
) -> Result<Option<super::types::FiscalReceipt>, OkcError> {
    let mut conn = pool.acquire().await.expect("bağlantı");
    let Some(draft) = draft_for_payment(&mut conn, T, payload).await? else {
        return Ok(None);
    };
    gate::issue_for_payment(&mut conn, connector, T, payload.order_id.as_deref(), draft).await
}

#[tokio::test]
async fn disabled_by_default_never_touches_the_device() {
    let pool = pool().await;
    let register = SimulatedRegister::new();
    let result = issue(
        &pool,
        Arc::new(SimConnector(register.clone())),
        &payment("txn_1", "CASH", 3300),
    )
    .await;
    assert_eq!(result, Ok(None));
    assert!(register.received_types().is_empty());
}

#[tokio::test]
async fn enabled_issues_one_receipt_and_retry_returns_the_same() {
    let pool = pool().await;
    let register = SimulatedRegister::new();
    {
        let mut conn = pool.acquire().await.expect("bağlantı");
        settings::save(&mut conn, T, &enabled_settings())
            .await
            .expect("ayar");
    }
    let connector: Arc<dyn DeviceConnector> = Arc::new(SimConnector(register.clone()));
    let first = issue(&pool, connector.clone(), &payment("txn_2", "CASH", 3300))
        .await
        .expect("fiş")
        .expect("açık");
    assert_eq!(first.total_cents, 3300);
    // Aynı tahsilat yeniden denenirse cihaza hiç gidilmez.
    let received = register.received_types().len();
    let again = issue(&pool, connector, &payment("txn_2", "CASH", 3300))
        .await
        .expect("tekrar")
        .expect("açık");
    assert_eq!(first, again);
    assert_eq!(register.received_types().len(), received);
    assert_eq!(register.closed_receipts(), 1);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let row = receipt_log::find(&mut conn, T, "txn_2")
        .await
        .expect("sorgu")
        .expect("satır");
    assert_eq!(row.status, "ISSUED");
    assert_eq!(row.total_cents, 3300);
}

#[tokio::test]
async fn device_failure_is_a_persistent_warning_until_a_retry_succeeds() {
    let pool = pool().await;
    {
        let mut conn = pool.acquire().await.expect("bağlantı");
        settings::save(&mut conn, T, &enabled_settings())
            .await
            .expect("ayar");
    }
    let payload = payment("txn_3", "CARD", 3300);
    let error = issue(&pool, Arc::new(DownConnector), &payload)
        .await
        .expect_err("cihaz yok");
    assert!(matches!(error, OkcError::NotConnected(_)));
    gate::record_failure_after_rollback(&pool, T, "txn_3", Some("ord_1"), 3300, &error).await;

    {
        let mut conn = pool.acquire().await.expect("bağlantı");
        let failures = receipt_log::list_open_failures(&mut conn, T)
            .await
            .expect("liste");
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].error_code.as_deref(), Some("OKC_NOT_CONNECTED"));
        // Başka işletme bu uyarıyı görmez.
        assert!(receipt_log::list_open_failures(&mut conn, "tnt_b")
            .await
            .expect("b")
            .is_empty());
    }

    // Aynı adisyonun yeni bir işlem kimliğiyle başarılı denemesi uyarıyı kapatır.
    let register = SimulatedRegister::new();
    let retry = payment("txn_3b", "CARD", 3300);
    issue(&pool, Arc::new(SimConnector(register)), &retry)
        .await
        .expect("fiş")
        .expect("açık");
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert!(receipt_log::list_open_failures(&mut conn, T)
        .await
        .expect("liste")
        .is_empty());
}

#[tokio::test]
async fn rejected_card_leaves_a_failed_row_and_no_receipt() {
    let pool = pool().await;
    {
        let mut conn = pool.acquire().await.expect("bağlantı");
        settings::save(&mut conn, T, &enabled_settings())
            .await
            .expect("ayar");
    }
    let register = SimulatedRegister::new();
    register.set_fault(Fault::CardDeclined);
    let error = issue(
        &pool,
        Arc::new(SimConnector(register.clone())),
        &payment("txn_4", "CARD", 3300),
    )
    .await
    .expect_err("ret");
    assert!(matches!(error, OkcError::Rejected { .. }));
    assert_eq!(register.closed_receipts(), 0);
    gate::record_failure_after_rollback(&pool, T, "txn_4", Some("ord_1"), 3300, &error).await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let row = receipt_log::find(&mut conn, T, "txn_4")
        .await
        .expect("q")
        .expect("satır");
    assert_eq!((row.status.as_str(), row.attempts), ("FAILED", 1));
}

#[tokio::test]
async fn partial_amount_is_spread_over_order_lines_without_losing_a_cent() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let draft = draft_for_payment(&mut conn, T, &payment("txn_5", "CASH", 1000))
        .await
        .expect("taslak")
        .expect("fiş");
    assert_eq!(draft.lines.iter().map(|l| l.total_cents).sum::<i64>(), 1000);
    assert_eq!(draft.validate(), Ok(1000));
    assert_eq!(draft.lines.len(), 2);
    assert_eq!(draft.lines[0].name, "Çay");
}

#[tokio::test]
async fn selected_items_use_the_sealed_order_prices() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let mut payload = payment("txn_6", "CASH", 200);
    payload.items = vec![CartItemDto {
        id: "itm_1".to_string(),
        product: serde_json::json!({}),
        quantity: 2,
        ..CartItemDto::default()
    }];
    let draft = draft_for_payment(&mut conn, T, &payload)
        .await
        .expect("taslak")
        .expect("fiş");
    assert_eq!(draft.lines.len(), 1);
    assert_eq!(draft.lines[0].quantity_milli, 2000);
    assert_eq!(draft.lines[0].total_cents, 200);
    payload.items[0].id = "itm_yok".to_string();
    assert!(draft_for_payment(&mut conn, T, &payload).await.is_err());
}

#[tokio::test]
async fn veresiye_is_not_a_fiscal_tender_and_unknown_methods_fail() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert_eq!(
        draft_for_payment(&mut conn, T, &payment("txn_7", "VERESIYE", 3300)).await,
        Ok(None)
    );
    let mut mixed = payment("txn_8", "CASH", 3300);
    mixed.splits = Some(vec![
        SplitPaymentDto {
            id: None,
            method: "NAKIT".to_string(),
            amount: 1300,
        },
        SplitPaymentDto {
            id: None,
            method: "VERESIYE".to_string(),
            amount: 1000,
        },
        SplitPaymentDto {
            id: None,
            method: "YEMEK_KARTI".to_string(),
            amount: 1000,
        },
    ]);
    let draft = draft_for_payment(&mut conn, T, &mixed)
        .await
        .expect("t")
        .expect("f");
    assert_eq!(draft.payments.len(), 2);
    assert_eq!(draft.payments[1].kind, TenderKind::MealCard);
    assert_eq!(draft.validate(), Ok(2300));
    assert!(
        draft_for_payment(&mut conn, T, &payment("txn_9", "BITCOIN", 100))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn settings_round_trip_per_tenant_and_reject_invalid_values() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert_eq!(
        settings::load(&mut conn, T).await.expect("varsayılan"),
        OkcSettings::default()
    );
    let tcp = OkcSettings {
        enabled: true,
        connection_kind: ConnectionKind::Tcp,
        port: "192.168.1.20:5000".to_string(),
        terminal_serial: "ABC123".to_string(),
        ..OkcSettings::default()
    };
    settings::save(&mut conn, T, &tcp).await.expect("kaydet");
    assert_eq!(settings::load(&mut conn, T).await.expect("oku"), tcp);
    assert_eq!(
        settings::load(&mut conn, "tnt_b").await.expect("b"),
        OkcSettings::default()
    );
    let wireless = OkcSettings {
        connection_kind: ConnectionKind::Serial,
        port: "Bluetooth COM9".to_string(),
        ..tcp.clone()
    };
    assert!(settings::save(&mut conn, T, &wireless).await.is_err());
    assert_eq!(settings::load(&mut conn, T).await.expect("değişmedi"), tcp);
}

#[test]
fn production_connector_is_fail_closed_without_a_real_device() {
    let serial = OkcSettings {
        enabled: true,
        connection_kind: ConnectionKind::Serial,
        port: "COM3".to_string(),
        terminal_serial: "ABC123".to_string(),
        ..OkcSettings::default()
    };
    assert!(matches!(
        SystemConnector.connect(&serial),
        Err(OkcError::NotConnected(_))
    ));
    // Dinleyen cihaz yok: bağlantı reddi "yazar kasa bağlı değil" olur.
    let closed_port = OkcSettings {
        connection_kind: ConnectionKind::Tcp,
        port: "127.0.0.1:1".to_string(),
        ..serial
    };
    assert!(matches!(
        SystemConnector.connect(&closed_port),
        Err(OkcError::NotConnected(_))
    ));
}

#[test]
fn verifier_default_rejects_even_the_simulator() {
    let register = SimulatedRegister::new();
    let mut client = OkcClient::new(
        Box::new(SimulatorTransport::new(register)),
        SIMULATOR_SERIAL,
        Duration::from_millis(50),
        SoftwareIdentity::default(),
    );
    assert!(matches!(
        client.pair(&RejectingVerifier),
        Err(OkcError::CertificateUnverified(_))
    ));
}
