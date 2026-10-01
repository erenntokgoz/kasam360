use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Dondurulmuş kanonik hash formu. `compute_audit_hash` girdisinin biçimi
/// değiştirilirse veritabanındaki mevcut satırların tamamı doğrulanamaz hale
/// gelir; bu yüzden sürüm 1'dir ve değiştirilmez. Yeni alanlar (kategori,
/// metadata) hash'in dışında tutulur.
pub const HASH_VERSION: i64 = 1;

/// Zincir doğrulaması tek seferde tüm tabloyu belleğe almaz; `sequence`
/// ilerlemesiyle toplu halde okur.
const VERIFY_BATCH_SIZE: i64 = 500;

/// Spec'te tanımlanan 8 ana denetim kategorisi. Liste kapalıdır: veritabanı
/// trigger'ı da aynı listeyi zorlar, yeni kategori icat edilmez.
pub mod category {
    pub const SIPARIS_MASA: &str = "SIPARIS_MASA";
    pub const ODEME: &str = "ODEME";
    pub const FINANS: &str = "FINANS";
    pub const PERSONEL: &str = "PERSONEL";
    pub const MENU: &str = "MENU";
    pub const YETKI: &str = "YETKI";
    pub const SISTEM: &str = "SISTEM";
    pub const GUVENLIK: &str = "GUVENLIK";

    pub const ALL: [&str; 8] = [
        SIPARIS_MASA, ODEME, FINANS, PERSONEL, MENU, YETKI, SISTEM, GUVENLIK,
    ];

    pub fn is_valid(value: &str) -> bool {
        ALL.contains(&value)
    }
}

/// Denetim defteri yazma izni. `append` bu belirteci zorunlu ister; kilidi
/// almayan bir yazma yolu derleme zamanında imkânsız hale gelir.
pub struct AuditLock<'a> {
    _guard: tokio::sync::MutexGuard<'a, ()>,
}

impl<'a> AuditLock<'a> {
    pub fn new(guard: tokio::sync::MutexGuard<'a, ()>) -> Self {
        Self { _guard: guard }
    }
}

/// Tek bir denetim kaydının bağlamı.
pub struct AuditContext {
    pub tenant_id: String,
    pub actor_id: String,
    pub actor_role: String,
    pub category: &'static str,
    pub action: String,
    pub resource_id: String,
    pub payload: serde_json::Value,
    pub now_iso: String,
}

impl AuditContext {
    pub fn new(
        tenant_id: String,
        actor_id: String,
        actor_role: String,
        category: &'static str,
        action: impl Into<String>,
        resource_id: String,
        payload: serde_json::Value,
        now_iso: String,
    ) -> Result<Self, String> {
        if !category::is_valid(category) {
            return Err(format!("UNKNOWN_AUDIT_CATEGORY: '{}'", category));
        }
        Ok(Self {
            tenant_id,
            actor_id,
            actor_role,
            category,
            action: action.into(),
            resource_id,
            payload,
            now_iso,
        })
    }
}

/// Zincir doğrulama sonucu. Ham hash hiçbir zaman burada dönmez.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainVerification {
    pub is_valid: bool,
    pub verified_count: i64,
    pub failed_sequence: Option<i64>,
    pub failure_reason: Option<String>,
    pub tip_present: bool,
}

pub struct AuditService;

