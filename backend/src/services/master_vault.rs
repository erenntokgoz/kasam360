//! Master vault (platform kasa) servisi.
//!
//! Neden ayrı servis: vault geçiş kodu hiçbir zaman düz
//! metin olarak depolanmaz veya repo'ya commit edilmez
//! (AGENTS.md §3.1). Geçiş kodu Argon2id hash'i olarak
//! `master_vault` tablosunda durur; doğrulanması bu
//! servis içinde tek yerde yaşar.
//!
//! Fail-closed kuralı: vault henüz yapılandırılmadıysa
//! (hash yoksa) hiçbir geçiş kodu kabul edilmez. Varsayılan
//! bir kod yoktur — "3736" gibi repo'ya gömülmüş kodlar
//! kaldırıldı.

use sqlx::{Row, SqliteConnection};

use crate::user_credentials;

/// Vault tablosunu idempotent kurar.
///
/// Neden `init_db` içinde: tablo `schema.sql` dışındadır
/// çünkü vault yapısı platform seviyesindedir ve kiracı
/// verisi taşımaz; tek satırlık bir singleton tablodur.
pub async fn ensure_table(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS master_vault (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            passcode_hash TEXT NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );",
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Vault geçiş kodunu Argon2id hash'i olarak kaydeder.
///
/// Neden yeniden yapılandırma: eski hash üzerine yazmak,
/// sızdırılan bir kodun geçersiz olmasını sağlar. Kod
/// biçimi kuralı (en az 6 hane) burada tek yerden zorlanır.
pub async fn configure_passcode(
    conn: &mut SqliteConnection,
    new_passcode: &str,
) -> Result<(), String> {
    let kod = new_passcode.trim();
    // Kısa kodlar kaba kuvvete açıktır; vault kodu bir PIN
    // değildir, minimum 6 karakter zorunludur.
    if kod.chars().count() < 6 {
        return Err("VALIDATION: Vault kodu en az 6 karakter olmalıdır.".to_string());
    }
    if !kod.chars().all(|c| c.is_ascii_graphic() || c == ' ') {
        return Err("VALIDATION: Vault kodu kontrol karakterleri içeremez.".to_string());
    }

    // Neden hash_pin değil: vault kodu bir personel PIN'i
    // değildir (4-8 haneli rakam kuralı ona uygulanmaz);
    // yalnızca Argon2id PHC hash'e ihtiyaç duyar.
    let hash = crate::auth::hash_credential(kod)?;
    // Tek satırlık singleton: `id = 1` sabit olup INSERT
    // çakışmasında hash güncellenir (yeniden yapılandırma).
    sqlx::query(
        "INSERT INTO master_vault (id, passcode_hash, updated_at)
         VALUES (1, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             passcode_hash = excluded.passcode_hash,
             updated_at = excluded.updated_at;",
    )
    .bind(&hash)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Vault geçiş kodunu doğrular.
///
/// Neden `Result<bool>`: tablo/hatası (SQL hatası) ile
/// kod eşleşmemesi (yanlış kod) ayrı sonuçlardır. Yanlış
/// kod sessiz `false` döner; depo hatası yukarı taşınır.
pub async fn unlock(conn: &mut SqliteConnection, passcode: &str) -> Result<bool, String> {
    let row = sqlx::query("SELECT passcode_hash FROM master_vault WHERE id = 1")
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        // Vault yapılandırılmadı: hiçbir kod kabul edilmez
        // (fail-closed; varsayılan kod yoktur).
        return Ok(false);
    };
    let hash: String = row.try_get("passcode_hash").map_err(|e| e.to_string())?;
    if !user_credentials::is_argon2_hash(&hash) {
        // Bozuk veya düz metin kayıt: vault açılmaz.
        return Err("SECURITY: vault kaydı bozuk (Argon2 hash bekleniyor).".to_string());
    }
    Ok(user_credentials::verify_stored_credential(passcode, &hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use sqlx::SqlitePool;
    use std::str::FromStr;

    async fn havuz() -> SqlitePool {
        SqlitePool::connect_with(
            SqliteConnectOptions::from_str("sqlite::memory:")
                .unwrap()
                .create_if_missing(true),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn yapilandirilmayan_vault_her_kodu_reddeder() {
        let pool = havuz().await;
        let mut conn = pool.acquire().await.unwrap();
        ensure_table(&mut conn).await.unwrap();
        // Hiçbir kod yoktur; "3736" gibi varsayılanlar kabul edilmez.
        assert!(!unlock(&mut conn, "3736").await.unwrap());
        assert!(!unlock(&mut conn, "000000").await.unwrap());
    }

    #[tokio::test]
    async fn kod_argon2_hash_olarak_durur_düz_metin_yasak() {
        let pool = havuz().await;
        let mut conn = pool.acquire().await.unwrap();
        ensure_table(&mut conn).await.unwrap();

        configure_passcode(&mut conn, "kasam-vault-2026")
            .await
            .unwrap();

        let hash: String =
            sqlx::query_scalar("SELECT passcode_hash FROM master_vault WHERE id = 1")
                .fetch_one(&mut *conn)
                .await
                .unwrap();
        // Depolanan değer düz kod değil, Argon2id PHC hash'idir.
        assert!(user_credentials::is_argon2_hash(&hash), "hash: {hash}");
        assert!(!hash.contains("kasam-vault-2026"));

        assert!(unlock(&mut conn, "kasam-vault-2026").await.unwrap());
        assert!(!unlock(&mut conn, "yanlis-kod").await.unwrap());
    }

    #[tokio::test]
    async fn yeniden_yapilandirma_eski_kodu_gecersiz_kilar() {
        let pool = havuz().await;
        let mut conn = pool.acquire().await.unwrap();
        ensure_table(&mut conn).await.unwrap();

        configure_passcode(&mut conn, "ilk-kod-123").await.unwrap();
        assert!(unlock(&mut conn, "ilk-kod-123").await.unwrap());

        configure_passcode(&mut conn, "yeni-kod-456").await.unwrap();
        // Eski kod artık çalışmaz; yalnızca yeni hash geçerlidir.
        assert!(!unlock(&mut conn, "ilk-kod-123").await.unwrap());
        assert!(unlock(&mut conn, "yeni-kod-456").await.unwrap());
    }

    #[tokio::test]
    async fn kisa_ve_gecersiz_kodlar_reddeder() {
        let pool = havuz().await;
        let mut conn = pool.acquire().await.unwrap();
        ensure_table(&mut conn).await.unwrap();

        // 6 karakter altı kabul edilmez.
        assert!(configure_passcode(&mut conn, "12345").await.is_err());
        // Boş kod kabul edilmez.
        assert!(configure_passcode(&mut conn, "   ").await.is_err());
        // Yapılandırma reddedilince vault kapalı kalır.
        assert!(!unlock(&mut conn, "12345").await.unwrap());
    }

    #[tokio::test]
    async fn tek_satir_singleton_kayit_boyutu_sabit() {
        let pool = havuz().await;
        let mut conn = pool.acquire().await.unwrap();
        ensure_table(&mut conn).await.unwrap();

        configure_passcode(&mut conn, "birinci-kod").await.unwrap();
        configure_passcode(&mut conn, "ikinci-kod").await.unwrap();
        configure_passcode(&mut conn, "ucuncu-kod").await.unwrap();

        let sayi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM master_vault")
            .fetch_one(&mut *conn)
            .await
            .unwrap();
        // Yeniden yapılandırma yeni satır üretmez.
        assert_eq!(sayi, 1);
        assert!(unlock(&mut conn, "ucuncu-kod").await.unwrap());
    }
}
