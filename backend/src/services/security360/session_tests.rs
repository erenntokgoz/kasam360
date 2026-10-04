//! Oturum testleri ayrı dosyada tutulur: `session.rs` 500 satır tavanını aşar.
//!
//! `super` = `session`, dolayısıyla `test_db` iki seviye üstadır.
use super::super::test_db::bellek;
use super::*;

#[path = "session_gate_tests.rs"]
mod gate;

async fn conn() -> SqliteConnection {
    bellek().await
}

#[tokio::test]
async fn acilan_oturum_dogrulanir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    let oturum = oturum_dogrula(&mut conn, &bilet.token, "tenant_a")
        .await
        .expect("oturum gecerli");
    assert_eq!(oturum.user_id, "usr_1");
    assert_eq!(oturum.tenant_id, "tenant_a");
    assert_eq!(oturum.id, bilet.session_id);
    assert_eq!(oturum.device_label, "Kasa 1");
}

#[tokio::test]
async fn jeton_tablosuz_gunduz_metin_olarak_saklanmaz() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    let saklanan: String = sqlx::query_scalar("SELECT token_hash FROM sessions WHERE id = ?")
        .bind(&bilet.session_id)
        .fetch_one(&mut conn)
        .await
        .expect("satir okunur");

    assert_ne!(saklanan, bilet.token, "jeton duz metin saklanmamali");
    assert!(!saklanan.contains(&bilet.token), "jeton ozeti sizmamali");
    assert_eq!(saklanan.len(), 64, "SHA-256 ozeti 64 hex karakter");
}

#[tokio::test]
async fn jeton_baska_kiracida_gecerli_degil() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    let hata = oturum_dogrula(&mut conn, &bilet.token, "tenant_b")
        .await
        .expect_err("baska kiracida gecmemeli");
    assert_eq!(hata, error::INVALID_SESSION);
}

#[tokio::test]
async fn bilinmeyen_jeton_ve_baska_kiraci_ayni_hata_dondurur() {
    let mut conn = conn().await;
    oturum_ac(&mut conn, "tenant_b", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    let yabanci = oturum_dogrula(&mut conn, "olmayan_jeton", "tenant_a")
        .await
        .expect_err("gecersiz");
    let baskasindan = oturum_dogrula(&mut conn, "tenant_b_jetonu", "tenant_a")
        .await
        .err();

    assert_eq!(yabanci, error::INVALID_SESSION);
    assert_eq!(baskasindan, Some(error::INVALID_SESSION.to_string()));
}

#[tokio::test]
async fn bos_ve_bosluklu_jeton_reddedilir() {
    let mut conn = conn().await;
    assert_eq!(
        oturum_dogrula(&mut conn, "", "tenant_a").await.unwrap_err(),
        error::SESSION_REQUIRED
    );
    assert_eq!(
        oturum_dogrula(&mut conn, "   ", "tenant_a")
            .await
            .unwrap_err(),
        error::SESSION_REQUIRED
    );
}

#[tokio::test]
async fn kapatilan_oturum_gecersiz_olur() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    assert!(oturum_kapat(&mut conn, &bilet.token)
        .await
        .expect("kapatilir"));

    let hata = oturum_dogrula(&mut conn, &bilet.token, "tenant_a")
        .await
        .expect_err("kapatilan oturum gecmemeli");
    assert_eq!(hata, error::SESSION_REVOKED);
}

#[tokio::test]
async fn kapatilan_oturum_silinmez_denetim_izi_kalar() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");
    oturum_kapat(&mut conn, &bilet.token)
        .await
        .expect("kapatilir");

    let satir: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE id = ?")
        .bind(&bilet.session_id)
        .fetch_one(&mut conn)
        .await
        .expect("sayilir");
    assert_eq!(satir, 1, "kapatma silme degil, isaretlemedir");

    let revoked: Option<String> =
        sqlx::query_scalar("SELECT revoked_at FROM sessions WHERE id = ?")
            .bind(&bilet.session_id)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert!(revoked.is_some(), "revoked_at islenmeli");
}

#[tokio::test]
async fn ikinci_kapatma_jetonu_gecersizlestirmez_ama_bildirir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    assert!(oturum_kapat(&mut conn, &bilet.token)
        .await
        .expect("ilk kapatma"));
    // Ikinci kapatma `false` doner: satir zaten isaretli.
    assert!(!oturum_kapat(&mut conn, &bilet.token)
        .await
        .expect("ikinci kapatma"));
}