impl AuditService {
    pub fn compute_audit_hash(
        sequence: i64,
        timestamp: &str,
        actor_id: &str,
        actor_role: &str,
        action: &str,
        resource_id: &str,
        payload_json: &str,
        previous_hash: &str,
    ) -> String {
        let canonical = format!(
            "{}:{}:{}:{}:{}:{}:{}:{}",
            sequence, timestamp, actor_id, actor_role, action, resource_id, payload_json, previous_hash
        );
        let mut hasher = Sha256::new();
        hasher.update(canonical.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Denetim defterine tek satır ekler. Zincirin uç noktası okunup yazılana
    /// kadar `audit_mutex` tutulur; iki eşzamanlı yazıcı aynı `sequence`'i
    /// alamaz.
    ///
    /// Çağıran transaction kullanıyorsa `&mut *tx` ile bağlantıyı verir: SQLite
    /// transaction'ı bağlantı kapsamlıdır, bu yüzden kayıt iş kuralıyla aynı
    /// atomik blokta yazılır.
    pub async fn append(
        conn: &mut sqlx::SqliteConnection,
        _lock: &AuditLock<'_>,
        ctx: &AuditContext,
    ) -> Result<String, String> {
        if !category::is_valid(ctx.category) {
            return Err(format!("UNKNOWN_AUDIT_CATEGORY: '{}'", ctx.category));
        }

        let latest_row = sqlx::query(
            "SELECT sequence, current_hash FROM audit_ledger ORDER BY sequence DESC LIMIT 1",
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let (next_seq, prev_hash) = match latest_row {
            Some(row) => {
                let seq: i64 = row.get("sequence");
                let hash: String = row.get("current_hash");
                (seq + 1, hash)
            }
            None => (1, GENESIS_HASH.to_string()),
        };

        let payload_json =
            serde_json::to_string(&ctx.payload).map_err(|e| e.to_string())?;

        let current_hash = Self::compute_audit_hash(
            next_seq,
            &ctx.now_iso,
            &ctx.actor_id,
            &ctx.actor_role,
            &ctx.action,
            &ctx.resource_id,
            &payload_json,
            &prev_hash,
        );

        let entry_id = format!("ledger_{}", Uuid::new_v4());

        sqlx::query(
            "INSERT INTO audit_ledger \
             (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, action, \
              resource_id, payload, previous_hash, current_hash, hash_version, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&entry_id)
        .bind(&ctx.tenant_id)
        .bind(next_seq)
        .bind(&ctx.now_iso)
        .bind(&ctx.actor_id)
        .bind(&ctx.actor_role)
        .bind(ctx.category)
        .bind(&ctx.action)
        .bind(&ctx.resource_id)
        .bind(&payload_json)
        .bind(&prev_hash)
        .bind(&current_hash)
        .bind(HASH_VERSION)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(entry_id)
    }

    /// Tüm zinciri doğrular. Sadece `sequence` ilerlemesiyle toplu okuma yapar,
    /// böylece defter ne kadar büyük olursa olsun bellek sabit kalır.
    pub async fn verify_chain(conn: &mut sqlx::SqliteConnection) -> Result<ChainVerification, String> {
        let mut previous = GENESIS_HASH.to_string();
        let mut cursor: i64 = 0;
        let mut verified_count: i64 = 0;
        let mut tip_present = false;

        loop {
            let rows = sqlx::query(
                "SELECT sequence, timestamp, actor_id, actor_role, action, resource_id, payload, previous_hash, current_hash \
                 FROM audit_ledger WHERE sequence > ? ORDER BY sequence ASC LIMIT ?",
            )
            .bind(cursor)
            .bind(VERIFY_BATCH_SIZE)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

            if rows.is_empty() {
                break;
            }

            for row in &rows {
                let sequence: i64 = row.get("sequence");
                let timestamp: String = row.get("timestamp");
                let actor_id: String = row.get("actor_id");
                let actor_role: String = row.get("actor_role");
                let action: String = row.get("action");
                let resource_id: String = row.get("resource_id");
                let payload: String = row.get("payload");
                let stored_previous: String = row.get("previous_hash");
                let stored_hash: String = row.get("current_hash");

                let expected = Self::compute_audit_hash(
                    sequence,
                    &timestamp,
                    &actor_id,
                    &actor_role,
                    &action,
                    &resource_id,
                    &payload,
                    &previous,
                );

                if stored_previous != previous {
                    return Ok(ChainVerification {
                        is_valid: false,
                        verified_count,
                        failed_sequence: Some(sequence),
                        failure_reason: Some(
                            "previous_hash, bir önceki kaydın hash'iyle eşleşmiyor.".to_string(),
                        ),
                        tip_present,
                    });
                }
                if stored_hash != expected {
                    return Ok(ChainVerification {
                        is_valid: false,
                        verified_count,
                        failed_sequence: Some(sequence),
                        failure_reason: Some(
                            "current_hash, kaydın içeriğinden yeniden hesaplanan hash ile eşleşmiyor."
                                .to_string(),
                        ),
                        tip_present,
                    });
                }

                previous = stored_hash;
                cursor = sequence;
                verified_count += 1;
                tip_present = true;
            }

            if rows.len() < VERIFY_BATCH_SIZE as usize {
                break;
            }
        }

        Ok(ChainVerification {
            is_valid: true,
            verified_count,
            failed_sequence: None,
            failure_reason: None,
            tip_present,
        })
    }
}

#[cfg(test)]
mod tests {
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
            sequence, timestamp, actor_id, actor_role, action, resource_id, payload_json, previous_hash,
        );

        assert_eq!(hash.len(), 64);
    }

    /// Kanonik form dondurulmuştur: aynı girdi her zaman aynı hash'i üretir.
    #[test]
    fn test_compute_audit_hash_karbonik_form_degismez() {
        let first = AuditService::compute_audit_hash(7, "t", "a", "r", "x", "res", "{}", GENESIS_HASH);
        let second = AuditService::compute_audit_hash(7, "t", "a", "r", "x", "res", "{}", GENESIS_HASH);
        assert_eq!(first, second);

        let different = AuditService::compute_audit_hash(8, "t", "a", "r", "x", "res", "{}", GENESIS_HASH);
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

        AuditService::append(&mut *conn, &lock, &context(1))
            .await
            .expect("ilk kayıt eklenir");
        AuditService::append(&mut *conn, &lock, &context(2))
            .await
            .expect("ikinci kayıt eklenir");
        AuditService::append(&mut *conn, &lock, &context(3))
            .await
            .expect("üçüncü kayıt eklenir");

        let rows = sqlx::query("SELECT sequence, previous_hash, current_hash FROM audit_ledger ORDER BY sequence ASC")
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

        AuditService::append(&mut *conn, &lock, &context(1))
            .await
            .expect("kayıt eklenir");

        let tenant: String = sqlx::query_scalar("SELECT tenant_id FROM audit_ledger WHERE sequence = 1")
            .fetch_one(&mut *conn)
            .await
            .expect("tenant okunur");
        assert_eq!(tenant, "tenant_a");

        let category_value: String = sqlx::query_scalar("SELECT category FROM audit_ledger WHERE sequence = 1")
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
        let result = AuditService::append(&mut *conn, &lock, &ctx).await;
        assert!(result.is_err(), "spes dışı kategori kabul edilmemeli");

        let ctx = context(1);
        let result = AuditService::append(&mut *conn, &lock, &ctx).await;
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
        AuditService::append(&mut *conn, &lock, &context(1))
            .await
            .expect("kayıt eklenir");
        drop(lock);
        drop(conn);

        let update = sqlx::query("UPDATE audit_ledger SET actor_id = 'usr_saldirgan' WHERE sequence = 1")
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
        AuditService::append(&mut *conn, &lock, &context(1))
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
        AuditService::append(&mut *conn, &lock, &context(1))
            .await
            .expect("ilk kayıt eklenir");
        drop(lock);
        drop(conn);

        let tip_hash: String = sqlx::query_scalar("SELECT current_hash FROM audit_ledger WHERE sequence = 1")
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
        AuditService::append(&mut *conn, &lock, &context(1))
            .await
            .expect("ilk kayıt eklenir");
        drop(lock);
        drop(conn);

        let tip_hash: String = sqlx::query_scalar("SELECT current_hash FROM audit_ledger WHERE sequence = 1")
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

        let second_tip: String = sqlx::query_scalar("SELECT current_hash FROM audit_ledger WHERE sequence = 2")
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
        AuditService::append(&mut *conn, &lock, &context(1))
            .await
            .expect("kayıt eklenir");
        drop(lock);
        drop(conn);

        let stored: i64 = sqlx::query_scalar("SELECT hash_version FROM audit_ledger WHERE sequence = 1")
            .fetch_one(&pool)
            .await
            .expect("sürüm okunur");
        assert_eq!(stored, HASH_VERSION);

        // Yeni sürümlü bir kayıt yazılsa bile zincir kendi içinde tutarlı kalır:
        // sürüm alanı hash girdisi değildir.
        let tip_hash: String = sqlx::query_scalar("SELECT current_hash FROM audit_ledger WHERE sequence = 1")
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
        assert!(insert.is_err(), "liste dışı kategori tetikleyici tarafından reddedilmeliydi");
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

        AuditService::append(&mut *conn, &lock, &ctx)
            .await
            .expect("KDS kaydı eklenir");
        drop(lock);

        let row: (String, String, String) = sqlx::query_as(
            "SELECT category, actor_role, action FROM audit_ledger WHERE sequence = 1",
        )
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
}
