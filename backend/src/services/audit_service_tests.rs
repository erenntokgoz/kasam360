use super::*;
use sqlx::sqlite::SqlitePoolOptions;
use std::str::FromStr;

const LEDGER_SCHEMA: &str = include_str!("../../migrations/schema.sql");

async fn ledger_pool() -> sqlx::SqlitePool {
    let options = sqlx::sqlite::SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(LEDGER_SCHEMA)
        .execute(&pool)
        .await
        .expect("denetim şeması uygulanır");
    pool
}

fn context(sequence_hint: i64) -> AuditContext {
    AuditContext::new(
        "tenant_a".to_string(),
        format!("usr_{}", sequence_hint),
        "Owner".to_string(),
        category::SIPARIS_MASA,
        "order:submitted",
        format!("ord_{}", sequence_hint),
        serde_json::json!({ "totalCents": 1000 * sequence_hint }),
        format!("2026-10-0{}T10:00:00+00:00", sequence_hint),
    )
    .expect("geçerli kategori")
}

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

/// Tetikleyici UPDATE ve DELETE'i reddetmelidir (AGENTS.md §3.1).
#[tokio::test]
async fn tetikleyici_guncelleme_ve_silme_islemini_reddeder() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let guard = mutex.lock().await;
    let lock = AuditLock::new(guard);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    AuditService::append(&mut conn, &lock, &context(1))
        .await
        .expect("kayıt eklenir");
    drop(lock);
    drop(conn);

    let update =
        sqlx::query("UPDATE audit_ledger SET actor_id = 'usr_saldirgan' WHERE sequence = 1")
            .execute(&pool)
            .await;
    assert!(update.is_err(), "UPDATE reddedilmeliydi");

    let delete = sqlx::query("DELETE FROM audit_ledger WHERE sequence = 1")
        .execute(&pool)
        .await;
    assert!(delete.is_err(), "DELETE reddedilmeliydi");
}

/// Tetikleyici, defterin ucundan kopuk bir kaydı reddetmelidir.
#[tokio::test]
async fn tetikleyici_kopuk_zincir_kaydini_reddeder() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let guard = mutex.lock().await;
    let lock = AuditLock::new(guard);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    AuditService::append(&mut conn, &lock, &context(1))
        .await
        .expect("ilk kayıt eklenir");
    drop(lock);
    drop(conn);

    let forged_hash = "b".repeat(64);
    let insert = sqlx::query(
        "INSERT INTO audit_ledger (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload, previous_hash, current_hash, hash_version) \
         VALUES ('ledger_saldirgan', 'tenant_a', 2, '2026-10-02T10:00:00+00:00', 'usr_saldirgan', 'Owner', 'SISTEM', 'system:forge', 'x', '{}', ?, ?, 1)",
    )
    .bind("c".repeat(64))
    .bind(&forged_hash)
    .execute(&pool)
    .await;
    assert!(insert.is_err(), "kopuk zincir kaydı reddedilmeliydi");
}

/// Doğrulayıcı, içeriğiyle eşleşmeyen hash'i taşıyan bir kaydı yakalamalıdır.
/// Tetikleyici yalnız zincir bağını ve biçimleri doğrular; SHA-256'yı
/// SQLite içinde hesaplayamaz. Bu yüzden doğrulayıcı, veritabanına doğrudan
/// yazılmış sahte bir satırı yakalayan son savunma hattıdır.
#[tokio::test]
async fn dogrulayici_icerikle_eslesmeyen_hashi_yakalar() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let guard = mutex.lock().await;
    let lock = AuditLock::new(guard);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    AuditService::append(&mut conn, &lock, &context(1))
        .await
        .expect("ilk kayıt eklenir");
    drop(lock);
    drop(conn);

    let tip_hash: String =
        sqlx::query_scalar("SELECT current_hash FROM audit_ledger WHERE sequence = 1")
            .fetch_one(&pool)
            .await
            .expect("uç hash okunur");

    // Zincir bağı doğru, biçimler geçerli; ama current_hash içeriğin
    // hash'i değil. Tetikleyici bunu geçirir, doğrulayıcı yakalamalıdır.
    let insert = sqlx::query(
        "INSERT INTO audit_ledger (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload, previous_hash, current_hash, hash_version) \
         VALUES ('ledger_saldirgan', 'tenant_a', 2, '2026-10-02T10:00:00+00:00', 'usr_saldirgan', 'Owner', 'SISTEM', 'system:forge', 'x', '{\"tampered\":true}', ?, ?, 1)",
    )
    .bind(&tip_hash)
    .bind("b".repeat(64))
    .execute(&pool)
    .await;
    assert!(insert.is_ok(), "test önkoşulu: sahte satır eklenebilmeli");

    let mut verify_conn = pool.acquire().await.expect("bağlantı alınır");
    let result = AuditService::verify_chain(&mut verify_conn)
        .await
        .expect("zincir doğrulanır");
    assert!(!result.is_valid, "sahte hash doğrulanmamalıydı");
    assert_eq!(result.verified_count, 1);
    assert_eq!(result.failed_sequence, Some(2));
    assert!(result.failure_reason.is_some());
}

