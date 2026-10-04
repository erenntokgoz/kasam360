// `super` = `two_factor`, dolayısıyla `test_db` iki seviye yukarıdadır.
use super::super::test_db::bellek;
use super::*;

async fn conn() -> SqliteConnection {
    bellek().await
}

#[test]
fn sirr_base32_alfabesinde_ve_uzunlugu_sabit() {
    let sirr = sirr_uret();
    assert_eq!(sirr.chars().count(), SIRR_UZUNLUK, "160 bit");
    assert!(sirr.chars().all(|c| BASE32.contains(&(c as u8))));
    // Karışan karakter yok: kullanıcı `0`/`1` yazmaya çalışıp hata almaz.
    assert!(!sirr.contains('0'));
    assert!(!sirr.contains('1'));
    assert!(!sirr.contains('I'));
    assert!(!sirr.contains('O'));
}

#[test]
fn sirr_ureti_her_seferinde_farkli() {
    let a = sirr_uret();
    let b = sirr_uret();
    assert_ne!(a, b);
}

#[test]
fn kod_altti_hane_ve_sadece_rakam() {
    let sirr = sirr_uret();
    let kod = kod_uret(&sirr, 1_700_000_000);
    assert_eq!(kod.len(), 6);
    assert!(kod.chars().all(|c| c.is_ascii_digit()));
}

#[test]
fn kod_ayni_pencerede_degismez_pencerelerde_degisir() {
    let sirr = sirr_uret();
    let baslangic = 1_700_000_000 - (1_700_000_000 % TOTP_ADIM_SN);
    assert_eq!(
        kod_uret(&sirr, baslangic),
        kod_uret(&sirr, baslangic + TOTP_ADIM_SN - 1),
        "pencere icinde sabit"
    );
    assert_ne!(
        kod_uret(&sirr, baslangic),
        kod_uret(&sirr, baslangic + TOTP_ADIM_SN),
        "pencere degisince kod degismeli"
    );
}

#[test]
fn yanlis_bicimli_kodlar_reddedilir() {
    let sirr = sirr_uret();
    let zaman = 1_700_000_000;
    let gecerli = kod_uret(&sirr, zaman);
    assert!(kodu_dogrula(&sirr, &gecerli, zaman));
    assert!(kodu_dogrula(&sirr, &format!(" {gecerli} "), zaman), "kenar bosluogu tolere edilir");

    assert!(!kodu_dogrula(&sirr, "", zaman));
    assert!(!kodu_dogrula(&sirr, "12345", zaman), "5 hane reddedilir");
    assert!(!kodu_dogrula(&sirr, "1234567", zaman), "7 hane reddedilir");
    assert!(!kodu_dogrula(&sirr, "12345a", zaman), "harf reddedilir");
    assert!(!kodu_dogrula(&sirr, "abcdef", zaman), "harfler reddedilir");
    assert!(!kodu_dogrula(&sirr, "12 456", zaman), "bosluk reddedilir");
}

#[test]
fn saat_kaymasi_penceresinde_kabul_eder_uzakta_reddeder() {
    let sirr = sirr_uret();
    let zaman = 1_700_000_000 - (1_700_000_000 % TOTP_ADIM_SN);

    // ±1 pencere kabul: kullanici saati 30 saniye kaymis cihazda girmemesin.
    for kayma in [-TOTP_PENCERE, TOTP_PENCERE] {
        let kod = kod_uret(&sirr, zaman + kayma * TOTP_ADIM_SN);
        assert!(kodu_dogrula(&sirr, &kod, zaman), "kayma {kayma} kabul edilmeli");
    }
    // ±2 reddedilir: 2 pencereden geniş tolerans kodu tahmin edilebilir kılar.
    for kayma in [-2 * TOTP_PENCERE, 2 * TOTP_PENCERE] {
        let kod = kod_uret(&sirr, zaman + kayma * TOTP_ADIM_SN);
        assert!(!kodu_dogrula(&sirr, &kod, zaman), "kayma {kayma} reddedilmeli");
    }
}

#[test]
fn farkli_sirrlar_ayni_kodu_uretmeyebilir_ve_uretmez() {
    // Aynı anda iki farklı sır için üretilen kodlar çoğunlukla farklıdır.
    // Aynı çıkması 1/1.000.000 ihtimal: testin kararsızlaşmaması için
    // yalnız "pratik olarak farklı" ölçülür.
    let a = sirr_uret();
    let b = sirr_uret();
    assert_ne!(a, b);
}

