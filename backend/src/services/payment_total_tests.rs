// `payment_approval::tests` alt modülü: aynı havuz/seed/lock yardımcılarını
// kullanır, bu yüzden `use super::*` ile üst modülün içe aktarmalarını alır.
use super::*;

// --- D3: Ödeme toplamı eşiği -------------------------------------------------
//
// Aynı dosyada durmasının nedeni: iki kapı da aynı jeton alanını paylaşır.
// Aralarındaki öncelik kuralı (indirim onayı toplam onayını geçersiz kılar)
// yalnızca ikisi birlikte göründüğünde anlamlıdır.

/// Toplam onayını dener; jeton yoksa hata metni döndürülür.
async fn consume_total<'a>(
    conn: &'a mut sqlx::SqliteConnection,
    audit_lock: &'a AuditLock<'_>,
    total_cents: i64,
    token: Option<&str>,
    discount_onaylandi: bool,
) -> Result<Option<ConsumedApproval>, String> {
    consume_total_approval(
        conn,
        audit_lock,
        TENANT,
        CASHIER,
        "CASHIER",
        TRANSACTION,
        total_cents,
        token,
        discount_onaylandi,
    )
    .await
}

#[tokio::test]
async fn esik_tanimli_degilse_toplam_onayi_acilmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let mutex = tokio::sync::Mutex::new(());
    let lock = lock_for(&mutex).await;

    // Kiracının eşik satırı yok: bu yüzey mevcut davranışta kalır. Aksi halde
    // her işletmede her yüksek tutarlı ödeme müdür onayı istirdi.
    let sonuc = consume_total(&mut conn, &lock, 5_000_000, None, false)
        .await
        .expect("hata vermemeli");
    assert!(sonuc.is_none(), "eşik yoksa toplam onayı açılmaz");
}

#[tokio::test]
async fn esik_altinda_toplam_onay_gerekmez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    crate::services::security360::threshold::esik_ayarla(&mut conn, TENANT, 1_000_000)
        .await
        .expect("eşik yazılır");
    let mutex = tokio::sync::Mutex::new(());
    let lock = lock_for(&mutex).await;

    // Eşiğin bir kuruş altı jetonsuz geçer: sınır `>=` ile değil.
    assert!(consume_total(&mut conn, &lock, 999_999, None, false)
        .await
        .expect("hata vermemeli")
        .is_none());
    assert!(consume_total(&mut conn, &lock, 0, None, false)
        .await
        .expect("hata vermemeli")
        .is_none());
}

#[tokio::test]
async fn esik_tam_tutarda_toplam_onay_ister_ve_jetonsuz_gecmez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    crate::services::security360::threshold::esik_ayarla(&mut conn, TENANT, 1_000_000)
        .await
        .expect("eşik yazılır");
    let mutex = tokio::sync::Mutex::new(());
    let lock = lock_for(&mutex).await;

    // Eşiğin tam kendisi de onay ister: eşik "bu tutarı onaylayın" demektir,
    // "bu tutarı onaylamayın" değil.
    let hata = consume_total(&mut conn, &lock, 1_000_000, None, false)
        .await
        .expect_err("jetonsuz geçmemeli");
    assert_eq!(
        hata,
        approval_service::error::TOKEN_REQUIRED,
        "eşik tam tutarda jeton zorunlu olmalı"
    );
}

#[tokio::test]
async fn dogru_jeton_toplam_onayini_kapatir_ve_guvenlik_kaydi_yazar() {
    let pool = pool().await;
    // Kullanıcı **önce** eklenir: havuz tek bağlantılıdır, `conn` tutulurken
    // havuzdan ikinci bağlantı istenirse havuz zaman aşımına düşer.
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    crate::services::security360::threshold::esik_ayarla(&mut conn, TENANT, 1_000_000)
        .await
        .expect("eşik yazılır");
    let mutex = tokio::sync::Mutex::new(());
    let lock = lock_for(&mutex).await;

    let issue = ApprovalRequest {
        tenant_id: TENANT.to_string(),
        operation: approval_service::operation::PAYMENT.to_string(),
        resource_id: TRANSACTION.to_string(),
        actor_id: CASHIER.to_string(),
        actor_role: "CASHIER".to_string(),
        amount_cents: 1_500_000,
        approved_percent_hint: 0,
        terminal_id: "terminal_payment".to_string(),
    };
    let verified = approval_service::verify_and_issue(&mut conn, &issue, "3333")
        .await
        .expect("müdür onaylar");

    let onay = consume_total(&mut conn, &lock, 1_500_000, Some(&verified.token), false)
        .await
        .expect("tüketilir")
        .expect("onay döner");
    assert_eq!(onay.operation, approval_service::operation::PAYMENT);
    assert_eq!(onay.approver_id, "usr_manager");
    assert_eq!(onay.amount_cents, 1_500_000);

    // Jeton tek kullanımlıktır: aynı jeton ikinci kez işlemez.
    let tekrar = consume_total(&mut conn, &lock, 1_500_000, Some(&verified.token), false).await;
    assert!(tekrar.is_err(), "jeton ikinci kez kullanılamaz");

    let satir: String = sqlx::query_scalar(
        "SELECT payload FROM audit_ledger WHERE action = 'approval:consumed' ORDER BY sequence DESC",
    )
    .fetch_one(&mut *conn)
    .await
    .expect("kayıt okunur");
    assert!(satir.contains("PAYMENT"), "kayıt yüzeyi PAYMENT olmalı");
}

#[tokio::test]
async fn indirim_onaylandiysa_toplam_onayi_atlanir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    crate::services::security360::threshold::esik_ayarla(&mut conn, TENANT, 1_000_000)
        .await
        .expect("eşik yazılır");
    let mutex = tokio::sync::Mutex::new(());
    let lock = lock_for(&mutex).await;

    // Tek jeton iki işleme bağlanamaz; indirim onayı varsa toplam yüzeyi
    // tekrar onay istemez.
    let sonuc = consume_total(&mut conn, &lock, 5_000_000, None, true)
        .await
        .expect("hata vermemeli");
    assert!(
        sonuc.is_none(),
        "indirim onaylı ödemede ikinci onay istenmez"
    );
}

#[tokio::test]
async fn kiracinin_esigi_baskasini_etkilemez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    crate::services::security360::threshold::esik_ayarla(&mut conn, TENANT, 1_000_000)
        .await
        .expect("eşik yazılır");
    let mutex = tokio::sync::Mutex::new(());
    let lock = lock_for(&mutex).await;

    let sonuc = crate::services::payment_approval::consume_total_approval(
        &mut conn,
        &lock,
        "tenant_b",
        CASHIER,
        "CASHIER",
        TRANSACTION,
        5_000_000,
        None,
        false,
    )
    .await
    .expect("hata vermemeli");
    assert!(
        sonuc.is_none(),
        "başka kiracının eşiği bu işlemi kiralayamaz"
    );
}
