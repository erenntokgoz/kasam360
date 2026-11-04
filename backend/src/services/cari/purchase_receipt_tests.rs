//! Mal kabulü: stok ve cari aynı anda ve tek kez; vadeli ve peşin ayrı; ekstre bakiyeyle tutar.

use super::super::{apply, ApplyError, CariOp};
use super::*;
use crate::services::audit_service::AuditLock;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tokio::sync::Mutex;

const TENANT: &str = "tnt_a";
const NOW: &str = "2026-10-30T10:00:00Z";

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
    for sql in [
        "INSERT INTO suppliers (id, tenant_id, name, created_by, payment_term_days) VALUES ('sup_1', 'tnt_a', 'Öz Gıda', 'usr_1', 30)",
        "INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Hammadde')",
        "INSERT INTO products (id, tenant_id, category_id, name, price_cents, stock_unit, is_raw, is_active) VALUES ('prd_un', 'tnt_a', 'cat_1', 'Un', 0, 'kg', 1, 0)",
        "INSERT INTO products (id, tenant_id, category_id, name, price_cents, stock_unit, is_raw, is_active) VALUES ('prd_marul', 'tnt_a', 'cat_1', 'Marul', 0, 'adet', 1, 0)",
        "INSERT INTO shifts (id, tenant_id, cashier_id, status) VALUES ('shf_1', 'tnt_a', 'usr_1', 'OPEN')",
    ] {
        sqlx::query(sql).execute(&pool).await.expect("kurulum");
    }
    pool
}

async fn order(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO purchase_orders (id, tenant_id, supplier_id, order_number, status, ordered_at, total_cents, created_by)
         VALUES (?, 'tnt_a', 'sup_1', ?, 'TASI', '2026-10-29', 0, 'usr_1')",
    )
    .bind(id)
    .bind(format!("S-{id}"))
    .execute(pool)
    .await
    .expect("sipariş");
    // 2 kg un 4000 kuruştan, 10 marul 1500 kuruştan: toplam 23000.
    for (item, product, quantity, cost) in [
        ("un", "prd_un", 2.0, 4000),
        ("marul", "prd_marul", 10.0, 1500),
    ] {
        sqlx::query(
            "INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, product_id, quantity, unit_cost_cents)
             VALUES (?, 'tnt_a', ?, ?, ?, ?)",
        )
        .bind(format!("poi_{id}_{item}"))
        .bind(id)
        .bind(product)
        .bind(quantity)
        .bind(cost)
        .execute(pool)
        .await
        .expect("kalem");
    }
}

fn receipt(id: &str, settlement: &str, grams: Option<f64>) -> CariOp {
    CariOp::ReceivePurchase(ReceivePurchaseInput {
        purchase_order_id: id.to_string(),
        settlement: settlement.to_string(),
        due_date: (settlement == SETTLEMENT_TERM).then(|| "2026-11-29".to_string()),
        document_no: None,
        lines: ["marul", "un"]
            .iter()
            .map(|item| ReceiveLine {
                item_id: format!("poi_{id}_{item}"),
                batch_id: format!("bat_{id}_{item}"),
                movement_id: format!("smv_{id}_{item}"),
                usable_grams_per_unit: (*item == "marul").then_some(grams).flatten(),
            })
            .collect(),
        document_id: format!("doc_{id}"),
        debt_id: format!("dbt_{id}"),
        new_directory_id: "dir_sup".to_string(),
        payment_id: format!("pmt_{id}"),
        cash_movement_id: (settlement == "CASH").then(|| format!("csh_{id}")),
        shift_id: Some("shf_1".to_string()),
        actor_id: "usr_1".to_string(),
        created_at: NOW.to_string(),
    })
}

async fn run(pool: &SqlitePool, op: &CariOp) -> Result<serde_json::Value, ApplyError> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.expect("tx");
    let result = apply(&mut tx, &lock, TENANT, "usr_1", "OWNER", NOW, op).await;
    if result.is_ok() {
        tx.commit().await.expect("commit");
    }
    result
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(pool)
        .await
        .expect("sayım")
}

