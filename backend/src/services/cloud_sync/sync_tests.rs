//! Gönderim, çekme ve hesaptan çıkış; bellek içi bulut sunucusuyla.
//!
//! Her kasa kendi SQLite dosyasındadır ve yazmalar tek cihaz günlüğüne (`Local`) düşer.
//! Ağ kopması, kaybolan yanıt ve kimlik reddinde hiçbir işlemin kaybolmadığı, iki kez
//! uygulanmadığı ve bulut onayı olmadan hiçbir satırın silinmediği sınanır.

use super::api::ApiError;
use super::fake_api::{rejected, transient, FakeApi};
use super::{baseline, CloudSync, SyncError};
use crate::services::lan_sync::capture::{self, TriggerMode};
use crate::services::lan_sync::local_log;
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::sync::Arc;

/// Geri yükleme testlerinin kaynak kasası: ilk yüklemesi buluta gidecek kurulu kasa.
pub(super) async fn seeded_till(id: &str) -> CloudSync {
    till(id, true).await
}

async fn till(id: &str, with_baseline: bool) -> CloudSync {
    let dir = std::env::temp_dir().join(format!("kasam360_cloud_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("klasör");
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(dir.join(format!("{id}.sqlite")))
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    let seed = format!(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
         INSERT INTO devices (id, tenant_id, name, device_type) VALUES ('a', 'tnt_a', 'a', 'POS');
         INSERT INTO devices (id, tenant_id, name, device_type) VALUES ('b', 'tnt_a', 'b', 'POS');
         INSERT INTO users (id, tenant_id, role, name, email)
             VALUES ('usr_1', 'tnt_a', 'OWNER', 'Sahip', 'sahip@ornek.test');
         INSERT INTO app_setup (slot, status, origin, tenant_id, mode)
             VALUES (1, 'COMPLETE', 'NEW', 'tnt_a', 'NEW');
         INSERT INTO local_device_identity (slot, tenant_id, device_id) VALUES (1, 'tnt_a', '{id}');
         INSERT INTO device_license (slot, device_id, license_key) VALUES (1, 'lic_{id}', 'key_{id}');
         INSERT INTO device_session (slot, user_id, tenant_id) VALUES (1, 'usr_1', 'tnt_a');"
    );
    sqlx::raw_sql(&seed).execute(&pool).await.expect("kurulum");
    let mut conn = pool.acquire().await.expect("bağlantı");
    capture::sync_triggers(&mut conn, TriggerMode::Local)
        .await
        .expect("yakalama");
    if !with_baseline {
        baseline::skip(&mut conn).await.expect("ilk yükleme");
    }
    drop(conn);
    CloudSync::new(pool, Arc::new(tokio::sync::Mutex::new(())))
}

/// Komut yolundaki gibi: iş yazması ve günlük kaydı aynı transaction'da onaylanır.
async fn write(pool: &SqlitePool, statement: &str) {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.expect("tx");
    sqlx::raw_sql(statement)
        .execute(&mut *tx)
        .await
        .expect("yazma");
    local_log::flush(&mut tx).await.expect("günlük");
    tx.commit().await.expect("onay");
}

fn product(id: &str) -> String {
    format!("INSERT INTO products (id, tenant_id, name, price_cents) VALUES ('{id}', 'tnt_a', 'Çay', 1000)")
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(pool)
        .await
        .expect("sorgu")
}

async fn pending(sync: &CloudSync) -> i64 {
    sync.status().await.expect("durum").pending
}

fn ids(api: &FakeApi) -> Vec<String> {
    api.cloud()
        .log
        .iter()
        .filter_map(|op| {
            op.get("operationId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

#[tokio::test]
async fn ilk_yukleme_ve_gunluk_sirayla_gider_ikinci_turda_tekrar_gitmez() {
    let sync = till("a", true).await;
    write(sync.pool(), &product("prd_1")).await;
    let api = FakeApi::default();
    let report = sync.sync_once(&api, false).await.expect("tur");
    let sent = api.cloud().log.clone();
    assert_eq!(report.pushed, sent.len());
    assert!(sent.len() >= 2, "ilk yükleme ve günlük kaydı");
    // Günlükten önceki satırlar önce gider; satış kaydı en sondadır.
    assert_eq!(
        sent[0].pointer("/op/body/base_state"),
        Some(&Value::from(0))
    );
    let last = sent
        .last()
        .and_then(|op| op.pointer("/op/body/changes/0/key/id"));
    assert_eq!(last, Some(&Value::from("prd_1")));
    assert_eq!(pending(&sync).await, 0);
    let again = sync.sync_once(&api, false).await.expect("tur");
    assert_eq!(again.pushed, 0);
    assert_eq!(api.cloud().log.len(), sent.len());
}

#[tokio::test]
async fn lisans_ve_kuyruk_tenanti_eslesmezse_ag_istegi_atilmaz() {
    let sync = till("a", false).await;
    write(sync.pool(), &product("prd_1")).await;
    sqlx::query("UPDATE local_device_identity SET tenant_id='tnt_b' WHERE slot=1")
        .execute(sync.pool())
        .await
        .expect("tenant fixture");
    let api = FakeApi::default();
    assert!(matches!(
        sync.sync_once(&api, true).await,
        Err(SyncError::Local(message)) if message.contains("TENANT_MISMATCH")
    ));
    assert_eq!(api.cloud().push_calls, 0);
    assert_eq!(api.cloud().log.len(), 0);
}

#[tokio::test]
async fn ag_koparsa_imlec_ilerlemez_kaybolan_yanit_tekrarlanmaz() {
    let sync = till("a", false).await;
    write(sync.pool(), &product("prd_1")).await;
    write(sync.pool(), &product("prd_2")).await;
    let api = FakeApi::default();
    api.cloud().push_errors.push_back(transient());
    assert!(matches!(
        sync.sync_once(&api, false).await,
        Err(SyncError::Transient(_))
    ));
    assert_eq!(pending(&sync).await, 2, "gönderilmeyen işlem bekler");
    assert!(api.cloud().log.is_empty());
    // Sunucu kaydeder ama yanıt kaybolur: aynı grup yeniden gider, sunucu tekrar eler.
    api.cloud().lose_push_reply = true;
    assert!(sync.sync_once(&api, false).await.is_err());
    assert_eq!(pending(&sync).await, 2);
    sync.sync_once(&api, false).await.expect("tur");
    assert_eq!(pending(&sync).await, 0);
    let mut sent = ids(&api);
    assert_eq!(sent.len(), 2);
    sent.dedup();
    assert_eq!(sent.len(), 2, "her işlem bulutta bir kez");
}

#[tokio::test]
async fn gecikmis_kuyruk_incelemeye_alininca_sunucu_onayi_gelene_kadar_yerelde_kalir() {
    let sync = till("a", false).await;
    write(sync.pool(), &product("prd_offline_pending")).await;
    let operation_id: String =
        sqlx::query_scalar("SELECT operation_id FROM sync_operations WHERE tenant_id='tnt_a'")
            .fetch_one(sync.pool())
            .await
            .expect("operation id");
    let api = FakeApi::default();
    api.cloud().push_errors.push_back(ApiError::Rejected {
        status: 202,
        code: "SYNC_REVIEW_REQUIRED".to_string(),
        message: "İşletme sahibi incelemesi bekleniyor.".to_string(),
        detail: serde_json::json!({ "pending": [operation_id] }),
    });
    assert!(matches!(
        sync.sync_once(&api, false).await,
        Err(SyncError::Permanent { ref code, .. }) if code == "SYNC_REVIEW_REQUIRED"
    ));
    assert_eq!(
        pending(&sync).await,
        1,
        "yerel günlük/iş verisi silinmez ve imleç ilerlemez"
    );
    assert_eq!(
        count(
            sync.pool(),
            "SELECT COUNT(*) FROM sync_cloud_review WHERE tenant_id='tnt_a' AND decision='PENDING'"
        )
        .await,
        1
    );
    assert!(api.cloud().log.is_empty());
    // OWNER uzlaştırmasından sonra aynı işlem kimliğiyle tekrar gönderim normal kabul edilir.
    sync.sync_once(&api, false)
        .await
        .expect("uzlaştırma sonrası kabul");
    assert_eq!(pending(&sync).await, 0);
    assert_eq!(ids(&api).len(), 1);
}

#[tokio::test]
async fn bulut_red_karari_kuyruktan_cikarir_ama_yerel_urunu_korur() {
    let sync = till("a", false).await;
    write(sync.pool(), &product("prd_rejected")).await;
    write(sync.pool(), &product("prd_accepted_next")).await;
    let ids_before = sqlx::query_scalar::<_, String>(
        "SELECT operation_id FROM sync_operations WHERE tenant_id='tnt_a' ORDER BY log_index",
    )
    .fetch_all(sync.pool())
    .await
    .expect("operation ids");
    let rejected_id = ids_before[0].clone();
    let api = FakeApi::default();
    api.cloud().push_errors.push_back(ApiError::Rejected {
        status: 409, code: "OPERATION_REJECTED".to_string(),
        message: "İşletme sahibi işlemi reddetti.".to_string(),
        detail: serde_json::json!({ "operationId": rejected_id, "reason": "Bu ürün kaydı doğrulanamadı" }),
    });
    sync.sync_once(&api, false)
        .await
        .expect("reddedilen kayıt atlanıp sonraki kayıt gönderilir");
    assert_eq!(
        count(
            sync.pool(),
            "SELECT COUNT(*) FROM products WHERE tenant_id='tnt_a'"
        )
        .await,
        2
    );
    assert_eq!(pending(&sync).await, 0);
    assert_eq!(ids(&api), vec![ids_before[1].clone()]);
    let review: (String, String) = sqlx::query_as(
        "SELECT decision, reason FROM sync_cloud_review WHERE tenant_id='tnt_a' AND operation_id=?",
    )
    .bind(rejected_id)
    .fetch_one(sync.pool())
    .await
    .expect("red kararı yerelde durur");
    assert_eq!(
        review,
        (
            "REJECTED".to_string(),
            "Bu ürün kaydı doğrulanamadı".to_string()
        )
    );
    sync.sync_once(&api, false)
        .await
        .expect("ikinci turda red tekrar gönderilmez");
    assert_eq!(api.cloud().push_calls, 2);
    assert_eq!(
        count(
            sync.pool(),
            "SELECT COUNT(*) FROM products WHERE id='prd_rejected'"
        )
        .await,
        1
    );
}

#[tokio::test]
async fn kimlik_reddinde_durur_ayni_anahtarla_yeniden_istek_atmaz() {
    let sync = till("a", false).await;
    write(sync.pool(), &product("prd_1")).await;
    let api = FakeApi::default();
    api.cloud()
        .push_errors
        .push_back(rejected(401, "LICENSE_INVALID"));
    let first = sync.sync_once(&api, false).await;
    assert!(matches!(first, Err(SyncError::Halted { ref code, .. }) if code == "LICENSE_INVALID"));
    let second = sync.sync_once(&api, false).await;
    assert!(matches!(second, Err(SyncError::Halted { ref code, .. }) if code == "HALTED"));
    assert_eq!(
        api.cloud().push_calls,
        1,
        "reddedilen anahtarla istek atılmaz"
    );
    // Anahtar yenilenince (uyandırma) gönderim kaldığı yerden sürer.
    sync.nudge();
    sync.sync_once(&api, false).await.expect("tur");
    assert_eq!(pending(&sync).await, 0);
    assert_eq!(ids(&api).len(), 1);
}

#[tokio::test]
async fn sunucu_siniri_darsa_grup_kuculur_hepsi_gider() {
    let sync = till("a", false).await;
    for index in 0..5 {
        write(sync.pool(), &product(&format!("prd_{index}"))).await;
    }
    let api = FakeApi::default();
    api.cloud().max_operations = Some(1);
    let report = sync.sync_once(&api, false).await.expect("tur");
    assert_eq!(report.pushed, 5);
    assert_eq!(pending(&sync).await, 0);
}

#[tokio::test]
async fn diger_kasanin_satisi_buluttan_gelir_geri_gonderilmez() {
    let a = till("a", false).await;
    let b = till("b", false).await;
    let api = FakeApi::default();
    write(a.pool(), &product("prd_1")).await;
    a.sync_once(&api, false).await.expect("a gönderir");
    let report = b.sync_once(&api, true).await.expect("b çeker");
    assert_eq!(report.pulled, Some(1));
    assert_eq!(
        count(b.pool(), "SELECT COUNT(*) FROM products WHERE id = 'prd_1'").await,
        1
    );
    // Uygulanan satır yakalanmaz: b'nin günlüğünde yeni kayıt yoktur, buluta geri gitmez.
    assert_eq!(pending(&b).await, 0);
    let again = b.sync_once(&api, true).await.expect("b yeniden");
    assert_eq!((again.pushed, again.pulled), (0, Some(0)));
    assert_eq!(api.cloud().log.len(), 1);
    // Kendi işlemi geri geldiğinde ikinci kez uygulanmaz.
    let own = a.sync_once(&api, true).await.expect("a çeker");
    assert_eq!(own.pulled, Some(0));
}

async fn sign_out_locally(sync: &CloudSync) {
    let mut conn = sync.pool().acquire().await.expect("bağlantı");
    crate::services::device_session::sign_out(&mut conn)
        .await
        .expect("oturum");
}

#[tokio::test]
async fn cikista_gonderilmemis_islem_varken_hicbir_satir_silinmez() {
    let sync = till("a", false).await;
    write(sync.pool(), &product("prd_1")).await;
    sign_out_locally(&sync).await;
    let api = FakeApi::default();
    api.cloud().push_errors.push_back(transient());
    let outcome = sync.sign_out(&api).await.expect("çıkış");
    assert!(!outcome.wiped);
    assert_eq!(outcome.pending, 1);
    assert_eq!(api.cloud().release_calls, 0, "gönderilmeden onay istenmez");
    assert_eq!(count(sync.pool(), "SELECT COUNT(*) FROM products").await, 1);
    assert!(sync.status().await.expect("durum").wipe_pending);
}

#[tokio::test]
async fn cikista_bulut_onaylamazsa_veri_kalir_onaylayinca_silinir() {
    let sync = till("a", true).await;
    write(sync.pool(), &product("prd_1")).await;
    sign_out_locally(&sync).await;
    let api = FakeApi::default();
    api.cloud().release_errors.push_back(transient());
    let kept = sync.sign_out(&api).await.expect("çıkış");
    assert!(!kept.wiped);
    assert_eq!(count(sync.pool(), "SELECT COUNT(*) FROM products").await, 1);
    // İnternet gelince bekleyen silme sonraki turda tamamlanır.
    let report = sync.sync_once(&api, true).await.expect("tur");
    assert!(report.wiped);
    let pool = sync.pool();
    assert_eq!(count(pool, "SELECT COUNT(*) FROM products").await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM tenants").await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM sync_operations").await, 0);
    assert_eq!(
        count(
            pool,
            "SELECT COUNT(*) FROM app_setup WHERE status = 'PENDING'"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            pool,
            "SELECT COUNT(*) FROM device_license WHERE license_key IS NULL"
        )
        .await,
        1
    );
    assert!(!api.cloud().log.is_empty(), "bulut kaydı durur");
}

#[tokio::test]
async fn cikistan_once_yeniden_girilirse_silme_iptal_edilir() {
    let sync = till("a", false).await;
    write(sync.pool(), &product("prd_1")).await;
    sign_out_locally(&sync).await;
    let api = FakeApi::default();
    api.cloud().release_errors.push_back(transient());
    assert!(!sync.sign_out(&api).await.expect("çıkış").wiped);
    sqlx::query("UPDATE device_session SET user_id = 'usr_1', tenant_id = 'tnt_a' WHERE slot = 1")
        .execute(sync.pool())
        .await
        .expect("giriş");
    let report = sync.sync_once(&api, false).await.expect("tur");
    assert!(!report.wiped);
    assert!(!sync.status().await.expect("durum").wipe_pending);
    assert_eq!(count(sync.pool(), "SELECT COUNT(*) FROM products").await, 1);
}

/// 1,5 MiB WebP'nin base64 metni; yerel `image_url` bu boyutta olabilir.
fn big_image() -> String {
    format!("data:image/webp;base64,{}", "A".repeat(2_097_152))
}

#[tokio::test]
async fn buyuk_gorselli_uc_urun_degisikligi_kuyrugu_ilerletir() {
    let sync = till("a", false).await;
    for index in 0..3 {
        write(sync.pool(), &product(&format!("prd_{index}"))).await;
    }
    let api = FakeApi::default();
    sync.sync_once(&api, false).await.expect("ilk tur");
    for index in 0..3 {
        write(
            sync.pool(),
            &format!(
                "UPDATE products SET image_url = '{}' WHERE id = 'prd_{index}'",
                big_image()
            ),
        )
        .await;
    }
    sync.sync_once(&api, false).await.expect("görselli tur");
    assert_eq!(pending(&sync).await, 0);
    // Görsel eşitleme yüküyle gider ama grup 3,5 MB'ı aşmaz: üç işlem birden değil bölünerek gider.
    let cloud = api.cloud();
    assert!(
        cloud.push_calls >= 3,
        "görselli işlemler tek gövdede toplanmamalı"
    );
    assert!(cloud
        .log
        .iter()
        .all(|op| op.to_string().len() <= super::outbox::LIMITS.bytes));
}
