//! Oturum **kapısı** testleri (D1): zorunluluk, rol çözümlemesi, aktör.
//!
//! `super` = `session_tests`, dolayısıyla `super::*` zaten oturum yordamlarını ve
//! `conn()` yardımcısını getirir.
use super::*;

/// Kullanıcı kaydı ekler: rol çözümlemesi tabloyu okur, uydurma satırla test
/// edilemez.
async fn kullanici(conn: &mut SqliteConnection, id: &str, rol: &str, aktif: i64) {
    sqlx::query(
        "INSERT INTO users (id, tenant_id, name, role, pin_hash, is_active)
         VALUES (?, 'tenant_a', 'Test', ?, 'x', ?)",
    )
    .bind(id)
    .bind(rol)
    .bind(aktif)
    .execute(&mut *conn)
    .await
    .expect("kullanici eklenir");
}

// ---- oturum kapısı: kiracı bazında zorunluluk ----

#[tokio::test]
async fn varsayilanda_oturum_zorunlu_degil() {
    // Arayüz Faz 17'de jeton gönderene kadar mevcut davranış korunur.
    let mut conn = conn().await;
    assert!(!zorunlu_kil(&mut conn, "tenant_a").await.expect("okunur"));
    assert!(oturum_kapisi(&mut conn, None, "tenant_a")
        .await
        .expect("gecer")
        .is_none());
}

#[tokio::test]
async fn zorunlu_kilinca_jetonsuz_komut_durur() {
    let mut conn = conn().await;
    zorunlu_kil_ayarla(&mut conn, "tenant_a", true)
        .await
        .expect("ayarlanir");

    assert!(zorunlu_kil(&mut conn, "tenant_a").await.expect("okunur"));
    for jeton in [None, Some(""), Some("   ")] {
        let hata = oturum_kapisi(&mut conn, jeton, "tenant_a")
            .await
            .expect_err("jetonsuz gecmemeli");
        assert_eq!(hata, error::SESSION_REQUIRED);
    }
}

#[tokio::test]
async fn zorunlu_kilinca_gecerli_jeton_gecer() {
    let mut conn = conn().await;
    zorunlu_kil_ayarla(&mut conn, "tenant_a", true)
        .await
        .expect("ayarlanir");
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
        .await
        .expect("ac");

    let oturum = oturum_kapisi(&mut conn, Some(&bilet.token), "tenant_a")
        .await
        .expect("gecer")
        .expect("oturum doner");
    assert_eq!(oturum.user_id, "usr_1");
}

#[tokio::test]
async fn zorunluluk_kapalikeyken_verilen_jeton_yine_dogrulanir() {
    // Kapı kapalıyken "jeton yok" denerek atlamak serbesttir; ama bir
    // jeton **verilmişse** yanlışı kabul edilemez.
    let mut conn = conn().await;
    assert!(oturum_kapisi(&mut conn, Some("uydurma"), "tenant_a")
        .await
        .err()
        .is_some());
}

#[tokio::test]
async fn zorunluluk_kiracilar_arasi_karismaz() {
    let mut conn = conn().await;
    zorunlu_kil_ayarla(&mut conn, "tenant_a", true)
        .await
        .expect("ayarlanir");
    let bilet = oturum_ac(&mut conn, "tenant_b", "usr_1", "Kasa 1")
        .await
        .expect("ac");

    // Kiracı B zorunlu değil: jetonsuz geçer.
    assert!(oturum_kapisi(&mut conn, None, "tenant_b")
        .await
        .expect("gecer")
        .is_none());
    // Kiracı A zorunlu: kiracı B'nin oturumu A için geçerli değildir.
    assert!(oturum_kapisi(&mut conn, Some(&bilet.token), "tenant_a")
        .await
        .is_err());
}

#[tokio::test]
async fn zorunluluk_kapatilabilir_ve_tekrar_acilabilir() {
    let mut conn = conn().await;
    zorunlu_kil_ayarla(&mut conn, "tenant_a", true)
        .await
        .expect("ac");
    assert!(zorunlu_kil(&mut conn, "tenant_a").await.expect("okunur"));

    zorunlu_kil_ayarla(&mut conn, "tenant_a", false)
        .await
        .expect("kapat");
    assert!(!zorunlu_kil(&mut conn, "tenant_a").await.expect("okunur"));
    assert!(oturum_kapisi(&mut conn, None, "tenant_a")
        .await
        .expect("gecer")
        .is_none());

    let satir: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session_policies")
        .fetch_one(&mut conn)
        .await
        .expect("sayilir");
    assert_eq!(satir, 1, "ayarlama yeni satir acmamali");
}