/// Kart listesindeki bakiye sorgusunun aynısı.
async fn card_balance(pool: &SqlitePool, directory_id: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(CASE WHEN type = 'GIVEN' THEN remaining_amount_cents
                                  ELSE -remaining_amount_cents END), 0)
           FROM debts WHERE tenant_id = 'tnt_a' AND directory_id = ? AND status != 'PAID'",
    )
    .bind(directory_id)
    .fetch_one(pool)
    .await
    .expect("bakiye")
}

#[tokio::test]
async fn vadeli_kabul_parti_hareket_ve_acik_borcu_birlikte_yazar() {
    let pool = pool().await;
    order(&pool, "po_1").await;
    let result = run(&pool, &receipt("po_1", SETTLEMENT_TERM, Some(250.0)))
        .await
        .expect("kabul");
    assert_eq!(result["receivedTotalCents"], 23_000);
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM inventory_batches WHERE tenant_id = 'tnt_a'"
        )
        .await,
        2
    );
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM stock_movements WHERE tenant_id = 'tnt_a' AND source_id = 'po_1' AND movement_type = 'IN'").await,
        2
    );
    let (remaining, status, due): (i64, String, Option<String>) = sqlx::query_as(
        "SELECT remaining_amount_cents, status, due_date FROM debts WHERE id = 'dbt_po_1'",
    )
    .fetch_one(&pool)
    .await
    .expect("borç");
    assert_eq!(
        (remaining, status.as_str(), due.as_deref()),
        (23_000, "PENDING", Some("2026-11-29"))
    );
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM debt_payments").await, 0);
    assert_eq!(card_balance(&pool, "dir_sup").await, -23_000);
    let grams: Option<f64> = sqlx::query_scalar(
        "SELECT usable_grams_per_unit FROM inventory_batches WHERE id = 'bat_po_1_marul'",
    )
    .fetch_one(&pool)
    .await
    .expect("gram");
    assert_eq!(grams, Some(250.0));
}

#[tokio::test]
async fn pesin_nakit_kabul_borcu_ayni_anda_kapatir_ve_kasadan_duser() {
    let pool = pool().await;
    order(&pool, "po_1").await;
    run(&pool, &receipt("po_1", "CASH", None))
        .await
        .expect("kabul");
    let status: String = sqlx::query_scalar("SELECT status FROM debts WHERE id = 'dbt_po_1'")
        .fetch_one(&pool)
        .await
        .expect("borç");
    assert_eq!(status, "PAID");
    assert_eq!(
        count(&pool, "SELECT amount_cents FROM cash_movements WHERE id = 'csh_po_1' AND movement_type = 'OUT'").await,
        23_000
    );
    assert_eq!(card_balance(&pool, "dir_sup").await, 0);
}

#[tokio::test]
async fn pesin_havale_kasaya_dokunmaz_pesinde_vade_reddedilir() {
    let pool = pool().await;
    order(&pool, "po_1").await;
    let mut with_due = receipt("po_1", "BANK_TRANSFER", None);
    if let CariOp::ReceivePurchase(input) = &mut with_due {
        input.due_date = Some("2026-12-01".to_string());
    }
    assert!(matches!(
        run(&pool, &with_due).await,
        Err(ApplyError::Rejected(_))
    ));
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM inventory_batches").await,
        0
    );

    run(&pool, &receipt("po_1", "BANK_TRANSFER", None))
        .await
        .expect("kabul");
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM cash_movements").await, 0);
    let method: String =
        sqlx::query_scalar("SELECT payment_method FROM debt_payments WHERE debt_id = 'dbt_po_1'")
            .fetch_one(&pool)
            .await
            .expect("ödeme");
    assert_eq!(method, "BANK_TRANSFER");
}

