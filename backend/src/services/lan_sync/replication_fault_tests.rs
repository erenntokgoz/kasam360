//! Cihaz kaybı, yeniden bağlanma, pasife alma, adres değişimi ve yedekten dönüş.

use super::replication_tests::{
    add_product, add_with_retry, cluster, device, has_product, join_cluster, state_index,
    wait_until, TENANT,
};
use super::runtime::LanSync;
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

#[tokio::test]
async fn iki_cihazda_biri_kaybolunca_yazma_durur_donunce_surer() {
    let devices = cluster(2).await;
    let (authority, follower) = (&devices[0], &devices[1]);
    authority.sync.shutdown().await;
    wait_until!(
        "bağlantı koptu",
        follower.sync.status().state == "NO_CONNECTION"
    );

    assert!(add_product(&follower.pool, "prd_x").await.is_err());
    assert!(
        !has_product(&follower.pool, "prd_x").await,
        "onaysız satır yazılmaz"
    );
    let sold: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products")
        .fetch_one(&follower.pool)
        .await
        .expect("okuma");
    assert!(sold > 0, "okuma sürer");

    let restarted = LanSync::new(
        authority.pool.clone(),
        Arc::new(Mutex::new(())),
        "127.0.0.1",
    );
    restarted.resume().await;
    wait_until!(
        "küme döndü",
        restarted.status().state == "READY" && follower.sync.status().state == "READY"
    );
    add_with_retry(&follower.pool, "prd_y")
        .await
        .expect("yazma");
    wait_until!(
        "ikisine de ulaştı",
        has_product(&authority.pool, "prd_y").await
    );
    restarted.shutdown().await;
}

