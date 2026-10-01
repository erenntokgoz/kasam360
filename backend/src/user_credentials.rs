//! Personel PIN kimlik bilgileri.
//!
//! PIN'ler düz metin saklanmaz, Argon2id PHC olarak `pin_hash` sütununda tutulur.
//! Bu modül, PIN'in neden veritabanında sorgulanamadığını tek yerde açıklar:
//! hash'ler tuzludur, aynı PIN iki kişide farklı görünür. Dolayısıyla "PIN şu
//! kullanıcıya ait mi" sorusu `WHERE pin = ?` ile değil, aday satırların tek tek
//! doğrulanmasıyla yanıtlanır.
//!
//! `pin_hash` ile `credential_hash` ayrı sütunlardır: kullanıcı hem e-posta/şifreyle
//! hem POS PIN'iyle girebilir. Tek sütun olsaydı biri yazıldığında diğeri ezilirdi.

use sqlx::sqlite::SqliteConnection;
use sqlx::Row;

/// Arayüz PIN uzunluğu: 4-8 hane, yalnızca rakam.
pub const PIN_MIN_LEN: usize = 4;
pub const PIN_MAX_LEN: usize = 8;

/// Argon2id PHC önekleri. Doğrulanmamış hash değerlerini ayırt etmek için kullanılır.
const ARGON2_PREFIXES: [&str; 3] = ["$argon2id$", "$argon2i$", "$argon2d$"];

/// PIN doğrulamasında eşleşen kullanıcı. Düz PIN hiçbir noktada taşınmaz.
pub struct PinMatch {
    pub id: String,
    pub role: String,
    pub name: String,
    pub tenant_id: String,
}

struct CredentialRow {
    id: String,
    role: String,
    name: String,
    tenant_id: String,
    pin_hash: Option<String>,
}

pub fn is_valid_pin_format(pin: &str) -> bool {
    (PIN_MIN_LEN..=PIN_MAX_LEN).contains(&pin.len())
        && pin.chars().all(|character| character.is_ascii_digit())
}

/// PIN'i Argon2id PHC ile hash'ler.
///
/// Format denetimi burada yapılır: her yazma yolu (personel ekleme, PIN değiştirme,
/// işletme kurulumu) aynı kurala uysun, yoksa bir yol sessizce 3 haneli PIN yazar.
pub fn hash_pin(pin: &str) -> Result<String, String> {
    if !is_valid_pin_format(pin) {
        return Err("PIN 4-8 haneli sayısal olmalıdır.".to_string());
    }
    crate::auth::hash_credential(pin)
}

pub fn is_argon2_hash(value: &str) -> bool {
    ARGON2_PREFIXES.iter().any(|prefix| value.starts_with(prefix))
}

/// Saklanan değer gerçekten Argon2 ise doğrular.
///
/// Düz metni veya Argon2 olmayan bir değeri asla eşleşme saymaz. `platform_admins`
/// gibi `users` tablosu dışındaki tablolar da aynı kurala uyar; aksi halde bir
/// tabloda düz metin kalırken diğerinde hash bekleniyormuş gibi görünür.
pub fn verify_stored_credential(secret: &str, stored_hash: &str) -> bool {
    is_argon2_hash(stored_hash) && crate::auth::verify_credential(secret, stored_hash)
}

async fn scan_credentials(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    active_only: bool,
) -> Result<Vec<CredentialRow>, String> {
    // Gerekçe: pasif alınmış personel giriş yapamaz, bu yüzden oturum açma
    // taraması yalnızca aktif kayıtlara bakar. PIN benzersizliği taraması ise
    // pasifleri de kapsar — emekli bir personelin PIN'i başkasına verilmemelidir.
    let mut sql = String::from(
        "SELECT id, role, name, tenant_id, pin_hash FROM users WHERE 1 = 1",
    );
    if active_only {
        sql.push_str(" AND is_active = 1");
    }
    if tenant_id.is_some() {
        sql.push_str(" AND tenant_id = ?");
    }

    let mut query = sqlx::query(&sql);
    if let Some(tenant) = tenant_id {
        query = query.bind(tenant);
    }

    let rows = query.fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| CredentialRow {
            id: row.try_get("id").unwrap_or_default(),
            role: row.try_get("role").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            tenant_id: row.try_get("tenant_id").unwrap_or_default(),
            pin_hash: row.try_get::<Option<String>, _>("pin_hash").ok().flatten(),
        })
        .collect())
}