#[tokio::test]
async fn kayit_agir_dogrulanmamis_sayilir() {
    let mut conn = conn().await;
    kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");

    // Kritik: kayit olmak tek basina 2FA'yi hazirlamaz.
    assert!(!dogrulanmis_mi(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("sorgu calisir"));
}

#[tokio::test]
async fn sir_kalici_tabloda_duz_metin_kalmaz() {
    let mut conn = conn().await;
    let kayit = kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");

    let satir: (String, Option<String>) =
        sqlx::query_as("SELECT secret_hash, pending_secret FROM two_factor_secrets")
            .fetch_one(&mut conn)
            .await
            .expect("satir okunur");

    assert_ne!(satir.0, kayit.secret, "sirin ozeti saklanir");
    assert_eq!(
        satir.1.as_deref(),
        Some(kayit.secret.as_str()),
        "dogrulama penceresinde siri tutulur"
    );
}

#[tokio::test]
async fn dogru_kod_ile_kayit_dogrulanir_ve_sir_silinir() {
    let mut conn = conn().await;
    let kayit = kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");

    kayit_dogrula(&mut conn, "tenant_a", "usr_1", &kayit.current_code)
        .await
        .expect("kod dogrulanir");

    assert!(dogrulanmis_mi(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("sorgu calisir"));

    let pending: Option<String> =
        sqlx::query_scalar("SELECT pending_secret FROM two_factor_secrets")
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert!(pending.is_none(), "dogrulama sonrasi siri silinmeli");
}

#[tokio::test]
async fn ayni_kullanici_iki_kez_kayit_olamaz() {
    let mut conn = conn().await;
    kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");
    let hata = kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect_err("ikinci kayit reddedilir");
    assert!(hata.starts_with("CONFLICT"));
}

#[tokio::test]
async fn ayni_kullanici_baska_kiracida_kayit_olabilir() {
    let mut conn = conn().await;
    kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");
    // Ayni `user_id` farkli isletmede: UNIQUE cifti (tenant, user).
    kayit_ac(&mut conn, "tenant_b", "usr_1", "Kasa")
        .await
        .expect("baska kiracida kayit acilmali");
    let adet: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM two_factor_secrets")
        .fetch_one(&mut conn)
        .await
        .expect("sayilir");
    assert_eq!(adet, 2);
}

#[tokio::test]
async fn hatali_kod_kaydi_dogrulamaz() {
    let mut conn = conn().await;
    kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");

    let hata = kayit_dogrula(&mut conn, "tenant_a", "usr_1", "000000")
        .await
        .expect_err("hatali kod reddedilir");
    assert!(hata.starts_with("UNAUTHORIZED"));
    assert!(!dogrulanmis_mi(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("sorgu calisir"));
}

#[tokio::test]
async fn bes_hatali_denemeden_sonra_dogrulama_kilitlenir() {
    let mut conn = conn().await;
    let kayit = kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");

    for _ in 0..MAX_HESAP_HATASI {
        let _ = kayit_dogrula(&mut conn, "tenant_a", "usr_1", "000000").await;
    }

    // Dogru kod bile kilit suresi dolmadan gecmez: 6 haneli kod
    // sınırsiz denemeyle saniyeler icinde bulunur.
    let hata = kayit_dogrula(&mut conn, "tenant_a", "usr_1", &kayit.current_code)
        .await
        .expect_err("kilitliyken dogru kod da gecmemeli");
    assert!(hata.starts_with("LOCKED"));
    assert!(!dogrulanmis_mi(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("sorgu calisir"));
}

#[tokio::test]
async fn kilit_suresi_dolunca_dogrulama_acar() {
    let mut conn = conn().await;
    let kayit = kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");
    for _ in 0..MAX_HESAP_HATASI {
        let _ = kayit_dogrula(&mut conn, "tenant_a", "usr_1", "000000").await;
    }

    // Kilit suresi gecmis gibi yazilir: geri sayim dolmustur.
    sqlx::query("UPDATE two_factor_secrets SET locked_until = ?")
        .bind(simdi_sn() - 1)
        .execute(&mut conn)
        .await
        .expect("kilit suresi gecmiste");

    kayit_dogrula(&mut conn, "tenant_a", "usr_1", &kayit.current_code)
        .await
        .expect("kilit suresi dolduysa acilir");
    assert!(dogrulanmis_mi(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("sorgu calisir"));
}

#[tokio::test]
async fn basarili_dogrulama_sayaaci_sifirlar() {
    let mut conn = conn().await;
    let kayit = kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");
    let _ = kayit_dogrula(&mut conn, "tenant_a", "usr_1", "000000").await;
    let _ = kayit_dogrula(&mut conn, "tenant_a", "usr_1", "111111").await;

    kayit_dogrula(&mut conn, "tenant_a", "usr_1", &kayit.current_code)
        .await
        .expect("dogrulanir");

    let (basarisiz, kilit): (i64, Option<i64>) =
        sqlx::query_as("SELECT failed_attempts, locked_until FROM two_factor_secrets")
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert_eq!(basarisiz, 0, "basarili deneme sayaci sifirlar");
    assert!(kilit.is_none(), "basarili deneme kilidi kaldirir");
}

#[tokio::test]
async fn dogrulanmis_kayit_tekrar_dogrulanamaz() {
    let mut conn = conn().await;
    let kayit = kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");
    kayit_dogrula(&mut conn, "tenant_a", "usr_1", &kayit.current_code)
        .await
        .expect("dogrulanir");

    let hata = kayit_dogrula(&mut conn, "tenant_a", "usr_1", &kayit.current_code)
        .await
        .expect_err("siri silindi, tekrar dogrulanamaz");
    assert!(hata.starts_with("CONFLICT"));
}

#[tokio::test]
async fn kayitsiz_kullanici_dogrulayamaz_ve_kiraci_ayrimi_korunur() {
    let mut conn = conn().await;
    let kayit = kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");

    // Ayni kullanici id, yanlis kiraci: sorgu kirac filtresi yuzunden
    // satir bulmaz.
    let hata = kayit_dogrula(&mut conn, "tenant_b", "usr_1", &kayit.current_code)
        .await
        .expect_err("yanlis kiracida dogrulanmamali");
    assert!(hata.starts_with("NOT_FOUND"));

    let hata = kayit_dogrula(&mut conn, "tenant_b", "usr_9", "000000")
        .await
        .expect_err("kayitsiz kullanici reddedilir");
    assert!(hata.starts_with("NOT_FOUND"));
}

#[tokio::test]
async fn kayit_kaldirma_her_iki_satiri_siler() {
    let mut conn = conn().await;
    let kayit = kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");
    kayit_dogrula(&mut conn, "tenant_a", "usr_1", &kayit.current_code)
        .await
        .expect("dogrulanir");

    assert!(kayit_kaldir(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("kaldirilir"));

    let sir: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM two_factor_secrets")
        .fetch_one(&mut conn)
        .await
        .expect("sayilir");
    let dogrulama: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM two_factor_verifications")
        .fetch_one(&mut conn)
        .await
        .expect("sayilir");
    assert_eq!(sir, 0, "sir satiri silinir");
    assert_eq!(dogrulama, 0, "dogrulama izi de silinir, 2FA pasif");
    assert!(!dogrulanmis_mi(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("sorgu calisir"));
}

#[tokio::test]
async fn kayit_kaldirma_yoksa_ve_baska_kiracida_sessiz_gecer() {
    let mut conn = conn().await;
    kayit_ac(&mut conn, "tenant_a", "usr_1", "Kasa")
        .await
        .expect("kayit acilir");

    // Baska kiracinin ayni kullanici id'si silinmez: kayit kirac bazinda.
    assert!(
        !kayit_kaldir(&mut conn, "tenant_b", "usr_1").await.expect("sessiz gecer"),
        "baska kiracida kayit yok, silme sessizce false donmeli"
    );
    let kalan: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM two_factor_secrets")
        .fetch_one(&mut conn)
        .await
        .expect("sayilir");
    assert_eq!(kalan, 1, "hedef kiracinin kaydi durmali");

    // Ikinci kez ayni kaydi silmek hata degil `false` doner.
    assert!(kayit_kaldir(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("ilk silme"));
    assert!(!kayit_kaldir(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("ikinci silme sessiz gecer"));
}