#[tokio::test]
async fn uc_cihazda_otorite_kaybolunca_kalan_ikisi_devam_eder() {
    let devices = cluster(3).await;
    devices[0].sync.shutdown().await;
    wait_until!(
        "yeni otorite",
        devices[1].sync.status().state == "READY" && devices[2].sync.status().state == "READY"
    );
    let mut written = Err(String::new());
    for _ in 0..40 {
        written = add_with_retry(&devices[1].pool, "prd_z").await;
        if written.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    written.expect("çoğunluk sürer");
    wait_until!(
        "üçüncüye ulaştı",
        has_product(&devices[2].pool, "prd_z").await
    );
    assert!(!has_product(&devices[0].pool, "prd_z").await);

    // Kaybolan cihaz dönünce eksiğini tamamlar.
    let back = LanSync::new(
        devices[0].pool.clone(),
        Arc::new(Mutex::new(())),
        "127.0.0.1",
    );
    back.resume().await;
    wait_until!(
        "eksik tamamlandı",
        has_product(&devices[0].pool, "prd_z").await
    );
    back.shutdown().await;
}

#[tokio::test]
async fn pasife_alinan_cihaz_yazamaz_kalan_cihaz_tek_basina_surer() {
    let devices = cluster(2).await;
    wait_until!(
        "otorite belli",
        devices[0].sync.status().role == Some(super::engine::Role::Leader)
            || devices[1].sync.status().role == Some(super::engine::Role::Leader)
    );
    let keeper = usize::from(devices[0].sync.status().role != Some(super::engine::Role::Leader));
    let leaving = 1 - keeper;
    let passive = local_device(&devices[leaving].pool).await;
    let outcome = devices[keeper]
        .sync
        .set_device_passive(TENANT, &passive, "usr_1", "OWNER")
        .await
        .expect("pasif");
    assert_eq!(outcome.status, super::OperationStatus::Applied);
    wait_until!("tek üye", !devices[keeper].sync.replicates_writes());

    sqlx::query("UPDATE products SET price_cents = 900 WHERE id = 'prd_1'")
        .execute(&devices[keeper].pool)
        .await
        .expect("tek cihazda kapı kalkar");
    add_product(&devices[keeper].pool, "prd_tek")
        .await
        .expect("yazma");

    // Otorite çıkarılan cihazla konuşmayı keser; cihaz çoğunluğu kaybedip yazmayı durdurur.
    wait_until!(
        "pasif cihaz yazmayı durdurdu",
        devices[leaving].sync.status().state == "NO_CONNECTION"
    );
    assert!(devices[leaving].sync.replicates_writes());
    assert!(add_product(&devices[leaving].pool, "prd_pasif")
        .await
        .is_err());
}

async fn local_device(pool: &SqlitePool) -> String {
    let mut conn = pool.acquire().await.expect("bağlantı");
    crate::services::device_identity::ensure_local_device(&mut conn, TENANT)
        .await
        .expect("cihaz")
}

#[tokio::test]
async fn cihazin_adresi_degisince_kume_yeniden_baglanir() {
    let devices = cluster(2).await;
    devices[0].sync.shutdown().await;
    wait_until!(
        "bağlantı koptu",
        devices[1].sync.status().state == "NO_CONNECTION"
    );
    // Yeni IP'nin karşılığı: aynı cihaz başka adresten dinlemeye başlar.
    let moved = {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("port");
        listener.local_addr().expect("adres").port()
    };
    sqlx::query("UPDATE sync_cluster SET listen_port = ?")
        .bind(i64::from(moved))
        .execute(&devices[0].pool)
        .await
        .expect("port");
    let restarted = LanSync::new(
        devices[0].pool.clone(),
        Arc::new(Mutex::new(())),
        "127.0.0.1",
    );
    restarted.resume().await;
    wait_until!(
        "yeni adresle döndü",
        restarted.status().state == "READY" && devices[1].sync.status().state == "READY"
    );
    add_with_retry(&devices[1].pool, "prd_ip")
        .await
        .expect("yazma");
    wait_until!("ulaştı", has_product(&devices[0].pool, "prd_ip").await);
    restarted.shutdown().await;
}

#[tokio::test]
async fn yedekten_donen_cihaz_kumeden_ayrilir_kilitli_kalmaz() {
    let devices = cluster(2).await;
    devices[1].sync.shutdown().await;
    // Geri yükleme hazırlığının bıraktığı durum: eşitleme tabloları boş.
    sqlx::raw_sql("DELETE FROM sync_cluster; DELETE FROM sync_operations; DELETE FROM sync_peers;")
        .execute(&devices[1].pool)
        .await
        .expect("geri yükleme");

    let restored = LanSync::new(
        devices[1].pool.clone(),
        Arc::new(Mutex::new(())),
        "127.0.0.1",
    );
    restored.resume().await;
    assert_eq!(restored.status().mode, "SINGLE");
    add_product(&devices[1].pool, "prd_geri")
        .await
        .expect("tek cihaz");
    assert!(
        !has_product(&devices[0].pool, "prd_geri").await,
        "küme etkilenmez"
    );
}

#[tokio::test]
async fn yeni_cihaz_yazilmis_durumu_ve_durum_sayacini_alir() {
    let mut devices = cluster(2).await;
    add_with_retry(&devices[0].pool, "prd_once")
        .await
        .expect("yazma");
    wait_until!("yayıldı", has_product(&devices[1].pool, "prd_once").await);

    let late = device("gec").await;
    join_cluster(&devices, &late).await;
    assert!(
        has_product(&late.pool, "prd_once").await,
        "görüntüden gelir"
    );
    wait_until!("üye oldu", late.sync.status().members.len() == 3);
    devices.push(late);

    add_with_retry(&devices[2].pool, "prd_gec")
        .await
        .expect("yeni cihaz yazar");
    wait_until!("yayıldı", has_product(&devices[0].pool, "prd_gec").await);
    wait_until!(
        "sayaçlar aynı",
        state_index(&devices[0].pool).await == state_index(&devices[2].pool).await
    );
}

#[tokio::test]
async fn sahip_kaybolan_cihazi_birakip_tek_cihazla_devam_edebilir() {
    let devices = cluster(2).await;
    add_with_retry(&devices[1].pool, "prd_once")
        .await
        .expect("yazma");
    devices[0].sync.shutdown().await;
    wait_until!(
        "bağlantı koptu",
        devices[1].sync.status().state == "NO_CONNECTION"
    );
    assert!(add_product(&devices[1].pool, "prd_x").await.is_err());

    let outcome = devices[1]
        .sync
        .take_over(TENANT, "usr_1", "OWNER")
        .await
        .expect("devralma");
    assert_eq!(outcome.status, super::OperationStatus::Applied);
    wait_until!("tek cihaz", !devices[1].sync.replicates_writes());

    add_product(&devices[1].pool, "prd_sonra")
        .await
        .expect("satış sürer");
    assert!(
        has_product(&devices[1].pool, "prd_once").await,
        "eski kayıt korunur"
    );
    let triggers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync_cap_%'",
    )
    .fetch_one(&devices[1].pool)
    .await
    .expect("sayım");
    assert_eq!(triggers, 0);
}

#[tokio::test]
async fn cogunluk_varken_devralma_reddedilir() {
    let devices = cluster(2).await;
    let error = devices[1]
        .sync
        .take_over(TENANT, "usr_1", "OWNER")
        .await
        .expect_err("çoğunluk var");
    assert!(error.starts_with("CONFLICT"), "{error}");
}