/// PIN'i tenant içinde arar. Hash'ler karşılaştırılamadığı için her aktif
/// kullanıcının hash'i Argon2 ile sınanır; `tenant_id` verilmişse başka
/// kiracılara düşülmez (cross-tenant fallthrough koruması).
pub async fn find_user_by_pin(
    conn: &mut SqliteConnection,
    pin: &str,
    tenant_id: Option<&str>,
) -> Result<Option<PinMatch>, String> {
    if !is_valid_pin_format(pin) {
        return Ok(None);
    }
    for row in scan_credentials(conn, tenant_id, true).await? {
        if let Some(hash) = row.pin_hash.as_deref() {
            if is_argon2_hash(hash) && crate::auth::verify_credential(pin, hash) {
                return Ok(Some(PinMatch {
                    id: row.id,
                    role: row.role,
                    name: row.name,
                    tenant_id: row.tenant_id,
                }));
            }
        }
    }
    Ok(None)
}

/// Tek bir kullanıcının mevcut PIN'ini doğrular (PIN değiştirme akışı).
pub async fn verify_user_pin(
    conn: &mut SqliteConnection,
    user_id: &str,
    pin: &str,
) -> Result<bool, String> {
    let hash: Option<String> =
        sqlx::query_scalar("SELECT pin_hash FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .flatten();

    match hash.as_deref() {
        Some(hash) if is_argon2_hash(hash) => Ok(crate::auth::verify_credential(pin, hash)),
        // Hash yoksa veya Argon2 değilse kimlik doğrulama başarısızdır: eski düz
        // metin PIN'ler migration'da hash'e çevrilmiştir, buradaki eşleşmesizlik
        // veri bozulması değil yetkisiz erişimdir.
        _ => Ok(false),
    }
}

/// Tenant içinde PIN benzersizliğini **yazmadan önce** denetler.
///
/// Zorunludur: veritabanındaki `UNIQUE(tenant_id, pin)` indeksi hash'lenmiş PIN
/// ile yaşayamaz, çünkü aynı PIN iki kayıtta farklı hash üretir ve indeks asla
/// çakışma yakalayamaz. Benzersizlik bu nedenle uygulama katmanında tutulur.
pub async fn ensure_pin_available(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    pin: &str,
    exclude_user_id: Option<&str>,
) -> Result<(), String> {
    let conflict = scan_credentials(conn, Some(tenant_id), false)
        .await?
        .into_iter()
        .find(|row| {
            Some(row.id.as_str()) != exclude_user_id
                && row
                    .pin_hash
                    .as_deref()
                    .map(|hash| is_argon2_hash(hash) && crate::auth::verify_credential(pin, hash))
                    .unwrap_or(false)
        });

    if conflict.is_some() {
        return Err("Bu PIN zaten kullanılıyor. Lütfen farklı bir PIN belirleyin.".to_string());
    }
    Ok(())
}

/// PIN yazıldıktan **sonra** çalışan yarış denetimi.
///
/// Ön kontrol tek başına yeterli değildir: iki eşzamanlı istek aynı anda boş
/// sonucu alıp ikisi de yazabilir. Yazma, SQLite'ta yazma kilidini alan ilk
/// ifadedir; bu yüzden yazma sonrası taramada başka bir kaydın eşleşmesi görülürse
/// işlem geri alınır. Çağıran, bu kontrolü kendi transaction'ı içinde yapar.
pub async fn ensure_pin_unique_after_write(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    pin: &str,
    self_user_id: &str,
) -> Result<(), String> {
    let conflict = scan_credentials(conn, Some(tenant_id), false)
        .await?
        .into_iter()
        .find(|row| {
            row.id != self_user_id
                && row
                    .pin_hash
                    .as_deref()
                    .map(|hash| is_argon2_hash(hash) && crate::auth::verify_credential(pin, hash))
                    .unwrap_or(false)
        });

    if conflict.is_some() {
        return Err("Bu PIN az önce başka bir personel kaydına verildi.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> sqlx::Pool<sqlx::Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE users (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
                role TEXT NOT NULL,
                name TEXT NOT NULL,
                credential_hash TEXT,
                pin_hash TEXT,
                login_identifier TEXT,
                email TEXT,
                is_active INTEGER NOT NULL DEFAULT 1
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn insert_user(pool: &sqlx::Pool<sqlx::Sqlite>, id: &str, tenant: &str, pin: &str, active: i64) {
        sqlx::query(
            "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active) VALUES (?, ?, 'CASHIER', ?, ?, ?)",
        )
        .bind(id)
        .bind(tenant)
        .bind(id)
        .bind(hash_pin(pin).unwrap())
        .bind(active)
        .execute(pool)
        .await
        .unwrap();
    }

    #[test]
    fn pin_formati_yalnizca_rakom_dort_ile_sekiz_hane_kabul_eder() {
        assert!(is_valid_pin_format("1234"));
        assert!(is_valid_pin_format("12345678"));
        assert!(!is_valid_pin_format("123"));
        assert!(!is_valid_pin_format("123456789"));
        assert!(!is_valid_pin_format("12a4"));
        assert!(!is_valid_pin_format("12 4"));
        assert!(hash_pin("12a4").is_err());
        assert!(hash_pin("123").is_err());
    }

    #[test]
    fn pin_argon2id_ile_hash_lenir_ve_duz_metni_icermez() {
        let hash = hash_pin("4321").unwrap();
        assert!(is_argon2_hash(&hash), "{}", hash);
        assert!(!hash.contains("4321"));
        assert!(crate::auth::verify_credential("4321", &hash));
        assert!(!crate::auth::verify_credential("4322", &hash));
    }

    #[tokio::test]
    async fn ayni_pin_iki_kayit_oldugunda_kullanici_bulunamaz_ve_tekrar_bulunur() {
        let pool = test_pool().await;
        let hash = hash_pin("1111").unwrap();
        // Aynı PIN, iki ayrı tuz ile: veritabanı indeksi bunu yakalayamazdi.
        for id in ["usr_a", "usr_b"] {
            sqlx::query("INSERT INTO users (id, role, name, pin_hash) VALUES (?, 'CASHIER', ?, ?)")
                .bind(id)
                .bind(id)
                .bind(&hash)
                .execute(&pool)
                .await
                .unwrap();
        }
        let mut conn = pool.acquire().await.unwrap();
        assert!(find_user_by_pin(&mut conn, "1111", None).await.unwrap().is_some());
        assert!(find_user_by_pin(&mut conn, "9999", None).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn pasif_personel_giris_yapamaz_ama_pini_rezerve_edilir() {
        let pool = test_pool().await;
        insert_user(&pool, "usr_passive", "tenant-a", "5555", 0).await;
        let mut conn = pool.acquire().await.unwrap();

        assert!(find_user_by_pin(&mut conn, "5555", None).await.unwrap().is_none());
        assert!(verify_user_pin(&mut conn, "usr_passive", "5555").await.unwrap());
        // Pasif personelin PIN'i yeniden verilemez.
        assert!(ensure_pin_available(&mut conn, "tenant-a", "5555", None).await.is_err());
    }

    #[tokio::test]
    async fn baska_tenantin_pini_tenant_kapisi_yuzunden_gormez() {
        let pool = test_pool().await;
        insert_user(&pool, "usr_a", "tenant-a", "7777", 1).await;
        insert_user(&pool, "usr_b", "tenant-b", "7777", 1).await;
        let mut conn = pool.acquire().await.unwrap();

        assert!(find_user_by_pin(&mut conn, "7777", Some("tenant-a")).await.unwrap().is_some());
        assert_eq!(
            find_user_by_pin(&mut conn, "7777", Some("tenant-a")).await.unwrap().unwrap().id,
            "usr_a"
        );
        // tenant-c'de 7777 yok: başka kiracıya düşülmez.
        assert!(find_user_by_pin(&mut conn, "7777", Some("tenant-c")).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn ayni_tenantta_paylasilan_pin_reddedilir_kendisi_haric() {
        let pool = test_pool().await;
        insert_user(&pool, "usr_a", "tenant-a", "1234", 1).await;
        insert_user(&pool, "usr_b", "tenant-a", "5678", 1).await;
        let mut conn = pool.acquire().await.unwrap();

        assert!(ensure_pin_available(&mut conn, "tenant-a", "1234", None).await.is_err());
        assert!(ensure_pin_available(&mut conn, "tenant-a", "5678", None).await.is_err());
        assert!(ensure_pin_available(&mut conn, "tenant-a", "2468", None).await.is_ok());
        // Kullanıcı kendi PIN'ini değiştirirken muaf tutulur.
        assert!(ensure_pin_available(&mut conn, "tenant-a", "1234", Some("usr_a")).await.is_ok());
    }

    #[tokio::test]
    async fn baska_tenantta_ayni_pin_kullanilabilir() {
        let pool = test_pool().await;
        insert_user(&pool, "usr_a", "tenant-a", "1234", 1).await;
        let mut conn = pool.acquire().await.unwrap();
        assert!(ensure_pin_available(&mut conn, "tenant-b", "1234", None).await.is_ok());
    }

    #[tokio::test]
    async fn yarisa_karsi_yazma_sonrasi_denetim_yeni_kaydi_engeller() {
        let pool = test_pool().await;

        // 1. Ön kontrol: henüz kimse bu PIN'i kullanmıyor, geçer.
        //    (Havuz tek bağlantılı olduğu için her adımda bağlantı bırakılır.)
        {
            let mut conn = pool.acquire().await.unwrap();
            assert!(ensure_pin_available(&mut conn, "tenant-a", "2468", None).await.is_ok());
        }

        // 2. Eşzamanlı istek, bizim yazmamızdan hemen önce aynı PIN'i kaydeder.
        insert_user(&pool, "usr_race", "tenant-a", "2468", 1).await;

        // 3. Bizim yazmamız da sıraya girer.
        sqlx::query("INSERT INTO users (id, tenant_id, role, name, pin_hash) VALUES ('usr_late', 'tenant-a', 'CASHIER', 'Geç', ?)")
            .bind(hash_pin("2468").unwrap())
            .execute(&pool)
            .await
            .unwrap();

        // 4. Artık iki kayıt da aynı PIN'i tutuyor: hangisi son yazan olursa olsun
        //    denetim çakışmayı görmeli ve çağıran işlemi geri almalı.
        {
            let mut conn = pool.acquire().await.unwrap();
            assert!(ensure_pin_unique_after_write(&mut conn, "tenant-a", "2468", "usr_late")
                .await
                .is_err());
            assert!(ensure_pin_unique_after_write(&mut conn, "tenant-a", "2468", "usr_race")
                .await
                .is_err());
        }
    }

    #[tokio::test]
    async fn yazma_sonrasi_denetim_kayit_tek_ise_gecer() {
        let pool = test_pool().await;
        insert_user(&pool, "usr_only", "tenant-a", "1357", 1).await;
        let mut conn = pool.acquire().await.unwrap();

        // Kendi kaydı sayılmaz; başka eşleşme yoktur.
        assert!(ensure_pin_unique_after_write(&mut conn, "tenant-a", "1357", "usr_only")
            .await
            .is_ok());
        // Hiçbir kayıt bu PIN'i tutmuyorsa da geçerlidir.
        assert!(ensure_pin_unique_after_write(&mut conn, "tenant-a", "9753", "usr_only")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn argon2_olmayan_hash_giris_sayilmaz() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO users (id, role, name, pin_hash) VALUES ('usr_legacy', 'CASHIER', 'Eski', '4444')")
            .execute(&pool)
            .await
            .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        assert!(find_user_by_pin(&mut conn, "4444", None).await.unwrap().is_none());
        assert!(!verify_user_pin(&mut conn, "usr_legacy", "4444").await.unwrap());
    }
}
