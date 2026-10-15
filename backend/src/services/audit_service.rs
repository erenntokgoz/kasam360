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
        SIPARIS_MASA,
        ODEME,
        FINANS,
        PERSONEL,
        MENU,
        YETKI,
        SISTEM,
        GUVENLIK,
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
    // Neden `allow`: kanonik girdi sırası hash zincirinin parçasıdır
    // (`canonical_fields`). Argümanları gruplayan bir yapıya geçmek, çağıran
    // yüzlerce satırda aynı sırayı korumak zorunda kalır ve hash ile girdi
    // arasındaki karşılığı gözle doğrulanamaz hale getirir. Sıra, tek doğruluk
    // noktası olan `canonical_fields` yordamında durur.
    #[allow(clippy::too_many_arguments)]
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
        // Maskeleme **yazma noktasında** yapılır (Kimlik gizleme politikası). Arayüzde
        // maskelemek işe yaramaz: veri o arada diske yazılmış olur ve sonradan
        // gizlemek kaydı geri döndürülemez hale getirmez. `new` tek yazma
        // noktası olduğu için buraya yerleştirmek yeterlidir.
        //
        // Önemli: maskeleme hash girdisi **değil**, `payload_json`; yani
        // `compute_audit_hash` aynı kanonik formu alır ve zincir bozulmaz.
        let mut payload = payload;
        crate::services::security360::mask::maskele(&mut payload);
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
    // Neden `allow`: parametre sırası hash'in girdisidir (`AGENTS.md §2`).
    // Sırayı bir yapıyla gizlemek, "hangi alan hangi sırayla giriyor"
    // sorusunu yanıtlanamaz hale getirir; kırılan tüm zincirler aynı yerde
    // doğrulanamaz hale gelir.
    #[allow(clippy::too_many_arguments)]
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
            sequence,
            timestamp,
            actor_id,
            actor_role,
            action,
            resource_id,
            payload_json,
            previous_hash
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

        let payload_json = serde_json::to_string(&ctx.payload).map_err(|e| e.to_string())?;

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
    pub async fn verify_chain(
        conn: &mut sqlx::SqliteConnection,
    ) -> Result<ChainVerification, String> {
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
#[path = "audit_service_tests.rs"]
mod tests;
