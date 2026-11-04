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
        super::capture::sync_triggers(&mut conn, true)
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