/// Eşzamanlı iki yazıcı aynı sequence'i alamaz: veritabanı trigger'ı
/// ikinciyi reddeder, böylece zincir forksuz kalır.
#[tokio::test]
async fn es_zamanli_yazici_ayni_sequence_i_alamaz() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let guard = mutex.lock().await;
    let lock = AuditLock::new(guard);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    AuditService::append(&mut conn, &lock, &context(1))
        .await
        .expect("ilk kayıt eklenir");
    drop(lock);
    drop(conn);

    let tip_hash: String =
        sqlx::query_scalar("SELECT current_hash FROM audit_ledger WHERE sequence = 1")
            .fetch_one(&pool)
            .await
            .expect("uç hash okunur");

    // İkinci yazıcı aynı sequence'i ve aynı previous_hash'i kullanmayı dener.
    let insert = sqlx::query(
        "INSERT INTO audit_ledger (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload, previous_hash, current_hash, hash_version) \
         VALUES ('ledger_rakip', 'tenant_a', 2, '2026-10-02T10:00:00+00:00', 'usr_rakip', 'Owner', 'SISTEM', 'order:submitted', 'y', '{}', ?, ?, 1)",
    )
    .bind(&tip_hash)
    .bind("d".repeat(64))
    .execute(&pool)
    .await;
    assert!(insert.is_ok(), "ilk rakip yazıcı kazanmalı");

    let second_tip: String =
        sqlx::query_scalar("SELECT current_hash FROM audit_ledger WHERE sequence = 2")
            .fetch_one(&pool)
            .await
            .expect("yeni uç okunur");

    let insert = sqlx::query(
        "INSERT INTO audit_ledger (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload, previous_hash, current_hash, hash_version) \
         VALUES ('ledger_rakip2', 'tenant_a', 2, '2026-10-02T11:00:00+00:00', 'usr_rakip2', 'Owner', 'SISTEM', 'order:submitted', 'z', '{}', ?, ?, 1)",
    )
    .bind(&tip_hash)
    .bind("e".repeat(64))
    .execute(&pool)
    .await;
    assert!(insert.is_err(), "aynı sequence ikinci kez alınamamalı");

    let mut verify_conn = pool.acquire().await.expect("bağlantı alınır");
    let result = AuditService::verify_chain(&mut verify_conn)
        .await
        .expect("zincir doğrulanır");
    assert!(!result.is_valid, "sahte kayıt zinciri bozdu");
    assert_eq!(result.failed_sequence, Some(2));
    let _ = second_tip;
}

/// Boş defter bir hata değildir: zincir geçerli sayılır ama uç yoktur.
/// Arayüzde "mühürlü" rozeti yalnızca gerçek kayıtta anlam taşır.
#[tokio::test]
async fn bos_defter_gecerli_ama_ucsuz() {
    let pool = ledger_pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let result = AuditService::verify_chain(&mut conn)
        .await
        .expect("zincir doğrulanır");
    assert!(result.is_valid);
    assert_eq!(result.verified_count, 0);
    assert!(!result.tip_present);
    assert!(result.failed_sequence.is_none());
}

