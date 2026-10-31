//! Başarılı, reddedilen, iptal, tekrarlanan ve geç gelen yanıtlar.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

const T: &str = "tnt_a";

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().in_memory(true))
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES ('tbl_1', 'tnt_a', 'Masa 1', 'OCCUPIED', 1000);
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents) VALUES ('ord_1', 'tnt_a', 'tbl_1', 'IN_PROGRESS', 1000);",
    )
    .execute(&pool)
    .await
    .expect("veri");
    pool
}

async fn run(
    pool: &SqlitePool,
    txn: &str,
    amount: i64,
    scenario: TestScenario,
) -> Result<ChargeResult, String> {
    let mut conn = pool.acquire().await.expect("bağlantı");
    charge(
        &mut conn,
        T,
        ChargeRequest {
            transaction_id: txn,
            order_id: "ord_1",
            amount_cents: amount,
            actor_id: "usr_1",
        },
        &TestProvider { scenario },
    )
    .await
}

async fn kinds(pool: &SqlitePool) -> Vec<String> {
    let mut conn = pool.acquire().await.expect("bağlantı");
    let mut rows: Vec<String> = list_log(&mut conn, T)
        .await
        .expect("günlük")
        .into_iter()
        .map(|row| row.kind)
        .collect();
    rows.sort();
    rows
}

#[tokio::test]
async fn onay_red_ve_iptal_durumu_ve_gunlugu_yazar() {
    let pool = pool().await;
    for (txn, scenario, status) in [
        ("txn_1", TestScenario::Approve, "APPROVED"),
        ("txn_2", TestScenario::Decline, "DECLINED"),
        ("txn_3", TestScenario::Cancel, "CANCELLED"),
    ] {
        let result = run(&pool, txn, 1000, scenario).await.expect("çekim");
        assert_eq!(result.status, status);
        assert!(!result.replayed);
    }
    assert_eq!(kinds(&pool).await.len(), 6);
}

#[tokio::test]
async fn yeniden_deneme_ikinci_cekim_olmaz() {
    let pool = pool().await;
    run(&pool, "txn_1", 1000, TestScenario::Approve)
        .await
        .expect("ilk");
    // Senaryo değişse bile sağlayıcıya gidilmez, ilk sonuç döner.
    let second = run(&pool, "txn_1", 1000, TestScenario::Decline)
        .await
        .expect("ikinci");
    assert_eq!(second.status, "APPROVED");
    assert!(second.replayed);
    let intents: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pos_payment_intents")
        .fetch_one(&pool)
        .await
        .expect("sayım");
    assert_eq!(intents, 1);
    assert!(kinds(&pool).await.contains(&"REPLAY".to_string()));
}

#[tokio::test]
async fn ayni_kimlik_baska_tutarla_reddedilir() {
    let pool = pool().await;
    run(&pool, "txn_1", 1000, TestScenario::Approve)
        .await
        .expect("ilk");
    let error = run(&pool, "txn_1", 900, TestScenario::Approve)
        .await
        .unwrap_err();
    assert!(error.starts_with("IDEMPOTENCY_CONFLICT"), "{error}");
}

#[tokio::test]
async fn tekrarlanan_yanit_tek_kez_uygulanir() {
    let pool = pool().await;
    let result = run(&pool, "txn_1", 1000, TestScenario::DuplicateResponse)
        .await
        .expect("çekim");
    assert_eq!(result.status, "APPROVED");
    assert_eq!(kinds(&pool).await, vec!["DUPLICATE", "REQUEST", "RESPONSE"]);
}

#[tokio::test]
async fn gec_gelen_ret_onayi_silmez() {
    let pool = pool().await;
    let result = run(&pool, "txn_1", 1000, TestScenario::LateDecline)
        .await
        .expect("çekim");
    assert_eq!(result.status, "APPROVED");
    assert_eq!(kinds(&pool).await, vec!["IGNORED", "REQUEST", "RESPONSE"]);
}

#[tokio::test]
async fn satisa_baglanmayan_onay_iptal_edilir_satis_varsa_edilemez() {
    let pool = pool().await;
    run(&pool, "txn_1", 1000, TestScenario::Approve)
        .await
        .expect("çekim");
    let mut conn = pool.acquire().await.expect("bağlantı");
    void_charge(&mut conn, T, "txn_1").await.expect("iptal");
    void_charge(&mut conn, T, "txn_1")
        .await
        .expect("tekrar iptal zararsız");
    drop(conn);
    assert_eq!(
        kinds(&pool)
            .await
            .iter()
            .filter(|kind| *kind == "VOID")
            .count(),
        1
    );

    run(&pool, "txn_2", 1000, TestScenario::Approve)
        .await
        .expect("çekim");
    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at)
         VALUES ('evt_1', 'tnt_a', 'txn_2', 'SALE', 'SALE_SETTLED', '{}', '2026-01-01')",
    )
    .execute(&pool)
    .await
    .expect("olay");
    let mut conn = pool.acquire().await.expect("bağlantı");
    let error = void_charge(&mut conn, T, "txn_2").await.unwrap_err();
    assert!(error.starts_with("CONFLICT"), "{error}");
}

#[tokio::test]
async fn baska_isletme_ne_cekebilir_ne_gorebilir() {
    let pool = pool().await;
    run(&pool, "txn_1", 1000, TestScenario::Approve)
        .await
        .expect("çekim");
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert!(list_log(&mut conn, "tnt_b")
        .await
        .expect("günlük")
        .is_empty());
    let foreign = charge(
        &mut conn,
        "tnt_b",
        ChargeRequest {
            transaction_id: "txn_9",
            order_id: "ord_1",
            amount_cents: 1000,
            actor_id: "usr_1",
        },
        &TestProvider {
            scenario: TestScenario::Approve,
        },
    )
    .await;
    assert!(foreign.is_err());
}

#[tokio::test]
async fn test_modu_varsayilan_kapali() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert!(!test_mode_enabled(&mut conn, T).await.expect("okuma"));
    set_test_mode(&mut conn, T, true).await.expect("aç");
    assert!(test_mode_enabled(&mut conn, T).await.expect("okuma"));
    assert!(!test_mode_enabled(&mut conn, "tnt_b").await.expect("okuma"));
}
