//! Cari işlem kuralları: kısmi ödeme, nakit, belge onayı ve kiracı yalıtımı.

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
    pool
}

async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sql).execute(pool).await.expect("kurulum");
}

async fn run(
    pool: &SqlitePool,
    tenant: &str,
    op: &CariOp,
) -> Result<serde_json::Value, ApplyError> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.expect("tx");
    let result = apply(&mut tx, &lock, tenant, "usr_1", "OWNER", NOW, op).await;
    if result.is_ok() {
        tx.commit().await.expect("commit");
    }
    result
}

async fn seed_debt(pool: &SqlitePool) {
    exec(
        pool,
        "INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_1', 'tnt_a', 'Ayşe', 'CUSTOMER')",
    )
    .await;
    run(
        pool,
        TENANT,
        &CariOp::OpenDebt(OpenDebtInput {
            debt_id: "dbt_1".to_string(),
            directory_id: "dir_1".to_string(),
            debt_type: "GIVEN".to_string(),
            amount_cents: 10_000,
            due_date: Some("2026-11-15".to_string()),
            is_cash: false,
            order_id: Some("ord_1".to_string()),
            description: None,
            created_at: NOW.to_string(),
        }),
    )
    .await
    .expect("borç açılır");
}

fn payment(id: &str, amount: i64, version: i64, method: &str) -> CariOp {
    CariOp::RecordPayment(RecordPaymentInput {
        payment_id: id.to_string(),
        debt_id: "dbt_1".to_string(),
        amount_cents: amount,
        payment_method: method.to_string(),
        actor_id: "usr_1".to_string(),
        notes: None,
        expected_version: version,
        cash_movement_id: (method == "CASH").then(|| format!("csh_{id}")),
        shift_id: (method == "CASH").then(|| "shf_1".to_string()),
        created_at: NOW.to_string(),
    })
}

async fn debt_state(pool: &SqlitePool) -> (i64, String) {
    let row: (i64, String) = sqlx::query_as(
        "SELECT remaining_amount_cents, status FROM debts WHERE id = 'dbt_1' AND tenant_id = 'tnt_a'",
    )
    .fetch_one(pool)
    .await
    .expect("borç okunur");
    row
}

#[tokio::test]
async fn kismi_ve_tam_odeme_bakiyeyi_ve_durumu_gunceller() {
    let p = pool().await;
    seed_debt(&p).await;
    run(&p, TENANT, &payment("pmt_1", 2_500, 0, "CREDIT_CARD"))
        .await
        .expect("kısmi");
    assert_eq!(debt_state(&p).await, (7_500, "PARTIAL".to_string()));
    run(&p, TENANT, &payment("pmt_2", 7_500, 1, "BANK_TRANSFER"))
        .await
        .expect("tam");
    assert_eq!(debt_state(&p).await, (0, "PAID".to_string()));
}

#[tokio::test]
async fn nakit_kasaya_yazilir_kart_kasaya_dokunmaz() {
    let p = pool().await;
    seed_debt(&p).await;
    exec(
        &p,
        "INSERT INTO shifts (id, tenant_id, cashier_id, status) VALUES ('shf_1', 'tnt_a', 'usr_1', 'OPEN')",
    )
    .await;
    run(&p, TENANT, &payment("pmt_1", 1_000, 0, "CREDIT_CARD"))
        .await
        .expect("kart");
    run(&p, TENANT, &payment("pmt_2", 2_000, 1, "CASH"))
        .await
        .expect("nakit");
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT movement_type, amount_cents FROM cash_movements WHERE tenant_id = 'tnt_a'",
    )
    .fetch_all(&p)
    .await
    .expect("kasa");
    assert_eq!(rows, vec![("IN".to_string(), 2_000)]);
}

#[tokio::test]
async fn acik_vardiya_olmadan_nakit_reddedilir() {
    let p = pool().await;
    seed_debt(&p).await;
    let CariOp::RecordPayment(mut input) = payment("pmt_1", 1_000, 0, "CASH") else {
        unreachable!("ödeme işlemi");
    };
    input.shift_id = None;
    let result = run(&p, TENANT, &CariOp::RecordPayment(input)).await;
    assert!(matches!(result, Err(ApplyError::Rejected(m)) if m.contains("vardiya")));
}

#[tokio::test]
async fn baska_kiracinin_borcu_odenemez() {
    let p = pool().await;
    seed_debt(&p).await;
    let result = run(&p, "tnt_b", &payment("pmt_1", 1_000, 0, "BANK_TRANSFER")).await;
    assert!(matches!(result, Err(ApplyError::Rejected(m)) if m.starts_with("NOT_FOUND")));
    assert_eq!(debt_state(&p).await, (10_000, "PENDING".to_string()));
}