#[tokio::test]
async fn ayni_siparis_ikinci_kez_kabul_edilemez() {
    let pool = pool().await;
    order(&pool, "po_1").await;
    run(&pool, &receipt("po_1", SETTLEMENT_TERM, None))
        .await
        .expect("ilk kabul");
    let mut again = receipt("po_1", SETTLEMENT_TERM, None);
    if let CariOp::ReceivePurchase(input) = &mut again {
        input.debt_id = "dbt_ikinci".to_string();
        for line in &mut input.lines {
            line.batch_id.push_str("_2");
            line.movement_id.push_str("_2");
        }
    }
    assert!(matches!(
        run(&pool, &again).await,
        Err(ApplyError::Rejected(_))
    ));
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM inventory_batches").await,
        2
    );
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM debts").await, 1);
}

#[tokio::test]
async fn reddedilen_kabul_hic_stok_ve_borc_birakmaz() {
    let pool = pool().await;
    order(&pool, "po_1").await;
    // Kilo ile tutulan una gram girilemez; bütün işlem geri alınır.
    let mut wrong = receipt("po_1", SETTLEMENT_TERM, None);
    if let CariOp::ReceivePurchase(input) = &mut wrong {
        input
            .lines
            .iter_mut()
            .for_each(|line| line.usable_grams_per_unit = Some(100.0));
    }
    assert!(matches!(
        run(&pool, &wrong).await,
        Err(ApplyError::Rejected(_))
    ));
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM inventory_batches").await,
        0
    );
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM debts").await, 0);
    let status: String = sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = 'po_1'")
        .fetch_one(&pool)
        .await
        .expect("sipariş");
    assert_eq!(status, "TASI");
}

#[tokio::test]
async fn ekstre_kapanisi_negatif_bakiyede_de_kart_bakiyesine_esittir() {
    let pool = pool().await;
    order(&pool, "po_1").await;
    order(&pool, "po_2").await;
    run(&pool, &receipt("po_1", SETTLEMENT_TERM, None))
        .await
        .expect("vadeli");
    run(&pool, &receipt("po_2", "CREDIT_CARD", None))
        .await
        .expect("peşin");
    // Vadeli borcun bir kısmı ödenir: bakiye hâlâ negatif (biz borçluyuz).
    run(
        &pool,
        &CariOp::RecordPayment(RecordPaymentInput {
            payment_id: "pmt_kismi".to_string(),
            debt_id: "dbt_po_1".to_string(),
            amount_cents: 5_000,
            payment_method: "BANK_TRANSFER".to_string(),
            actor_id: "usr_1".to_string(),
            notes: None,
            expected_version: 0,
            cash_movement_id: None,
            shift_id: None,
            created_at: NOW.to_string(),
        }),
    )
    .await
    .expect("kısmi ödeme");

    let statement = crate::services::ledger_statement::directory_statement(
        &pool,
        TENANT,
        "dir_sup",
        "2026-10-01",
        "2026-10-31",
    )
    .await
    .expect("ekstre");
    let balance = card_balance(&pool, "dir_sup").await;
    assert_eq!(balance, -18_000);
    assert_eq!(statement.closing_balance_cents, balance);
    // İki alış, peşin ödeme ve kısmi ödeme: dört satır.
    assert_eq!(statement.lines.len(), 4);
    // Alış ve ödeme satırları kendi siparişine numarayla bağlanır.
    assert!(statement.lines.iter().all(|line| line
        .order_number
        .as_deref()
        .is_some_and(|no| no.starts_with("S-po_"))));
    assert_eq!(statement.total_credit_cents, 46_000);
    assert_eq!(statement.total_debit_cents, 28_000);
}

fn open(debt_id: &str, debt_type: &str, amount_cents: i64, order_id: Option<&str>) -> CariOp {
    CariOp::OpenDebt(crate::services::cari::OpenDebtInput {
        debt_id: debt_id.to_string(),
        directory_id: "dir_cus".to_string(),
        debt_type: debt_type.to_string(),
        amount_cents,
        due_date: None,
        is_cash: false,
        order_id: order_id.map(str::to_string),
        description: None,
        created_at: NOW.to_string(),
    })
}