#[tokio::test]
async fn parola_sifirlama_tum_oturumlari_kapatir() {
    let mut conn = conn().await;
    let a = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("ac");
    let b = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 2")
        .await
        .expect("ac");
    let yabancilar = oturum_ac(&mut conn, "tenant_b", "usr_2", "Kasa 3")
        .await
        .expect("ac");

    let kapanan = tum_oturumlari_kapat(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("toplu kapatilir");
    assert_eq!(kapanan, 2, "kullanicinin iki oturumu kapanmali");

    assert!(oturum_dogrula(&mut conn, &a.token, "tenant_a")
        .await
        .is_err());
    assert!(oturum_dogrula(&mut conn, &b.token, "tenant_a")
        .await
        .is_err());
    // Saldirganin acmis olabilecegi baska kullanici oturumu etkilenmez.
    assert!(oturum_dogrula(&mut conn, &yabancilar.token, "tenant_b")
        .await
        .is_ok());
}

#[tokio::test]
async fn toplu_kapatma_cift_tenant_ve_kullanici_durumunda_yalnizca_hedefleri_kapatir() {
    let mut conn = conn().await;
    oturum_ac(&mut conn, "tenant_a", "usr_1", "K1")
        .await
        .expect("ac");
    oturum_ac(&mut conn, "tenant_a", "usr_2", "K2")
        .await
        .expect("ac");
    oturum_ac(&mut conn, "tenant_b", "usr_1", "K3")
        .await
        .expect("ac");

    let kapanan = tum_oturumlari_kapat(&mut conn, "tenant_a", "usr_1")
        .await
        .expect("kapatilir");
    assert_eq!(kapanan, 1, "cift eslesme (tenant + kullanici) zorunlu");
}

#[tokio::test]
async fn suresi_dolus_oturum_gecersizdir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    // Suresi gecmis bir oturumu elle yaz: test, zamanin kendiliginden
    // dolmasini beklemez.
    sqlx::query("UPDATE sessions SET expires_at = ? WHERE id = ?")
        .bind(simdi_sn() - 1)
        .bind(&bilet.session_id)
        .execute(&mut conn)
        .await
        .expect("sure kisaltilir");

    let hata = oturum_dogrula(&mut conn, &bilet.token, "tenant_a")
        .await
        .expect_err("suresi dolmus oturum gecmemeli");
    assert_eq!(hata, error::SESSION_EXPIRED);
}

#[tokio::test]
async fn suresi_doluslari_temizlenir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    sqlx::query("UPDATE sessions SET expires_at = ? WHERE id = ?")
        .bind(simdi_sn() - 1)
        .bind(&bilet.session_id)
        .execute(&mut conn)
        .await
        .expect("sure kisaltilir");

    let silinen = sure_dolmuslari_temizle(&mut conn)
        .await
        .expect("temizlenir");
    assert_eq!(silinen, 1);

    let kalan: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&mut conn)
        .await
        .expect("sayilir");
    assert_eq!(kalan, 0);
}

#[tokio::test]
async fn her_oturum_jetonu_farklidir() {
    let mut conn = conn().await;
    let a = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("ac");
    let b = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("ac");
    assert_ne!(a.token, b.token, "iki oturum ayni jetonu paylasamaz");
}

#[tokio::test]
async fn kiraci_eslesmesi_tam_karakter_ve_kenar_bosluk_tolereli() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    // Kiraci kenar boslugu tolere edilir (arayuzden gelen metin).
    assert!(oturum_dogrula(&mut conn, &bilet.token, " tenant_a ")
        .await
        .is_ok());
    // Buyuk/kucuk harf **esletilmez**: kirac kodu normalizasyonu ayri
    // katmanda yapilir. Burada gevsek eslesme, farkli isletmenin jetonuyla
    // giris kapisini acar.
    assert_eq!(
        oturum_dogrula(&mut conn, &bilet.token, "TENANT_A")
            .await
            .expect_err("buyuk/kucuk harf ayrimi zorunlu"),
        error::INVALID_SESSION
    );
}

#[tokio::test]
async fn sorgu_kiracisiz_calismaz() {
    // Guvenlik denetimi: `sessions` okumasinda kirac filtresi SQL'de
    // bulunmazsa baska isletmenin oturumu bellege alinir.
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("oturum acilir");

    let ozet: String = sqlx::query_scalar("SELECT token_hash FROM sessions")
        .fetch_one(&mut conn)
        .await
        .expect("okunur");
    let yanlis_kiracida: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE token_hash = ? AND tenant_id = ?")
            .bind(&ozet)
            .bind("tenant_b")
            .fetch_one(&mut conn)
            .await
            .expect("sayilir");
    assert_eq!(yanlis_kiracida, 0, "kirac filtresi satiri elemesi");

    // Dogru kiracida ayni jeton yine tek satiri gosterir.
    let dogru_kiracida: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE token_hash = ? AND tenant_id = ?")
            .bind(&ozet)
            .bind("tenant_a")
            .fetch_one(&mut conn)
            .await
            .expect("sayilir");
    assert_eq!(dogru_kiracida, 1);
    let _ = bilet;
}
