//! Kimlik politikası: parola kuralları ve PIN geçmişi.
//!
//! Neden iki konu bir dosyada: ikisi de "kimlik ne kadar güçlü olabilir"
//! sorusunun parçası ve aynı yazma yollarından (PIN değiştirme, parola
//! sıfırlama) beslenir.
//!
//! Argon2 maliyeti **zayıf parolayı telafi etmez**: pahalı bir hash, kaba
//! kuvvet saldırısını yavaşlatır ama parola `1111` ise tek denemede açılır.
//! Uzunluk ve çeşitlilik kuralları bu yüzden zorunludur.

use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;

/// Parola alt sınırı.
pub const PAROLA_MIN: usize = 10;

/// Parola üst sınırı. Argon2 girdisi beklenmedik büyük olursa bellek
/// tükenebilir; 128 karakter bir insanın akılda tutabileceği sınırdır.
pub const PAROLA_MAX: usize = 128;

/// Hatırlanan son PIN sayısı.
pub const PIN_GECMIS_LIMIT: i64 = 5;

/// Parolayı doğrular.
///
/// Kurallar: 10–128 karakter, en az bir harf ve bir rakam, tekrar eden
/// karakterlerden oluşan dizi (`aaaaaaaaaaaa`) ve kimlikle aynı değer reddedilir.
///
/// Neden kimlikle aynılık: parola `ahmet@ornek.com` ise kimlik bilgisi zaten
/// ekranda görünür demektir; şifrelemek bir güvenlik izlenimi yaratır.
pub fn parola_dogrula(ham: &str, kimlik: Option<&str>) -> Result<(), String> {
    let kirp = ham.trim();

    if kirp.chars().count() < PAROLA_MIN {
        return Err(format!(
            "VALIDATION: Parola en az {PAROLA_MIN} karakter olmalıdır"
        ));
    }
    if kirp.chars().count() > PAROLA_MAX {
        return Err(format!(
            "VALIDATION: Parola en fazla {PAROLA_MAX} karakter olabilir"
        ));
    }
    if !kirp.chars().any(|c| c.is_ascii_alphabetic()) {
        return Err("VALIDATION: Parola en az bir harf içermelidir".to_string());
    }
    if !kirp.chars().any(|c| c.is_ascii_digit()) {
        return Err("VALIDATION: Parola en az bir rakam içermelidir".to_string());
    }

    let tekrar = kirp.chars().all(|c| c == kirp.chars().next().unwrap_or(c));
    if tekrar {
        return Err("VALIDATION: Parola tekrar eden karakterlerden oluşamaz".to_string());
    }

    if let Some(kimlik) = kimlik.map(str::trim).filter(|k| !k.is_empty()) {
        if kirp.eq_ignore_ascii_case(kimlik) {
            return Err("VALIDATION: Parola kullanıcı adınızla aynı olamaz".to_string());
        }
    }

    Ok(())
}