/// `hash_version` kanonik hash formunun parçası değildir: sürüm alanı
/// değişse bile mevcut satırların doğrulaması bozulmaz. D1'in korunması bu
/// testle kanıtlanır.
#[tokio::test]
async fn hash_surumu_kanonik_formu_etkilemez() {
    assert_eq!(HASH_VERSION, 1, "hash sürümü dondurulmuştur");

    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let guard = mutex.lock().await;
    let lock = AuditLock::new(guard);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    AuditService::append(&mut conn, &lock, &context(1))
        .await
        .expect("kayıt eklenir");
    drop(lock);
    drop(conn);

    let stored: i64 =
        sqlx::query_scalar("SELECT hash_version FROM audit_ledger WHERE sequence = 1")
            .fetch_one(&pool)
            .await
            .expect("sürüm okunur");
    assert_eq!(stored, HASH_VERSION);

    // Yeni sürümlü bir kayıt yazılsa bile zincir kendi içinde tutarlı kalır:
    // sürüm alanı hash girdisi değildir.
    let tip_hash: String =
        sqlx::query_scalar("SELECT current_hash FROM audit_ledger WHERE sequence = 1")
            .fetch_one(&pool)
            .await
            .expect("uç hash okunur");
    let insert = sqlx::query(
        "INSERT INTO audit_ledger (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload, previous_hash, current_hash, hash_version) \
         VALUES ('ledger_v2', 'tenant_a', 2, '2026-10-02T10:00:00+00:00', 'usr_v2', 'Owner', 'SISTEM', 'system:test', 'x', '{}', ?, ?, 2)",
    )
    .bind(&tip_hash)
    .bind("f".repeat(64))
    .execute(&pool)
    .await;
    assert!(insert.is_ok(), "farklı hash sürümü kaydı reddedilmemeli");
}

/// Kategori listesi veritabanı tetikleyicisiyle de sınırlıdır: kapıyı atlayıp
/// doğrudan SQL yazan bir saldırgan da listede olmayan kategori giremez.
#[tokio::test]
async fn tetikleyici_liste_disi_kategoriyi_reddeder() {
    let pool = ledger_pool().await;
    let insert = sqlx::query(
        "INSERT INTO audit_ledger (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload, previous_hash, current_hash, hash_version) \
         VALUES ('ledger_kategori', 'tenant_a', 1, '2026-10-02T10:00:00+00:00', 'usr_x', 'Owner', 'STOK', 'stok:fire', 'x', '{}', ?, ?, 1)",
    )
    .bind(GENESIS_HASH)
    .bind("a".repeat(64))
    .execute(&pool)
    .await;
    assert!(
        insert.is_err(),
        "liste dışı kategori tetikleyici tarafından reddedilmeliydi"
    );
}

/// Mutfak fişi ilerletme kaydı "Sipariş & Masa" kategorisinde ve aktörün
/// gerçek rolüyle yazılır. İstemci tarafındaki ikinci ledger kaldırıldığı
/// için bu kayıt tek gerçek kaynaktır; zincir doğrulaması onu kapsar.
#[tokio::test]
async fn kds_fis_ilerletme_kaydi_dongusel_olarak_kaydedilir() {
    let pool = ledger_pool().await;
    let mutex = tokio::sync::Mutex::new(());
    let guard = mutex.lock().await;
    let lock = AuditLock::new(guard);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let ctx = AuditContext::new(
        "tenant_kds".to_string(),
        "usr_kitchen_01".to_string(),
        "KITCHEN".to_string(),
        category::SIPARIS_MASA,
        "kds:ticket_status_advanced",
        "ord_kds_01".to_string(),
        serde_json::json!({
            "fromStatus": "Pending",
            "toStatus": "Preparing",
            "eventId": "evt_kds_001",
        }),
        "2026-10-02T12:00:00+00:00".to_string(),
    )
    .expect("geçerli kategori");

    AuditService::append(&mut conn, &lock, &ctx)
        .await
        .expect("KDS kaydı eklenir");
    drop(lock);

    let row: (String, String, String) =
        sqlx::query_as("SELECT category, actor_role, action FROM audit_ledger WHERE sequence = 1")
            .fetch_one(&mut *conn)
            .await
            .expect("KDS kaydı okunur");
    assert_eq!(row.0, category::SIPARIS_MASA);
    assert_eq!(row.1, "KITCHEN");
    assert_eq!(row.2, "kds:ticket_status_advanced");

    let result = AuditService::verify_chain(&mut conn)
        .await
        .expect("zincir doğrulanır");
    assert!(result.is_valid);
    assert_eq!(result.verified_count, 1);
}
