//! Eşleştirme kodu ve katılım kuralları.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

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

#[test]
fn kod_cozulur_ve_bozuk_kod_reddedilir() {
    let code =
        PairingCode::parse("192.168.1.20:47360#00112233445566778899aabbccddeeff").expect("kod");
    assert_eq!(code.address, "192.168.1.20:47360");
    assert_eq!(PairingCode::parse(&code.render()).expect("yeniden"), code);
    assert!(PairingCode::parse("kod").is_err());
    assert!(PairingCode::parse("a#kisa").is_err());
}

#[tokio::test]
async fn kod_tek_kullanimliktir_ve_sureye_baglidir() {
    let p = pool().await;
    let mut conn = p.acquire().await.expect("bağlantı");
    let (code, _) = create_code(&mut conn, "tnt_a", "h:1").await.expect("kod");
    assert_eq!(
        active_psk(&mut conn, "tnt_a").await.expect("psk"),
        Some(code.psk())
    );
    assert_eq!(active_psk(&mut conn, "tnt_b").await.expect("psk"), None);
    consume_code(&mut conn, "tnt_a")
        .await
        .expect("ilk kullanım");
    assert!(consume_code(&mut conn, "tnt_a").await.is_err());
    assert_eq!(active_psk(&mut conn, "tnt_a").await.expect("psk"), None);

    create_code(&mut conn, "tnt_a", "h:1").await.expect("kod");
    sqlx::query("UPDATE sync_pairing_codes SET expires_at = '2000-01-01 00:00:00'")
        .execute(&mut *conn)
        .await
        .expect("süre");
    assert_eq!(active_psk(&mut conn, "tnt_a").await.expect("psk"), None);
}

fn grant(tenant: &str, snapshot: Vec<(String, String)>) -> JoinGrant {
    JoinGrant {
        tenant_id: tenant.to_string(),
        cluster_id: "cls_1".to_string(),
        authority_id: "dev_a".to_string(),
        term: 3,
        base_index: 7,
        base_term: 2,
        base_members: Vec::new(),
        snapshot,
    }
}

#[tokio::test]
async fn bos_kurulum_anlik_goruntuyu_ve_kiraciyi_kabul_eder() {
    let source = pool().await;
    sqlx::raw_sql(
        "INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_1', 'tnt_a', 'Ayşe', 'CUSTOMER');
         INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents, remaining_amount_cents)
         VALUES ('dbt_1', 'tnt_a', 'dir_1', 'GIVEN', 500, 200);
         INSERT INTO debt_payments (id, tenant_id, debt_id, amount_cents, payment_method, actor_id)
         VALUES ('pmt_1', 'tnt_a', 'dbt_1', 300, 'CASH', 'usr_1');
         INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_x', 'tnt_x', 'Başkası', 'CUSTOMER');",
    )
    .execute(&source)
    .await
    .expect("kaynak");
    let mut conn = source.acquire().await.expect("bağlantı");
    let snapshot = export_snapshot(&mut conn, "tnt_a").await.expect("görüntü");
    drop(conn);

    let target = pool().await;
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name, status) VALUES ('tnt_b', 'Merkez', 'ACTIVE');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_b', 'Genel');",
    )
    .execute(&target)
    .await
    .expect("hedef");
    let mut tx = target.begin().await.expect("tx");
    accept_grant(&mut tx, "tnt_b", &grant("tnt_a", snapshot), 9)
        .await
        .expect("katılım");
    tx.commit().await.expect("commit");

    let remaining: i64 = sqlx::query_scalar(
        "SELECT remaining_amount_cents FROM debts WHERE id = 'dbt_1' AND tenant_id = 'tnt_a'",
    )
    .fetch_one(&target)
    .await
    .expect("borç");
    assert_eq!(remaining, 200);
    let names: Vec<String> = sqlx::query_scalar("SELECT name FROM directories")
        .fetch_all(&target)
        .await
        .expect("kartlar");
    assert_eq!(names, vec!["Ayşe".to_string()], "başka kiracı taşınmaz");
    let category: String = sqlx::query_scalar("SELECT tenant_id FROM categories")
        .fetch_one(&target)
        .await
        .expect("kategori");
    assert_eq!(category, "tnt_a", "kurulum kümenin kiracısına geçer");
}

#[tokio::test]
async fn dolu_kurulum_kumeye_katilamaz() {
    let target = pool().await;
    sqlx::query("INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_1', 'tnt_b', 'Yerel', 'CUSTOMER')")
        .execute(&target)
        .await
        .expect("kart");
    let mut tx = target.begin().await.expect("tx");
    let error = accept_grant(&mut tx, "tnt_b", &grant("tnt_a", Vec::new()), 9)
        .await
        .expect_err("red");
    assert!(error.starts_with("CONFLICT"), "{error}");
}

#[tokio::test]
async fn baska_kiraci_iceren_goruntu_reddedilir() {
    let target = pool().await;
    let rows = serde_json::json!([{"id": "dir_x", "tenant_id": "tnt_x", "name": "X", "type": "CUSTOMER", "created_at": "2026-01-01"}]).to_string();
    let mut tx = target.begin().await.expect("tx");
    let error = accept_grant(
        &mut tx,
        "tnt_a",
        &grant("tnt_a", vec![("directories".to_string(), rows)]),
        9,
    )
    .await
    .expect_err("red");
    assert!(error.starts_with("UNAUTHORIZED"), "{error}");
}
