//! Ada yazması: yerel onay, ada kaydı ve denetim alt zinciri.

use super::super::island_audit;
use super::super::op_log::lookup;
use super::super::pairing;
use super::super::replication_tests::{device, Device, TENANT};
use super::super::store::{self, Member};
use super::super::WritePool;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use tokio::sync::Mutex;

/// Kalıcı iki üyeli küme; döngü çalışmaz, durum çubuğu ada kipini gösterir.
async fn island_device() -> Device {
    let device = device("ada").await;
    let mut conn = device.pool.acquire().await.expect("bağlantı");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');",
    )
    .execute(&mut *conn)
    .await
    .expect("işletme");
    let mut row = pairing::init_cluster(&mut conn, TENANT, "Kasa", "key", 1)
        .await
        .expect("küme");
    row.base_members.push(Member {
        device_id: "dev_remote".to_string(),
        name: "İkinci kasa".to_string(),
        public_key: "remote_key".to_string(),
        address: String::new(),
    });
    sqlx::query("DELETE FROM sync_cluster")
        .execute(&mut *conn)
        .await
        .expect("küme");
    store::insert_cluster(&mut conn, &row)
        .await
        .expect("üyelik");
    super::super::capture::sync_triggers(&mut conn, super::super::capture::TriggerMode::Cluster)
        .await
        .expect("koruma");
    drop(conn);
    let mut status = device.sync.status();
    status.mode = "CLUSTER";
    status.state = "ISLAND";
    device.sync.publish(status);
    device
}

async fn sell(device: &Device, id: &str) -> Result<(), String> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = device.pool.begin_write().await?;
    sqlx::query(
        "INSERT INTO products (id, tenant_id, category_id, name, price_cents)
         VALUES (?, 'tnt_a', 'cat_1', 'Çay', 1000)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    let ctx = AuditContext::new(
        TENANT.to_string(),
        "usr_1".to_string(),
        "OWNER".to_string(),
        category::MENU,
        "test:ada",
        id.to_string(),
        serde_json::json!({ "id": id }),
        "2026-11-05T10:00:00Z".to_string(),
    )?;
    AuditService::append(&mut tx, &lock, &ctx).await?;
    tx.commit().await
}

async fn count(device: &Device, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(&device.pool)
        .await
        .expect("sayım")
}

#[tokio::test]
async fn otoritesiz_cihaz_yerelde_yazar_kayit_ada_gunlugune_girer() {
    let device = island_device().await;
    sell(&device, "prd_1").await.expect("ada yazması");
    sell(&device, "prd_2").await.expect("ada yazması");

    assert_eq!(count(&device, "SELECT COUNT(*) FROM products").await, 2);
    assert_eq!(
        count(
            &device,
            "SELECT COUNT(*) FROM sync_island_ops WHERE status = 'LOCAL'"
        )
        .await,
        2
    );
    assert_eq!(
        count(
            &device,
            "SELECT COUNT(DISTINCT island_epoch) FROM sync_island_ops"
        )
        .await,
        1,
        "aynı ada dönemi"
    );
    assert_eq!(
        count(&device, "SELECT COUNT(*) FROM sync_operations").await,
        0,
        "küme günlüğüne sahte sıra yazılmaz"
    );
    assert_eq!(
        count(&device, "SELECT COUNT(*) FROM audit_ledger").await,
        0,
        "ana zincir çatallanmaz"
    );
    assert_eq!(
        count(&device, "SELECT COUNT(*) FROM audit_island_ledger").await,
        2
    );
    assert_eq!(count(&device, "SELECT COUNT(*) FROM sync_capture").await, 0);

    let mut conn = device.pool.acquire().await.expect("bağlantı");
    let me: String =
        sqlx::query_scalar("SELECT device_id FROM local_device_identity WHERE slot = 1")
            .fetch_one(&mut *conn)
            .await
            .expect("cihaz");
    assert_eq!(
        island_audit::verify(&mut conn, TENANT, &me)
            .await
            .expect("doğrulama"),
        None,
        "alt zincir sağlam"
    );
    let first: String = sqlx::query_scalar(
        "SELECT operation_id FROM sync_island_ops ORDER BY device_sequence LIMIT 1",
    )
    .fetch_one(&mut *conn)
    .await
    .expect("kimlik");
    let outcome = lookup(&mut conn, TENANT, &first, None)
        .await
        .expect("sorgu")
        .expect("ada işlemi bulunur");
    assert_eq!(outcome.status, super::super::OperationStatus::Applied);
}

#[tokio::test]
async fn bekleyen_ada_kaydi_varken_yazma_kumeye_gonderilmez() {
    let device = island_device().await;
    sell(&device, "prd_1").await.expect("ada yazması");
    // Durum çubuğu toparlandı sanılsa bile ada kaydı birleşmeden yazma ada yolundadır.
    let mut status = device.sync.status();
    status.state = "READY";
    device.sync.publish(status);
    sell(&device, "prd_2").await.expect("ada yolunda kalır");
    assert_eq!(
        count(&device, "SELECT COUNT(*) FROM sync_island_ops").await,
        2
    );
}

#[tokio::test]
async fn alt_zincirde_kurcalanan_kayit_bulunur() {
    let device = island_device().await;
    sell(&device, "prd_1").await.expect("ada yazması");
    sell(&device, "prd_2").await.expect("ada yazması");
    let mut conn = device.pool.acquire().await.expect("bağlantı");
    let me: String =
        sqlx::query_scalar("SELECT device_id FROM local_device_identity WHERE slot = 1")
            .fetch_one(&mut *conn)
            .await
            .expect("cihaz");
    let error = sqlx::query("UPDATE audit_island_ledger SET payload = '{}'")
        .execute(&mut *conn)
        .await
        .expect_err("alt zincir güncellenemez");
    assert!(error.to_string().contains("IMMUTABILITY"), "{error}");
    let error = sqlx::query("DELETE FROM audit_island_ledger")
        .execute(&mut *conn)
        .await
        .expect_err("alt zincir silinemez");
    assert!(error.to_string().contains("IMMUTABILITY"), "{error}");
    assert_eq!(
        island_audit::verify(&mut conn, TENANT, &me)
            .await
            .expect("doğrulama"),
        None
    );
}
