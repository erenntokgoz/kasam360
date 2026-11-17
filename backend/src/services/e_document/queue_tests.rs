//! Kuyruk testleri: idempotens, fail-closed, kiracı yalıtımı, numara ve durum geçişleri.

use super::queue::{self, DRAFT, PENDING};
use super::settings;
use super::test_support::*;

const ORDER_1: &str = "ord_000000000000000000000001";
const ORDER_2: &str = "ord_000000000000000000000002";

async fn row_count(pool: &sqlx::SqlitePool, tenant: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM e_document_queue WHERE tenant_id = ?")
        .bind(tenant)
        .fetch_one(pool)
        .await
        .expect("sayım")
}

#[tokio::test]
async fn ayar_varsayilan_kapali_ve_kapaliyken_belge_uretilmez() {
    let pool = fresh_pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let current = settings::get(&mut conn, TENANT_A).await.expect("okunur");
    assert!(!current.enabled);
    drop(conn);
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    let error = draft(&pool, TENANT_A, ORDER_1).await.expect_err("kapalı");
    assert!(error.starts_with("DISABLED"), "{error}");
    assert_eq!(row_count(&pool, TENANT_A).await, 0);
}

#[tokio::test]
async fn ayar_eksik_veya_gecersiz_kimlikle_acilamaz() {
    let pool = fresh_pool().await;
    let mut input = valid_settings(true);
    input.tax_id = String::new();
    assert!(save_settings(&pool, TENANT_A, &input).await.is_err());
    input.tax_id = "1111111111".to_string();
    assert!(save_settings(&pool, TENANT_A, &input).await.is_err());
    input = valid_settings(true);
    input.legal_name = " ".to_string();
    assert!(save_settings(&pool, TENANT_A, &input).await.is_err());
    input = valid_settings(true);
    input.series_code = "AB".to_string();
    assert!(save_settings(&pool, TENANT_A, &input).await.is_err());
    // Kapalı kayıt eksik alanla tutulabilir.
    let mut closed = valid_settings(false);
    closed.legal_name = String::new();
    assert!(save_settings(&pool, TENANT_A, &closed).await.is_ok());
}

#[tokio::test]
async fn ayar_kaydi_denetim_defterine_yazilir() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_ledger WHERE tenant_id = ? AND action = 'e_document:settings_saved'",
    )
    .bind(TENANT_A)
    .fetch_one(&pool)
    .await
    .expect("sayım");
    assert_eq!(count, 1);
}

#[tokio::test]
async fn kapanmis_adisyondan_taslak_uretilir() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    let entry = draft(&pool, TENANT_A, ORDER_1).await.expect("taslak");
    assert_eq!(entry.status, DRAFT);
    assert_eq!(entry.attempts, 0);
    assert_eq!(entry.total_cents, 15800);
    assert_eq!(entry.document_number, "ADS2026000000001");
    assert_eq!(entry.ettn.len(), 36);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let body = queue::get_xml(&mut conn, TENANT_A, &entry.id)
        .await
        .expect("xml");
    assert!(body.contains("<cbc:CreditNoteTypeCode>ADISYON</cbc:CreditNoteTypeCode>"));
    assert!(body.contains(&format!("<cbc:UUID>{}</cbc:UUID>", entry.ettn)));
    assert!(body.contains("<cbc:PayableAmount currencyID=\"TRY\">158.00</cbc:PayableAmount>"));
    assert!(body.contains("<cbc:Note>ODEME:KART:58.00</cbc:Note>"));
    assert!(body.contains("Çay &amp; Simit"));
}

#[tokio::test]
async fn ayni_adisyon_ikinci_kez_belge_uretmez() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    let first = draft(&pool, TENANT_A, ORDER_1).await.expect("ilk");
    let second = draft(&pool, TENANT_A, ORDER_1).await.expect("ikinci");
    assert_eq!(first.id, second.id);
    assert_eq!(first.ettn, second.ettn);
    assert_eq!(row_count(&pool, TENANT_A).await, 1);
    let sequence: i64 = sqlx::query_scalar(
        "SELECT last_number FROM e_document_sequences WHERE tenant_id = ? AND year = 2026",
    )
    .bind(TENANT_A)
    .fetch_one(&pool)
    .await
    .expect("sıra");
    assert_eq!(sequence, 1, "ikinci çağrı numara tüketmemeli");
}

#[tokio::test]
async fn veritabani_ayni_adisyon_ve_ettn_icin_ikinci_satiri_reddeder() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    let entry = draft(&pool, TENANT_A, ORDER_1).await.expect("taslak");
    let insert = |id: &'static str, order: &'static str, ettn: String, number: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query(
                "INSERT INTO e_document_queue (id, tenant_id, order_id, ettn, session_ettn, \
                    document_number, status, xml, xml_sha256, total_cents) \
                 VALUES (?, ?, ?, ?, 's', ?, 'DRAFT', 'x', 'h', 1)",
            )
            .bind(id)
            .bind(TENANT_A)
            .bind(order)
            .bind(ettn)
            .bind(number)
            .execute(&pool)
            .await
        }
    };
    assert!(insert(
        "edq_a",
        ORDER_1,
        "yeni-ettn".to_string(),
        "ADS2026000000009"
    )
    .await
    .is_err());
    assert!(
        insert("edq_b", ORDER_2, entry.ettn.clone(), "ADS2026000000009")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn belge_numaralari_muteselsil_ettnler_benzersizdir() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    seed_paid_order(&pool, TENANT_A, ORDER_2).await;
    let first = draft(&pool, TENANT_A, ORDER_1).await.expect("ilk");
    let second = draft(&pool, TENANT_A, ORDER_2).await.expect("ikinci");
    assert_eq!(second.document_number, "ADS2026000000002");
    assert_ne!(first.ettn, second.ettn);
}