/// PIN bu kullanıcı için daha önce kullanılmış mı?
///
/// Karşılaştırma Argon2 hash'i üzerinden **doğrulanır**, metin karşılaştırması
///yla değil: hash'ler tuzlu olduğu için aynı PIN'in iki hash'i farklıdır.
pub async fn pin_geride_kalmis_mi(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    yeni_pin: &str,
) -> Result<bool, String> {
    let satirlar = sqlx::query(
        "SELECT pin_hash FROM pin_history
          WHERE tenant_id = ? AND user_id = ?
          ORDER BY changed_at DESC, id DESC
          LIMIT ?",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(PIN_GECMIS_LIMIT)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    for satir in satirlar {
        let hash: String = satir.try_get("pin_hash").map_err(|e| e.to_string())?;
        if crate::user_credentials::verify_stored_credential(yeni_pin, &hash) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Yeni PIN'i geçmişe yazar ve eski kayıtları budar.
///
/// **Yan etki:** `pin_history` tablosunu değiştirir. Çağıran PIN yazma
/// transaction'ının içinde olmalıdır; aksi halde geçmiş yazılmadan PIN
/// değişmiş sayılır ve yeniden kullanım engeli bir sonraki değişiklikte
/// ancak işe yarar.
pub async fn pin_gecmise_ekle(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    pin_hash: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pin_history (id, tenant_id, user_id, pin_hash)
         VALUES (?, ?, ?, ?)",
    )
    .bind(generate_id("pnc"))
    .bind(tenant_id)
    .bind(user_id)
    .bind(pin_hash)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Budama: geçmiş sınırsız büyürse tablo zamanla her değişiklikte tüm
    // kayıtları tarar. Yalnız son N kayıt tutulur.
    sqlx::query(
        "DELETE FROM pin_history
          WHERE tenant_id = ? AND user_id = ?
            AND id NOT IN (
                SELECT id FROM pin_history
                 WHERE tenant_id = ? AND user_id = ?
                 ORDER BY changed_at DESC, id DESC
                 LIMIT ?
            )",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(tenant_id)
    .bind(user_id)
    .bind(PIN_GECMIS_LIMIT)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    async fn havuz() -> SqliteConnection {
        let secenek = SqliteConnectOptions::from_str("sqlite::memory:")
            .expect("gecerli secenekler")
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(secenek)
            .await
            .expect("havuz acilir");
        sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("sema uygulanir");
        pool.acquire().await.expect("baglanti").detach()
    }

    // -----------------------------------------------------------------------
    // Parola politikası
    // -----------------------------------------------------------------------

    #[test]
    fn parola_kurallari() {
        // Kabul edilenler.
        assert!(parola_dogrula("Kahve3Duzen", None).is_ok());
        assert!(parola_dogrula("m3307Kahve!y", None).is_ok());

        // Çok kısa.
        assert!(parola_dogrula("Kah3", None).is_err());
        // Rakam yok.
        assert!(parola_dogrula("KahveDuzen", None).is_err());
        // Harf yok.
        assert!(parola_dogrula("33077003300", None).is_err());
        // Tekrar eden karakterler.
        assert!(parola_dogrula("aaaaaaaaaaaa", None).is_err());
        assert!(parola_dogrula("111111111111", None).is_err());
        // Çok uzun: Argon2 girdisi sınırsız büyürse bellek tükenir.
        assert!(parola_dogrula(&"a1".repeat(200), None).is_err());
    }

    #[test]
    fn parola_kimlikle_ayni_olamaz() {
        let kimlik = "ahmet360@ornek.com";
        assert!(parola_dogrula("ahmet360@ornek.com", Some(kimlik)).is_err());
        assert!(parola_dogrula("AHMET360@ORNEK.COM", Some(kimlik)).is_err());
        // Kenar boşluk temizlenir: " ahmet360@ornek.com " de reddedilir.
        assert!(parola_dogrula(" ahmet360@ornek.com ", Some(kimlik)).is_err());
        // Farklı parola sorunsuz.
        assert!(parola_dogrula("Kahve3Duzen", Some(kimlik)).is_ok());
        // Kimlik verilmemişse karşılaştırma yapılmaz.
        assert!(parola_dogrula("ahmet360@ornek.com", None).is_ok());
    }

    #[test]
    fn parola_kenar_bosluk_temizlenir() {
        // "  Kahve3Duzen  " geçerli sayılır: kırpılmış hâli kuralları sağlıyor.
        assert!(parola_dogrula("  Kahve3Duzen  ", None).is_ok());
        // Yalnız boşluktan oluşan ve kırpılınca kısa kalan değer reddedilir.
        assert!(parola_dogrula("   ", None).is_err());
    }

    #[test]
    fn uretilen_parola_politikayi_gecer() {
        // 500 üretim: hepsi kuralları sağlamalı. Üretici harf/rakam dağılımını
        // **garanti ettiği** için bu test kırılgan değil; rastgele seçimle
        // üretilen bir gövdenin rakamsız kalma olasılığı ~1/6000 idi ve
        // `parola_dogrula` çağıranı hata döndürüyordu.
        for _ in 0..500 {
            let parola = super::super::rastgele_parola(20);
            assert_eq!(parola.chars().count(), 20);
            assert!(
                parola_dogrula(&parola, None).is_ok(),
                "uretilen parola politikayi gecmeli: {parola}"
            );
        }
    }

    #[test]
    fn uretilen_parolalar_benzersizdir() {
        let mut hepsi = std::collections::HashSet::new();
        for _ in 0..500 {
            assert!(
                hepsi.insert(super::super::rastgele_parola(20)),
                "parola tekrarlandi"
            );
        }
    }

    #[test]
    fn uretilen_parola_her_zaman_karisim_tasi_r() {
        // Kurallar garanti edilir: ilk üç konum küçük harf, büyük harf, rakam.
        for _ in 0..200 {
            let parola = super::super::rastgele_parola(20);
            assert!(parola.chars().any(|c| c.is_ascii_lowercase()), "{parola}");
            assert!(parola.chars().any(|c| c.is_ascii_uppercase()), "{parola}");
            assert!(parola.chars().any(|c| c.is_ascii_digit()), "{parola}");
        }
    }

    // -----------------------------------------------------------------------
    // PIN geçmişi
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn pin_gecmisi_eskileri_reddeder() {
        let mut conn = havuz().await;
        let (tenant, kullanici) = ("tenant_a", "usr_a");

        assert!(
            !pin_geride_kalmis_mi(&mut conn, tenant, kullanici, "1111")
                .await
                .expect("gecmis okunur"),
            "ilk kullanimda gecmis bos olmali"
        );

        let hash = crate::user_credentials::hash_pin("1111").expect("pin hashlenir");
        pin_gecmise_ekle(&mut conn, tenant, kullanici, &hash)
            .await
            .expect("gecmise yazilir");

        assert!(
            pin_geride_kalmis_mi(&mut conn, tenant, kullanici, "1111")
                .await
                .expect("gecmis okunur"),
            "ayni PIN yeniden kullanilamaz"
        );
        assert!(
            !pin_geride_kalmis_mi(&mut conn, tenant, kullanici, "2222")
                .await
                .expect("gecmis okunur"),
            "farkli PIN kullanilabilir"
        );
    }

    #[tokio::test]
    async fn pin_gecmisi_kiracilar_arası_karismaz() {
        let mut conn = havuz().await;
        let hash = crate::user_credentials::hash_pin("3333").expect("pin hashlenir");

        pin_gecmise_ekle(&mut conn, "tenant_a", "usr_a", &hash)
            .await
            .expect("gecmise yazilir");

        assert!(
            !pin_geride_kalmis_mi(&mut conn, "tenant_b", "usr_a", "3333")
                .await
                .expect("gecmis okunur"),
            "baska kiracinin PIN gecmisi bu kiraciyi etkilememeli"
        );
        assert!(
            !pin_geride_kalmis_mi(&mut conn, "tenant_a", "usr_b", "3333")
                .await
                .expect("gecmis okunur"),
            "baska kullanicinin PIN gecmisi bu kullaniciyi etkilememeli"
        );
    }

    #[tokio::test]
    async fn pin_gecmisi_bes_kayittan_sonra_budenir() {
        let mut conn = havuz().await;
        let (tenant, kullanici) = ("tenant_a", "usr_budeme");

        for n in 1000..1000 + PIN_GECMIS_LIMIT + 3 {
            let hash =
                crate::user_credentials::hash_pin(&format!("{n:04}")).expect("pin hashlenir");
            pin_gecmise_ekle(&mut conn, tenant, kullanici, &hash)
                .await
                .expect("gecmise yazilir");
        }

        let sayi: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pin_history WHERE tenant_id = ? AND user_id = ?",
        )
        .bind(tenant)
        .bind(kullanici)
        .fetch_one(&mut conn)
        .await
        .expect("sayim yapilir");

        assert_eq!(
            sayi, PIN_GECMIS_LIMIT,
            "gecmis sinirli kalmali, aksi halde tablo her degisiklikte tamamen taranir"
        );
    }
}
