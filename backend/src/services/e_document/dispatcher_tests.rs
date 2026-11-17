//! Gönderim testleri: idempotens, çevrimdışı bekleme, red, fail-closed.

use super::dispatcher::{dispatch_pending, refresh_status, Actor};
use super::provider::fake::{FakeProvider, Mode};
use super::provider::UnconfiguredProvider;
use super::queue::{FAILED, PENDING, SENT};
use super::test_support::*;

const ORDER_1: &str = "ord_000000000000000000000001";
const ORDER_2: &str = "ord_000000000000000000000002";

fn actor() -> Actor<'static> {
    Actor {
        tenant_id: TENANT_A,
        id: ACTOR,
        role: "OWNER",
    }
}

async fn queued(pool: &sqlx::SqlitePool, order: &str) -> String {
    seed_paid_order(pool, TENANT_A, order).await;
    let entry = draft(pool, TENANT_A, order).await.expect("taslak");
    submit(pool, TENANT_A, &entry.id).await.expect("onay");
    entry.id
}

async fn ready() -> (sqlx::SqlitePool, tokio::sync::Mutex<()>) {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    (pool, tokio::sync::Mutex::new(()))
}

#[tokio::test]
async fn saglayici_yapilandirilmamissa_uretimde_fail_closed() {
    let (pool, audit) = ready().await;
    let id = queued(&pool, ORDER_1).await;
    let error = dispatch_pending(&pool, &audit, &UnconfiguredProvider, &actor(), 10)
        .await
        .expect_err("reddedilir");
    assert!(error.contains("yapılandırılmamış"), "{error}");
    let row = entry(&pool, TENANT_A, &id).await.expect("satır");
    assert_eq!(row.status, PENDING);
    assert_eq!(row.attempts, 0, "yapılandırma eksikliği deneme sayılmaz");
}

#[tokio::test]
async fn ozellik_kapaliyken_gonderim_yapilmaz() {
    let (pool, audit) = ready().await;
    let id = queued(&pool, ORDER_1).await;
    save_settings(&pool, TENANT_A, &valid_settings(false))
        .await
        .expect("kapatılır");
    let provider = FakeProvider::new(Mode::Accept);
    let error = dispatch_pending(&pool, &audit, &provider, &actor(), 10)
        .await
        .expect_err("kapalı");
    assert!(error.starts_with("DISABLED"), "{error}");
    assert_eq!(provider.sent_count(), 0);
    assert_eq!(
        entry(&pool, TENANT_A, &id).await.expect("satır").status,
        PENDING
    );
}

#[tokio::test]
async fn ayni_belge_iki_kez_gonderilmez() {
    let (pool, audit) = ready().await;
    let id = queued(&pool, ORDER_1).await;
    let provider = FakeProvider::new(Mode::Accept);
    let first = dispatch_pending(&pool, &audit, &provider, &actor(), 10)
        .await
        .expect("gönderim");
    assert_eq!((first.sent, first.failed, first.deferred), (1, 0, 0));
    let second = dispatch_pending(&pool, &audit, &provider, &actor(), 10)
        .await
        .expect("ikinci tur");
    assert_eq!(second.sent, 0);
    assert_eq!(provider.sent_count(), 1, "sağlayıcıya tek gönderim");
    let row = entry(&pool, TENANT_A, &id).await.expect("satır");
    assert_eq!(row.status, SENT);
    assert_eq!(row.attempts, 1);
    assert_eq!(row.provider_ref, Some(format!("ref-{}", row.ettn)));
    assert!(row.sent_at.is_some());
    // Gönderilmiş belge elle yeniden kuyruğa alınamaz.
    assert!(retry(&pool, TENANT_A, &id).await.is_err());
}

#[tokio::test]
async fn eszamanli_iki_gonderim_belgeyi_bir_kez_yollar() {
    let (pool, audit) = ready().await;
    queued(&pool, ORDER_1).await;
    let provider = FakeProvider::new(Mode::Accept);
    let who = actor();
    let (a, b) = tokio::join!(
        dispatch_pending(&pool, &audit, &provider, &who, 10),
        dispatch_pending(&pool, &audit, &provider, &who, 10),
    );
    assert_eq!(a.expect("a").sent + b.expect("b").sent, 1);
    assert_eq!(provider.sent_count(), 1);
}