#[tokio::test]
async fn gecersiz_vade_ve_negatif_limit_reddedilir() {
    let p = pool().await;
    seed_debt(&p).await;
    let bad_date = run(
        &p,
        TENANT,
        &CariOp::OpenDebt(OpenDebtInput {
            debt_id: "dbt_2".to_string(),
            directory_id: "dir_1".to_string(),
            debt_type: "GIVEN".to_string(),
            amount_cents: 100,
            due_date: Some("15.11.2026".to_string()),
            is_cash: false,
            order_id: None,
            description: None,
            created_at: NOW.to_string(),
        }),
    )
    .await;
    assert!(matches!(bad_date, Err(ApplyError::Rejected(_))));
    let bad_limit = run(
        &p,
        TENANT,
        &CariOp::UpdateCard {
            card: CardFields {
                directory_id: "dir_1".to_string(),
                name: "Ayşe".to_string(),
                phone: None,
                email: None,
                tax_no: None,
                tax_office: None,
                address: None,
                credit_limit_cents: Some(-1),
                notes: None,
            },
        },
    )
    .await;
    assert!(matches!(bad_limit, Err(ApplyError::Rejected(_))));
}

#[tokio::test]
async fn limit_gonderilmezse_korunur() {
    let p = pool().await;
    exec(
        &p,
        "INSERT INTO directories (id, tenant_id, name, type, credit_limit_cents) VALUES ('dir_1', 'tnt_a', 'Ayşe', 'CUSTOMER', 5000)",
    )
    .await;
    run(
        &p,
        TENANT,
        &CariOp::UpdateCard {
            card: CardFields {
                directory_id: "dir_1".to_string(),
                name: "Ayşe Kaya".to_string(),
                phone: None,
                email: None,
                tax_no: None,
                tax_office: None,
                address: None,
                credit_limit_cents: None,
                notes: None,
            },
        },
    )
    .await
    .expect("güncellenir");
    let limit: i64 = sqlx::query_scalar(
        "SELECT credit_limit_cents FROM directories WHERE id = 'dir_1' AND tenant_id = 'tnt_a'",
    )
    .fetch_one(&p)
    .await
    .expect("limit");
    assert_eq!(limit, 5_000);
}

async fn seed_received_order(p: &SqlitePool) {
    exec(p, "INSERT INTO suppliers (id, tenant_id, name, created_by) VALUES ('sup_1', 'tnt_a', 'Öz Gıda', 'usr_1')").await;
    exec(
        p,
        "INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Hammadde')",
    )
    .await;
    exec(p, "INSERT INTO products (id, tenant_id, category_id, name, price_cents) VALUES ('prd_1', 'tnt_a', 'cat_1', 'Un', 100)").await;
    exec(
        p,
        "INSERT INTO purchase_orders (id, tenant_id, supplier_id, order_number, status, ordered_at, received_at, total_cents, created_by)
         VALUES ('po_1', 'tnt_a', 'sup_1', 'S-1', 'ALINDI', '2026-10-01', '2026-10-02', 15000, 'usr_1')",
    )
    .await;
    exec(
        p,
        "INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, product_id, quantity, unit_cost_cents, received_quantity)
         VALUES ('poi_1', 'tnt_a', 'po_1', 'prd_1', 3, 5000, 2.5)",
    )
    .await;
}

fn document(id: &str, no: &str, total: i64, reason: Option<&str>) -> CariOp {
    CariOp::ApproveDocument(ApproveDocumentInput {
        document_id: format!("doc_{id}"),
        debt_id: format!("dbt_{id}"),
        new_directory_id: format!("dir_{id}"),
        purchase_order_id: "po_1".to_string(),
        document_no: no.to_string(),
        document_total_cents: total,
        due_date: Some("2026-11-30".to_string()),
        difference_reason: reason.map(str::to_string),
        actor_id: "usr_1".to_string(),
        created_at: NOW.to_string(),
    })
}