/// İade ve düzeltme kaydın toplamını geriye dönük değiştirir; ekstre hareketlerden,
/// kart kalanlardan hesaplandığı için iki yolun aynı sayıya varması burada kanıtlanır.
#[tokio::test]
async fn iade_ve_duzeltme_sonrasi_ekstre_kapanisi_kart_bakiyesine_esittir() {
    let pool = pool().await;
    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_cus', 'tnt_a', 'Ali', 'CUSTOMER')",
    )
    .execute(&pool)
    .await
    .expect("kart");
    run(&pool, &open("dbt_elle", "GIVEN", 10_000, None))
        .await
        .expect("veresiye");
    run(
        &pool,
        &CariOp::EditDebt(crate::services::cari::EditDebtInput {
            debt_id: "dbt_elle".to_string(),
            amount_cents: 12_000,
            due_date: Some("2026-10-01".to_string()),
            description: None,
        }),
    )
    .await
    .expect("düzeltme");
    run(&pool, &open("dbt_adisyon", "GIVEN", 20_000, Some("ord_1")))
        .await
        .expect("adisyon");
    run(
        &pool,
        &CariOp::RecordPayment(RecordPaymentInput {
            payment_id: "pmt_tahsilat".to_string(),
            debt_id: "dbt_adisyon".to_string(),
            amount_cents: 15_000,
            payment_method: "CREDIT_CARD".to_string(),
            actor_id: "usr_1".to_string(),
            notes: None,
            expected_version: 0,
            cash_movement_id: None,
            shift_id: None,
            created_at: NOW.to_string(),
        }),
    )
    .await
    .expect("tahsilat");
    // 8.000 iade: 5.000 açık kısımdan düşer, 3.000 tahsil edilenden geri ödenir.
    let mut conn = pool.acquire().await.expect("bağlantı");
    crate::services::refund_service::reduce_veresiye_debt(
        &mut conn,
        TENANT,
        Some("ord_1"),
        8_000,
        "usr_1",
    )
    .await
    .expect("iade");
    drop(conn);
    // Alacak kaydı bakiyeyi eksiye çevirir: işletme bu cariye borçlu.
    run(&pool, &open("dbt_alacak", "TAKEN", 50_000, None))
        .await
        .expect("alacak kaydı");
    run(&pool, &open("dbt_sil", "GIVEN", 7_000, None))
        .await
        .expect("silinecek");
    run(
        &pool,
        &CariOp::DeleteDebt {
            debt_id: "dbt_sil".to_string(),
        },
    )
    .await
    .expect("silme");

    let statement = crate::services::ledger_statement::directory_statement(
        &pool,
        TENANT,
        "dir_cus",
        "2026-10-01",
        "2999-12-31",
    )
    .await
    .expect("ekstre");
    let balance = card_balance(&pool, "dir_cus").await;
    assert_eq!(balance, -38_000);
    assert_eq!(statement.opening_balance_cents, 0);
    assert_eq!(statement.closing_balance_cents, balance);
    let refund = statement
        .lines
        .iter()
        .find(|line| line.kind == "IADE")
        .expect("iade satırı");
    assert_eq!(refund.signed_amount_cents, 3_000);
    assert_eq!(statement.total_debit_cents, 27_000);
    assert_eq!(statement.total_credit_cents, 65_000);
    assert_eq!(
        statement.lines.last().map(|line| line.balance_after_cents),
        Some(balance)
    );

    // Dönem bölünse de devreden açılış ve kapanış aynı bakiyeye varır.
    let later = crate::services::ledger_statement::directory_statement(
        &pool,
        TENANT,
        "dir_cus",
        "2999-12-31",
        "2999-12-31",
    )
    .await
    .expect("sonraki dönem");
    assert_eq!(later.opening_balance_cents, balance);
    assert_eq!(later.closing_balance_cents, balance);
}
