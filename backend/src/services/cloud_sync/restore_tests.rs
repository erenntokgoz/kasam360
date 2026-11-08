//! Boş kasaya bulut geri yüklemesi: veri gerçek bir kasanın gönderdiği işlemlerden kurulur.
//! Kanıtlanan sınırlar: dolu kasaya yazılmaz, yarıda kalan indirme kasayı boş bırakır ve
//! tekrar denenebilir, işletme uyuşmazlığı reddedilir, kullanıcısız görüntü kurulum sayılmaz,
//! geri yüklenen kasada yeni OWNER açılmaz.

use super::api::Credentials;
use super::fake_api::{transient, FakeApi};
use super::{CloudSync, RestoreOutcome};
use crate::services::lan_sync::capture::{self, TriggerMode};
use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::sync::Arc;

async fn empty_till() -> SqlitePool {
    let dir = std::env::temp_dir().join(format!("kasam360_restore_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("klasör");
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(dir.join("bos.sqlite"))
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO device_license (slot, device_id, license_key) VALUES (1, 'lic_b', 'key_b');",
    )
    .execute(&pool)
    .await
    .expect("lisans");
    let mut conn = pool.acquire().await.expect("bağlantı");
    capture::sync_triggers(&mut conn, TriggerMode::Local)
        .await
        .expect("yakalama");
    pool
}

/// Kaynak kasanın ilk yüklemesi buluta gider; anlık görüntü o işlemlerin satırlarından kurulur.
async fn cloud_snapshot() -> Vec<Value> {
    let source = super::sync_tests::seeded_till("a").await;
    let api = FakeApi::default();
    source
        .sync_once(&api, false)
        .await
        .expect("kaynak gönderimi");
    let mut rows = Vec::new();
    for op in api.cloud().log.iter() {
        let changes = op
            .pointer("/op/body/changes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for change in changes {
            if let (Some(table), Some(row)) = (change.get("table"), change.get("row")) {
                rows.push(json!({ "table": table, "key": change.get("key"), "row": row }));
            }
        }
    }
    rows
}

fn credentials(tenant: &str) -> Credentials {
    Credentials {
        tenant_id: tenant.to_string(),
        license_key: "key_b".to_string(),
        license_device_id: "lic_b".to_string(),
    }
}

fn page(tenant: &str, rows: Vec<Value>) -> Value {
    json!({ "tenantId": tenant, "asOfSeq": 7, "rows": rows })
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(pool)
        .await
        .expect("sorgu")
}

async fn run(
    pool: &SqlitePool,
    api: &FakeApi,
    tenant: &str,
) -> Result<RestoreOutcome, super::SyncError> {
    let sync = CloudSync::new(pool.clone(), Arc::new(tokio::sync::Mutex::new(())));
    sync.restore_tenant(api, &credentials(tenant), Some("sahip@ornek.test"), &|_| {})
        .await
}

#[tokio::test]
async fn bos_kasa_indirilir_yeni_owner_acilmaz_ve_kurulum_tamamlanir() {
    let rows = cloud_snapshot().await;
    assert!(
        rows.iter().any(|row| row["table"] == "users"),
        "görüntüde kullanıcı var"
    );
    let pool = empty_till().await;
    let api = FakeApi::default();
    api.cloud()
        .snapshot_pages
        .push_back(Ok(page("tnt_a", rows)));
    let outcome = run(&pool, &api, "tnt_a").await.expect("geri yükleme");
    assert!(outcome.restored);
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM users WHERE role = 'OWNER'").await,
        1
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM app_setup WHERE status = 'COMPLETE' AND tenant_id = 'tnt_a'"
        )
        .await,
        1
    );
}

#[tokio::test]
async fn kullanicisiz_goruntu_kurulum_sayilmaz_kasa_bos_kalir() {
    let pool = empty_till().await;
    let api = FakeApi::default();
    api.cloud()
        .snapshot_pages
        .push_back(Ok(page("tnt_a", Vec::new())));
    let outcome = run(&pool, &api, "tnt_a").await.expect("sonuç");
    assert!(!outcome.restored);
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM app_setup WHERE status = 'COMPLETE'"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn yarida_kalan_indirme_kasayi_bos_birakir_tekrar_deneme_tamamlar() {
    let rows = cloud_snapshot().await;
    let (first, rest) = rows.split_at(rows.len() / 2);
    let pool = empty_till().await;
    let api = FakeApi::default();
    {
        let mut cloud = api.cloud();
        let mut paged = page("tnt_a", first.to_vec());
        paged["next"] = json!("c1");
        cloud.snapshot_pages.push_back(Ok(paged));
        cloud.snapshot_pages.push_back(Err(transient()));
    }
    assert!(run(&pool, &api, "tnt_a").await.is_err(), "ağ koptu");
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM users").await,
        0,
        "yarım veri yazılmaz"
    );
    {
        let mut cloud = api.cloud();
        let mut paged = page("tnt_a", first.to_vec());
        paged["next"] = json!("c1");
        cloud.snapshot_pages.push_back(Ok(paged));
        cloud
            .snapshot_pages
            .push_back(Ok(page("tnt_a", rest.to_vec())));
    }
    let outcome = run(&pool, &api, "tnt_a").await.expect("tekrar deneme");
    assert!(outcome.restored);
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM users WHERE role = 'OWNER'").await,
        1
    );
}

#[tokio::test]
async fn baska_isletmenin_goruntusu_ve_dolu_kasa_reddedilir() {
    let rows = cloud_snapshot().await;
    let pool = empty_till().await;
    let api = FakeApi::default();
    api.cloud()
        .snapshot_pages
        .push_back(Ok(page("tnt_b", rows.clone())));
    assert!(
        run(&pool, &api, "tnt_a").await.is_err(),
        "işletme uyuşmazlığı"
    );
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM users").await, 0);

    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_x', 'Yerel');
         INSERT INTO users (id, tenant_id, role, name) VALUES ('usr_yerel', 'tnt_x', 'OWNER', 'Yerel');",
    )
    .execute(&pool)
    .await
    .expect("yerel veri");
    api.cloud()
        .snapshot_pages
        .push_back(Ok(page("tnt_a", rows)));
    let error = run(&pool, &api, "tnt_a").await.expect_err("dolu kasa");
    assert_eq!(error.code(), "CLOUD_RESTORE_NOT_EMPTY");
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM users").await,
        1,
        "yerel veri korunur"
    );
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM users WHERE id = 'usr_yerel'").await,
        1
    );
}