#[tokio::test]
async fn mal_kabulu_borc_dogurmaz_belge_onayi_dogurur() {
    let p = pool().await;
    seed_received_order(&p).await;
    let mut conn = p.acquire().await.expect("bağlantı");
    let waiting = awaiting_documents(&mut conn, TENANT).await.expect("liste");
    drop(conn);
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].received_total_cents, 12_500);
    let debts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM debts WHERE tenant_id = 'tnt_a'")
        .fetch_one(&p)
        .await
        .expect("sayı");
    assert_eq!(debts, 0);

    let result = run(&p, TENANT, &document("a", "FT-1", 12_500, None))
        .await
        .expect("onay");
    assert_eq!(result["differenceCents"], 0);
    assert_eq!(result["directoryId"], "dir_a");

    let row: (String, i64, String) = sqlx::query_as(
        "SELECT d.type, d.remaining_amount_cents, dir.type FROM debts d
         JOIN directories dir ON dir.id = d.directory_id AND dir.tenant_id = d.tenant_id
         WHERE d.id = 'dbt_a' AND d.tenant_id = 'tnt_a'",
    )
    .fetch_one(&p)
    .await
    .expect("borç");
    assert_eq!(row, ("TAKEN".to_string(), 12_500, "SUPPLIER".to_string()));

    let mut conn = p.acquire().await.expect("bağlantı");
    assert!(awaiting_documents(&mut conn, TENANT)
        .await
        .expect("liste")
        .is_empty());
}

#[tokio::test]
async fn belge_farki_gerekcesiz_reddedilir_gerekceyle_muhurlenir() {
    let p = pool().await;
    seed_received_order(&p).await;
    let silent = run(&p, TENANT, &document("a", "FT-1", 13_000, None)).await;
    assert!(matches!(silent, Err(ApplyError::Rejected(m)) if m.starts_with("DIFFERENCE")));

    let result = run(
        &p,
        TENANT,
        &document("b", "FT-1", 13_000, Some("Nakliye eklendi")),
    )
    .await
    .expect("gerekçeli onay");
    assert_eq!(result["differenceCents"], 500);
    let stored: (i64, i64, String) = sqlx::query_as(
        "SELECT document_total_cents, received_total_cents, difference_reason
         FROM supplier_documents WHERE tenant_id = 'tnt_a'",
    )
    .fetch_one(&p)
    .await
    .expect("belge");
    assert_eq!(stored, (13_000, 12_500, "Nakliye eklendi".to_string()));
}

#[tokio::test]
async fn belge_iki_kez_onaylanamaz_ve_ayni_kart_kullanilir() {
    let p = pool().await;
    seed_received_order(&p).await;
    run(&p, TENANT, &document("a", "FT-1", 12_500, None))
        .await
        .expect("ilk");
    let again = run(&p, TENANT, &document("b", "FT-2", 12_500, None)).await;
    assert!(matches!(again, Err(ApplyError::Rejected(m)) if m.starts_with("CONFLICT")));

    exec(
        &p,
        "INSERT INTO purchase_orders (id, tenant_id, supplier_id, order_number, status, ordered_at, total_cents, created_by)
         VALUES ('po_2', 'tnt_a', 'sup_1', 'S-2', 'ALINDI', '2026-10-05', 5000, 'usr_1')",
    )
    .await;
    let CariOp::ApproveDocument(mut second) = document("c", "FT-3", 100, Some("Ek")) else {
        unreachable!("belge işlemi");
    };
    second.purchase_order_id = "po_2".to_string();
    let result = run(&p, TENANT, &CariOp::ApproveDocument(second))
        .await
        .expect("ikinci sipariş");
    assert_eq!(
        result["directoryId"], "dir_a",
        "tedarikçi kimliği aynı karta bağlanır"
    );
}

#[tokio::test]
async fn teslim_alinmamis_siparisin_belgesi_onaylanamaz() {
    let p = pool().await;
    seed_received_order(&p).await;
    exec(
        &p,
        "UPDATE purchase_orders SET status = 'TASI' WHERE id = 'po_1' AND tenant_id = 'tnt_a'",
    )
    .await;
    let result = run(&p, TENANT, &document("a", "FT-1", 12_500, None)).await;
    assert!(matches!(result, Err(ApplyError::Rejected(m)) if m.starts_with("CONFLICT")));
}

#[tokio::test]
async fn hareketsiz_kart_silinir_hareketli_kart_silinmez() {
    let p = pool().await;
    seed_debt(&p).await;
    let used = CariOp::DeleteCard {
        directory_id: "dir_1".to_string(),
    };
    assert!(matches!(
        run(&p, TENANT, &used).await,
        Err(ApplyError::Rejected(m)) if m.starts_with("CONFLICT")
    ));

    exec(
        &p,
        "INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_2', 'tnt_a', 'Yeni', 'CUSTOMER')",
    )
    .await;
    let unused = CariOp::DeleteCard {
        directory_id: "dir_2".to_string(),
    };
    assert!(run(&p, "tnt_b", &unused).await.is_err());
    run(&p, TENANT, &unused).await.expect("silinir");
    assert!(run(&p, TENANT, &unused).await.is_err());
}
