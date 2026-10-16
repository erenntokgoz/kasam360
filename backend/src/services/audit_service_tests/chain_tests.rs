//! Denetim defteri zincir oluşturma, maskeleme ve hash hesaplama testleri.

use super::common::*;
use crate::services::audit_service::*;
use sqlx::Row;

/// KVKK maskeleme **yazma noktasında** çalışır: diske giden satır maskelenmiş
/// olmalıdır (Kimlik gizleme politikası).
///
/// Saf fonksiyon testi yetmez — maske katmanı `AuditContext::new` içine
/// yerleştirilmiştir ve burada o bağlantı kanıtlanır: ham veri SQLite'a
/// hiç girmiyor.
#[tokio::test]
async fn kisisel_veri_deftere_maskeli_yazilir() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let audit_lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");

    let ctx = AuditContext::new(
        "tenant_a".to_string(),
        "usr_1".to_string(),
        "Owner".to_string(),
        category::GUVENLIK,
        "security:test",
        "res_1".to_string(),
        serde_json::json!({
            "phone": "05321234567",
            "tcNo": "12345678901",
            "email": "ayse@ornek.com",
            "amountCents": 250_050,
            "shiftId": "shf_1",
        }),
        "2026-10-03T10:00:00+00:00".to_string(),
    )
    .expect("geçerli kategori");

    AuditService::append(&mut conn, &audit_lock, &ctx)
        .await
        .expect("kayıt yazılır");

    // Ham veri **hiçbir yerde** bulunmamalı: ne payload'da ne de dosyada.
    let satir: String =
        sqlx::query_scalar("SELECT payload FROM audit_ledger WHERE action = 'security:test'")
            .fetch_one(&mut *conn)
            .await
            .expect("satır okunur");

    assert!(!satir.contains("05321234567"), "telefon sızdı: {satir}");
    assert!(!satir.contains("12345678901"), "TCKN sızdı: {satir}");
    assert!(!satir.contains("ayse@ornek.com"), "e-posta sızdı: {satir}");

    // Finansal kanıt korunmalı: maske katmanı parayı silmemeli.
    assert!(satir.contains("250050"), "tutar kayboldu: {satir}");
    assert!(satir.contains("shf_1"), "vardiya kimliği kayboldu: {satir}");
}

/// Maskeleme hash girdisi **değil**; `payload_json` maskelenmiş haliyle
/// serileştirilir. Bu yüzden zincir doğrulaması bozulmaz.
#[tokio::test]
async fn maskeleme_zinir_dogrulamasini_bozmaz() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let audit_lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");

    for sira in 1..=3 {
        let ctx = AuditContext::new(
            "tenant_a".to_string(),
            format!("usr_{sira}"),
            "Owner".to_string(),
            category::GUVENLIK,
            "security:zincir",
            format!("res_{sira}"),
            serde_json::json!({ "phone": "05321234567", "totalCents": 100 * sira }),
            format!("2026-10-03T10:00:0{sira}+00:00"),
        )
        .expect("geçerli kategori");
        AuditService::append(&mut conn, &audit_lock, &ctx)
            .await
            .expect("kayıt yazılır");
    }

    let sonuc = AuditService::verify_chain(&mut conn)
        .await
        .expect("zincir doğrulanır");
    assert!(sonuc.is_valid, "zincir bozuldu: {:?}", sonuc.failure_reason);
    assert_eq!(sonuc.verified_count, 3);
}

#[test]
fn test_compute_audit_hash() {
    let sequence = 1;
    let timestamp = "2024-01-01T10:00:00Z";
    let actor_id = "test_actor";
    let actor_role = "System";
    let action = "test_action";
    let resource_id = "test_resource";
    let payload_json = "{}";
    let previous_hash = GENESIS_HASH;

    let hash = AuditService::compute_audit_hash(
        sequence,
        timestamp,
        actor_id,
        actor_role,
        action,
        resource_id,
        payload_json,
        previous_hash,
    );

    assert_eq!(hash.len(), 64);
}

/// Kanonik form dondurulmuştur: aynı girdi her zaman aynı hash'i üretir.
#[test]
fn test_compute_audit_hash_karbonik_form_degismez() {
    let first = AuditService::compute_audit_hash(7, "t", "a", "r", "x", "res", "{}", GENESIS_HASH);
    let second = AuditService::compute_audit_hash(7, "t", "a", "r", "x", "res", "{}", GENESIS_HASH);
    assert_eq!(first, second);

    let different =
        AuditService::compute_audit_hash(8, "t", "a", "r", "x", "res", "{}", GENESIS_HASH);
    assert_ne!(first, different);
}

#[test]
fn kategori_listesi_spekteki_sekiz_kategoriyle_sinirli() {
    assert_eq!(category::ALL.len(), 8);
    for value in category::ALL {
        assert!(category::is_valid(value));
    }
    assert!(!category::is_valid("STOK"));
    assert!(!category::is_valid(""));
}

#[tokio::test]
async fn zincir_kayitlari_birbirine_baglanir() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let guard = mutex.lock().await;
    let lock = AuditLock::new(guard);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    AuditService::append(&mut conn, &lock, &context(1))
        .await
        .expect("ilk kayıt eklenir");
    AuditService::append(&mut conn, &lock, &context(2))
        .await
        .expect("ikinci kayıt eklenir");
    AuditService::append(&mut conn, &lock, &context(3))
        .await
        .expect("üçüncü kayıt eklenir");

    let rows = sqlx::query(
        "SELECT sequence, previous_hash, current_hash FROM audit_ledger ORDER BY sequence ASC",
    )
    .fetch_all(&mut *conn)
    .await
    .expect("kayıtlar okunur");
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].get::<String, _>("previous_hash"), GENESIS_HASH);
    assert_eq!(
        rows[1].get::<String, _>("previous_hash"),
        rows[0].get::<String, _>("current_hash")
    );
    assert_eq!(
        rows[2].get::<String, _>("previous_hash"),
        rows[1].get::<String, _>("current_hash")
    );

    drop(lock);
    drop(conn);

    let mut verify_conn = pool.acquire().await.expect("bağlantı alınır");
    let result = AuditService::verify_chain(&mut verify_conn)
        .await
        .expect("zincir doğrulanır");
    assert!(result.is_valid, "bozuk zincir bildirilmemeli");
    assert_eq!(result.verified_count, 3);
}

#[tokio::test]
async fn kayit_tenant_kimligini_tasir() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let guard = mutex.lock().await;
    let lock = AuditLock::new(guard);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    AuditService::append(&mut conn, &lock, &context(1))
        .await
        .expect("kayıt eklenir");

    let tenant: String =
        sqlx::query_scalar("SELECT tenant_id FROM audit_ledger WHERE sequence = 1")
            .fetch_one(&mut *conn)
            .await
            .expect("tenant okunur");
    assert_eq!(tenant, "tenant_a");

    let category_value: String =
        sqlx::query_scalar("SELECT category FROM audit_ledger WHERE sequence = 1")
            .fetch_one(&mut *conn)
            .await
            .expect("kategori okunur");
    assert_eq!(category_value, category::SIPARIS_MASA);
}

#[tokio::test]
async fn bilinmeyen_kategori_yazilamaz() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let guard = mutex.lock().await;
    let lock = AuditLock::new(guard);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let mut ctx = context(1);
    ctx.category = "STOK";
    let result = AuditService::append(&mut conn, &lock, &ctx).await;
    assert!(result.is_err(), "spes dışı kategori kabul edilmemeli");

    let ctx = context(1);
    let result = AuditService::append(&mut conn, &lock, &ctx).await;
    assert!(result.is_ok());
}