// ---- rol çözümlemesi: rol çağırandan değil kullanıcı kaydından gelir ----

#[tokio::test]
async fn rol_kayittan_okunur() {
    let mut conn = conn().await;
    kullanici(&mut conn, "usr_kas", "Cashier", 1).await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_kas", "Kasa")
        .await
        .expect("ac");
    let oturum = oturum_dogrula(&mut conn, &bilet.token, "tenant_a")
        .await
        .expect("dogrula");

    assert_eq!(
        oturum_rolu(&mut conn, &oturum).await.expect("rol"),
        "CASHIER"
    );
}

#[tokio::test]
async fn rol_tanimli_degilse_hata_verir() {
    let mut conn = conn().await;
    // "superadmin" burada kullanılamaz: takma ad listesinde **gerçekten**
    // MASTER'a karşılık gelir. Testin amacı tanınmayan yazımdır.
    kullanici(&mut conn, "usr_bozuk", "root", 1).await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_bozuk", "X")
        .await
        .expect("ac");
    let oturum = oturum_dogrula(&mut conn, &bilet.token, "tenant_a")
        .await
        .expect("dogrula");

    // Tanınmayan rol "en yetkiliye yakın" sayılmaz: hata yükselir.
    assert_eq!(
        oturum_rolu(&mut conn, &oturum).await.err(),
        Some(error::INVALID_SESSION.to_string())
    );
}

#[tokio::test]
async fn pasif_kullanici_oturum_kullanamaz() {
    // Personel silinmez, pasifleştirilir; pasif kullanıcı canlı oturumu
    // kullanamaz.
    let mut conn = conn().await;
    kullanici(&mut conn, "usr_pasif", "Owner", 0).await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_pasif", "X")
        .await
        .expect("ac");
    let oturum = oturum_dogrula(&mut conn, &bilet.token, "tenant_a")
        .await
        .expect("jeton gecerli");

    assert!(oturum_rolu(&mut conn, &oturum).await.is_err());
}

// ---- aktör çözümlemesi: kimlik ve rol birlikte ----

#[tokio::test]
async fn oturum_gonderen_kimligi_ve_rolu_yazamaz() {
    let mut conn = conn().await;
    kullanici(&mut conn, "usr_kas", "Cashier", 1).await;
    let bilet = oturum_ac(&mut conn, "tenant_a", "usr_kas", "Kasa")
        .await
        .expect("ac");

    // Çağıran kendini işletme sahibi diye yazıyor; oturum kazandırıcıdır.
    let (kimlik, rol) = oturum_aktoru(
        &mut conn,
        Some(&bilet.token),
        "tenant_a",
        "usr_sahibi",
        "Owner",
    )
    .await
    .expect("gecer");

    assert_eq!(kimlik, "usr_kas", "kimlik oturumdan gelmeli");
    assert_eq!(rol, "CASHIER", "rol oturumdan gelmeli, çağırandan değil");
}

#[tokio::test]
async fn oturum_yoksa_bildirilen_degerler_kullanilir() {
    let mut conn = conn().await;
    let (kimlik, rol) = oturum_aktoru(&mut conn, None, "tenant_a", " usr_1 ", " Waiter ")
        .await
        .expect("gecer");

    assert_eq!(kimlik, "usr_1");
    assert_eq!(rol, "Waiter");
}

#[tokio::test]
async fn oturum_yoksa_bozuk_jeton_hala_durur() {
    let mut conn = conn().await;

    // Zorunluluk kapalıyken bile verilen bozuk jeton kabul edilmez.
    assert!(
        oturum_aktoru(&mut conn, Some("uydurma"), "tenant_a", "usr_1", "Owner")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn baska_kiracinin_oturumu_kimlik_yazamaz() {
    let mut conn = conn().await;
    kullanici(&mut conn, "usr_kas", "Owner", 1).await;
    let bilet = oturum_ac(&mut conn, "tenant_b", "usr_kas", "X")
        .await
        .expect("ac");

    assert!(
        oturum_aktoru(&mut conn, Some(&bilet.token), "tenant_a", "usr_1", "Owner")
            .await
            .is_err()
    );
}