#[tokio::test]
async fn acik_adisyondan_belge_uretilmez() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    sqlx::query("UPDATE orders SET status = 'OPEN' WHERE id = ?")
        .bind(ORDER_1)
        .execute(&pool)
        .await
        .expect("güncellenir");
    let error = draft(&pool, TENANT_A, ORDER_1).await.expect_err("açık");
    assert!(error.starts_with("CONFLICT"), "{error}");
    assert_eq!(row_count(&pool, TENANT_A).await, 0);
}

#[tokio::test]
async fn kalem_toplami_adisyonla_tutmazsa_belge_uretilmez() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    sqlx::query("UPDATE orders SET total_cents = 15900 WHERE id = ?")
        .bind(ORDER_1)
        .execute(&pool)
        .await
        .expect("güncellenir");
    let error = draft(&pool, TENANT_A, ORDER_1).await.expect_err("tutarsız");
    assert!(error.contains("tutmuyor"), "{error}");
    let sequence: Option<i64> =
        sqlx::query_scalar("SELECT last_number FROM e_document_sequences WHERE tenant_id = ?")
            .bind(TENANT_A)
            .fetch_optional(&pool)
            .await
            .expect("sıra");
    assert!(sequence.is_none(), "başarısız üretim numara tüketmemeli");
}

#[tokio::test]
async fn kiraci_baska_kiracinin_adisyonuna_ve_belgesine_erisemez() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    enable(&pool, TENANT_B).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    let entry = draft(&pool, TENANT_A, ORDER_1).await.expect("taslak");
    let error = draft(&pool, TENANT_B, ORDER_1).await.expect_err("yabancı");
    assert!(error.starts_with("NOT_FOUND"), "{error}");
    assert!(entry_of(&pool, TENANT_B, &entry.id).await.is_none());
    assert!(submit(&pool, TENANT_B, &entry.id).await.is_err());
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert!(queue::list(&mut conn, TENANT_B, None, 50)
        .await
        .expect("liste")
        .is_empty());
    assert!(queue::get_xml(&mut conn, TENANT_B, &entry.id)
        .await
        .is_err());
}

async fn entry_of(pool: &sqlx::SqlitePool, tenant: &str, id: &str) -> Option<queue::QueueEntry> {
    entry(pool, tenant, id).await
}

#[tokio::test]
async fn durum_gecisleri_yalniz_izinli_yonde_calisir() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    let entry = draft(&pool, TENANT_A, ORDER_1).await.expect("taslak");
    assert!(
        retry(&pool, TENANT_A, &entry.id).await.is_err(),
        "taslak yeniden denenemez"
    );
    let queued = submit(&pool, TENANT_A, &entry.id)
        .await
        .expect("gönderilecek");
    assert_eq!(queued.status, PENDING);
    assert!(
        submit(&pool, TENANT_A, &entry.id).await.is_err(),
        "ikinci onay yok"
    );
    let mut conn = pool.acquire().await.expect("bağlantı");
    let counts = queue::counts(&mut conn, TENANT_A).await.expect("sayım");
    assert_eq!((counts.draft, counts.pending, counts.failed), (0, 1, 0));
}

#[tokio::test]
async fn ayar_kapaliyken_gonderilecege_alinamaz() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    let entry = draft(&pool, TENANT_A, ORDER_1).await.expect("taslak");
    save_settings(&pool, TENANT_A, &valid_settings(false))
        .await
        .expect("kapatılır");
    assert!(submit(&pool, TENANT_A, &entry.id).await.is_err());
    sqlx::query("UPDATE e_document_queue SET status = 'FAILED' WHERE id = ?")
        .bind(&entry.id)
        .execute(&pool)
        .await
        .expect("güncellenir");
    assert_eq!(
        retry(&pool, TENANT_A, &entry.id)
            .await
            .expect("yeniden")
            .status,
        PENDING
    );
}

#[tokio::test]
async fn taslak_yeniden_kurulunca_ettn_ve_numara_korunur() {
    let pool = fresh_pool().await;
    enable(&pool, TENANT_A).await;
    seed_paid_order(&pool, TENANT_A, ORDER_1).await;
    let entry = draft(&pool, TENANT_A, ORDER_1).await.expect("taslak");
    let mut changed = valid_settings(true);
    changed.tax_office = "Kadıköy".to_string();
    save_settings(&pool, TENANT_A, &changed)
        .await
        .expect("ayar");
    let mutex = tokio::sync::Mutex::new(());
    let lock = crate::services::audit_service::AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let rebuilt = queue::rebuild_draft(&mut conn, &lock, TENANT_A, ACTOR, "OWNER", &entry.id)
        .await
        .expect("yeniden");
    assert_eq!(rebuilt.ettn, entry.ettn);
    assert_eq!(rebuilt.document_number, entry.document_number);
    let body = queue::get_xml(&mut conn, TENANT_A, &entry.id)
        .await
        .expect("xml");
    assert!(body.contains("<cbc:Name>Kadıköy</cbc:Name>"));
}
