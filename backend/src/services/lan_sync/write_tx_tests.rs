//! Üyelik diske yazıldığında arayüz önbelleği henüz güncellenmemiş olabilir.

use super::op_log::{self, LogOp, Operation};
use super::pairing;
use super::replication_tests::{device, Device, TENANT};
use super::runtime::MemberStatus;
use super::store::{self, Member};
use super::WritePool;

async fn joining_device(pending: bool) -> Device {
    let device = device("membership_gap").await;
    let mut conn = device.pool.acquire().await.expect("bağlantı");
    sqlx::query("INSERT INTO tenants (id, name) VALUES (?, 'Değişmedi')")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("işletme");
    let mut row = pairing::init_cluster(&mut conn, TENANT, "Kasa", "key", 1)
        .await
        .expect("küme");
    let mut members = row.base_members.clone();
    members.push(Member {
        device_id: "dev_remote".to_string(),
        name: "İkinci kasa".to_string(),
        public_key: "remote_key".to_string(),
        address: String::new(),
    });
    if pending {
        let operation = Operation {
            operation_id: "op_members".to_string(),
            tenant_id: TENANT.to_string(),
            device_id: row.base_members[0].device_id.clone(),
            actor_id: "usr_owner".to_string(),
            actor_role: "OWNER".to_string(),
            intent_sha256: String::new(),
            op: LogOp::SetMembers(members),
            created_at: "2026-11-03T00:00:00Z".to_string(),
        };
        op_log::append(&mut conn, &operation, 1, 0)
            .await
            .expect("üyelik önerisi");
    } else {
        sqlx::query("DELETE FROM sync_cluster WHERE tenant_id = ?")
            .bind(TENANT)
            .execute(&mut *conn)
            .await
            .expect("test kümesi");
        row.base_members = members;
        store::insert_cluster(&mut conn, &row)
            .await
            .expect("kalıcı üyelik");
        super::capture::sync_triggers(&mut conn, super::capture::TriggerMode::Cluster)
            .await
            .expect("koruma");
    }
    drop(conn);
    device
}

async fn rename(device: &Device) -> Result<(), String> {
    let mut tx = device.pool.begin_write().await?;
    sqlx::query("UPDATE tenants SET name = 'Değişti' WHERE id = ?")
        .bind(TENANT)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    tx.commit().await
}

#[tokio::test]
async fn bekleyen_uyelikte_eski_tek_cihaz_onbellegi_yerel_yazmayi_acmaz() {
    let device = joining_device(true).await;
    let result = rename(&device).await;
    assert!(result.is_err(), "korumasız yerel yazma kabul edildi");
    let name: String = sqlx::query_scalar("SELECT name FROM tenants WHERE id = ?")
        .bind(TENANT)
        .fetch_one(&device.pool)
        .await
        .expect("işletme");
    assert_eq!(name, "Değişmedi");
}

#[tokio::test]
async fn bekleyen_uyelikte_bos_yakalama_basarili_islem_sayilmaz() {
    let device = joining_device(true).await;
    let mut status = device.sync.status();
    status.mode = "CLUSTER";
    status.members = vec![MemberStatus::default(), MemberStatus::default()];
    device.sync.publish(status);
    let result = rename(&device).await;
    assert!(
        result.is_err(),
        "tetikleyici kurulmadan boş yakalama yerelde onaylandı"
    );
}

#[tokio::test]
async fn kalici_coklu_uyelikte_eski_onbellek_yazmayi_tek_cihaza_dusurmez() {
    let device = joining_device(false).await;
    let error = rename(&device).await.expect_err("eşitleme döngüsü yok");
    assert!(
        error.starts_with("NO_CONNECTION"),
        "kalıcı üyelik kullanılmalı: {error}"
    );
}

async fn single_device(cluster: bool) -> Device {
    let device = device("tek").await;
    let mut conn = device.pool.acquire().await.expect("bağlantı");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');",
    )
    .execute(&mut *conn)
    .await
    .expect("işletme");
    if cluster {
        pairing::init_cluster(&mut conn, TENANT, "Kasa", "key", 1)
            .await
            .expect("küme");
    }
    super::capture::sync_triggers(&mut conn, super::capture::TriggerMode::Local)
        .await
        .expect("yakalama");
    drop(conn);
    device
}

async fn add(device: &Device, id: &str) {
    let mut tx = device.pool.begin_write().await.expect("yazma");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, category_id, name, price_cents)
         VALUES (?, 'tnt_a', 'cat_1', 'Çay', 1000)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .expect("ürün");
    tx.commit().await.expect("onay");
}

async fn logged(device: &Device) -> Vec<(String, String, i64)> {
    sqlx::query_as(
        "SELECT status, payload, log_index FROM sync_operations
         WHERE tenant_id = ? ORDER BY log_index",
    )
    .bind(TENANT)
    .fetch_all(&device.pool)
    .await
    .expect("günlük")
}

#[tokio::test]
async fn tek_cihazda_her_yazma_gunluge_anahtariyla_girer() {
    let device = single_device(false).await;
    add(&device, "prd_1").await;
    // Kapı dışı yazma durdurulmaz; bir sonraki kapılı yazmayla günlüğe girer.
    sqlx::query("UPDATE products SET price_cents = 1200 WHERE id = 'prd_1'")
        .execute(&device.pool)
        .await
        .expect("kapı dışı");
    add(&device, "prd_2").await;

    let entries = logged(&device).await;
    assert_eq!(entries.len(), 2, "{entries:?}");
    for (status, _, _) in &entries {
        assert_eq!(status, "APPLIED");
    }
    let first: LogOp = serde_json::from_str(&entries[0].1).expect("kayıt");
    let LogOp::Changes { changes, .. } = first else {
        panic!("değişiklik kaydı bekleniyordu");
    };
    let insert = changes
        .iter()
        .find(|change| change.table == "products")
        .expect("ürün satırı");
    assert_eq!(insert.action, "I");
    let key = insert.key.as_ref().expect("eklemede anahtar");
    assert_eq!(
        key.get("id"),
        insert.row.as_ref().and_then(|row| row.get("id"))
    );

    let second: LogOp = serde_json::from_str(&entries[1].1).expect("kayıt");
    let LogOp::Changes { changes, .. } = second else {
        panic!("değişiklik kaydı bekleniyordu");
    };
    let update = changes
        .iter()
        .find(|change| change.action == "U")
        .expect("kapı dışı güncelleme");
    assert_eq!(
        update.old.as_ref().and_then(|old| old.get("price_cents")),
        Some(&serde_json::json!(1000))
    );
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_capture")
        .fetch_one(&device.pool)
        .await
        .expect("yakalama");
    assert_eq!(pending, 0);
}

#[tokio::test]
async fn tek_uyeli_kumede_yerel_kayit_onay_konumunu_ilerletir() {
    let device = single_device(true).await;
    add(&device, "prd_1").await;
    let entries = logged(&device).await;
    assert_eq!(entries.len(), 1);
    let mut conn = device.pool.acquire().await.expect("bağlantı");
    let row = store::load_cluster(&mut conn)
        .await
        .expect("küme")
        .expect("kayıt");
    assert_eq!(row.commit_index, entries[0].2, "anlık görüntü kaydı kapsar");
    assert_eq!(row.state_index, 1);
}