#[tokio::test]
async fn internet_yokken_belge_bekler_donunce_gonderilir() {
    let (pool, audit) = ready().await;
    let id1 = queued(&pool, ORDER_1).await;
    let id2 = queued(&pool, ORDER_2).await;
    let provider = FakeProvider::new(Mode::Offline);
    let report = dispatch_pending(&pool, &audit, &provider, &actor(), 10)
        .await
        .expect("tur");
    assert_eq!(
        (report.sent, report.deferred),
        (0, 1),
        "ağ yoksa kalanlar denenmez"
    );
    for id in [&id1, &id2] {
        let row = entry(&pool, TENANT_A, id).await.expect("satır");
        assert_eq!(row.status, PENDING);
        assert_eq!(row.attempts, 0);
    }
    let waiting = entry(&pool, TENANT_A, &id1).await.expect("satır");
    assert!(waiting
        .last_error
        .is_some_and(|e| e.contains("ulaşılamadı")));

    provider.set_mode(Mode::Accept);
    let report = dispatch_pending(&pool, &audit, &provider, &actor(), 10)
        .await
        .expect("tur");
    assert_eq!(report.sent, 2);
    let row = entry(&pool, TENANT_A, &id1).await.expect("satır");
    assert_eq!(row.status, SENT);
    assert!(
        row.last_error.is_none(),
        "başarıdan sonra eski hata temizlenir"
    );
}

#[tokio::test]
async fn kalici_red_hata_yapar_yeniden_deneme_ayni_ettn_ile_gider() {
    let (pool, audit) = ready().await;
    let id = queued(&pool, ORDER_1).await;
    let ettn = entry(&pool, TENANT_A, &id).await.expect("satır").ettn;
    let provider = FakeProvider::new(Mode::Reject);
    let report = dispatch_pending(&pool, &audit, &provider, &actor(), 10)
        .await
        .expect("tur");
    assert_eq!(report.failed, 1);
    let failed = entry(&pool, TENANT_A, &id).await.expect("satır");
    assert_eq!(failed.status, FAILED);
    assert_eq!(failed.attempts, 1);
    assert!(failed.last_error.is_some_and(|e| e.contains("reddetti")));

    provider.set_mode(Mode::Accept);
    retry(&pool, TENANT_A, &id).await.expect("yeniden");
    dispatch_pending(&pool, &audit, &provider, &actor(), 10)
        .await
        .expect("tur");
    let sent = entry(&pool, TENANT_A, &id).await.expect("satır");
    assert_eq!((sent.status.as_str(), sent.attempts), (SENT, 2));
    assert_eq!(sent.ettn, ettn, "yeniden denemede ETTN değişmez");
    assert_eq!(
        provider.sent.lock().map(|s| s.clone()).unwrap_or_default(),
        vec![ettn]
    );
}

#[tokio::test]
async fn gonderim_sonuclari_denetim_defterine_yazilir() {
    let (pool, audit) = ready().await;
    queued(&pool, ORDER_1).await;
    let provider = FakeProvider::new(Mode::Accept);
    dispatch_pending(&pool, &audit, &provider, &actor(), 10)
        .await
        .expect("tur");
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_ledger WHERE tenant_id = ? AND action = 'e_document:sent'",
    )
    .bind(TENANT_A)
    .fetch_one(&pool)
    .await
    .expect("sayım");
    assert_eq!(count, 1);
}

#[tokio::test]
async fn baska_kiracinin_kuyrugu_gonderilmez() {
    let (pool, audit) = ready().await;
    enable(&pool, TENANT_B).await;
    queued(&pool, ORDER_1).await;
    let provider = FakeProvider::new(Mode::Accept);
    let other = Actor {
        tenant_id: TENANT_B,
        id: ACTOR,
        role: "OWNER",
    };
    let report = dispatch_pending(&pool, &audit, &provider, &other, 10)
        .await
        .expect("tur");
    assert_eq!(report.sent, 0);
    assert_eq!(provider.sent_count(), 0);
}

#[tokio::test]
async fn durum_sorgusu_kabul_ve_reddi_kaydeder() {
    let (pool, audit) = ready().await;
    let id = queued(&pool, ORDER_1).await;
    let provider = FakeProvider::new(Mode::Accept);
    dispatch_pending(&pool, &audit, &provider, &actor(), 10)
        .await
        .expect("tur");
    let accepted = refresh_status(&pool, &audit, &provider, &actor(), &id)
        .await
        .expect("durum");
    assert_eq!(accepted.remote_status.as_deref(), Some("ACCEPTED"));
    assert_eq!(accepted.status, SENT);

    provider.set_mode(Mode::Reject);
    let rejected = refresh_status(&pool, &audit, &provider, &actor(), &id)
        .await
        .expect("durum");
    assert_eq!(rejected.status, FAILED);
    assert!(rejected.last_error.is_some_and(|e| e.contains("GİB")));
    let not_sent = refresh_status(&pool, &audit, &provider, &actor(), &id).await;
    assert!(not_sent.is_err(), "HATA durumundaki belge sorgulanmaz");
}
