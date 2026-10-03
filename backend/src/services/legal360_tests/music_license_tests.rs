//! Müzik telif lisansı testleri: kayıt, yıl benzersizliği, süresi dolanlar.
//!
//! `amount_cents` bir **borç**tur. Negatif değer "ödemek zorunda değilim"
//! anlamına gelmez; borcu siler ve lisans bedeli raporlanamaz hale gelir.

use super::support::{bu_yil, bugun, conn_of, gun, test_pool, KIRACI_A, KIRACI_B};
use crate::services::legal360::music_license::{
    expired_count, get_expiring_licenses, list_licenses, save_license, total_license_cents,
    MusicLicenseInput,
};

fn girdi(tur: &str, yil: i64, tutar: i64, bitis: &str) -> MusicLicenseInput {
    MusicLicenseInput {
        id: None,
        license_type: tur.to_string(),
        year: yil,
        amount_cents: tutar,
        expiry_date: bitis.to_string(),
        reminder_days: Some(30),
        notes: None,
        is_active: None,
    }
}

#[tokio::test]
async fn lisans_kaydedilir_ve_listelenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let yil = bu_yil();
    let lisans = save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 350000, &gun(120)))
        .await
        .expect("lisans kaydedilmeli");

    assert!(lisans.id.starts_with("lic_"), "{}", lisans.id);
    assert_eq!(lisans.amount_cents, 350000);
    assert_eq!(lisans.year, yil);

    let liste = list_licenses(&mut conn, KIRACI_A, None)
        .await
        .expect("liste okunmali");
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0].license_type, "MESAM");
}

#[tokio::test]
async fn uc_kurum_ayri_kayit_tutar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 350000, &gun(120)))
        .await
        .expect("MESAM");
    save_license(&mut conn, KIRACI_A, girdi("MSG", yil, 120000, &gun(120)))
        .await
        .expect("MSG");
    save_license(&mut conn, KIRACI_A, girdi("BILGI", yil, 80000, &gun(120)))
        .await
        .expect("BILGI");

    let liste = list_licenses(&mut conn, KIRACI_A, None)
        .await
        .expect("liste okunmali");
    assert_eq!(liste.len(), 3, "her kurum ayri kayit olmali");

    let toplam = total_license_cents(&mut conn, KIRACI_A, yil)
        .await
        .expect("toplam okunmali");
    assert_eq!(toplam, 550000, "yillik toplam telif borcu");
}

#[tokio::test]
async fn ayni_yil_icin_ikinci_kayit_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 350000, &gun(120)))
        .await
        .expect("ilk kayit");

    let hata = save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 900000, &gun(120)))
        .await
        .expect_err("ayni tur ve yil icin ikinci kayit reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
    assert!(
        hata.contains(&yil.to_string()),
        "hata yili belirtmeli: {hata}"
    );

    // Farklı tür aynı yılda kaydedilebilir.
    assert!(
        save_license(&mut conn, KIRACI_A, girdi("MSG", yil, 120000, &gun(120)))
            .await
            .is_ok()
    );
    // Farklı yıl aynı türde kaydedilebilir.
    assert!(save_license(
        &mut conn,
        KIRACI_A,
        girdi("MESAM", yil + 1, 400000, &gun(120))
    )
    .await
    .is_ok());
}

#[tokio::test]
async fn negatif_bedel_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    let hata = save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, -350000, &gun(120)))
        .await
        .expect_err("negatif lisans bedeli reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn gecersiz_tur_yil_ve_tarih_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    let hata = save_license(&mut conn, KIRACI_A, girdi("SIA", yil, 1000, &gun(120)))
        .await
        .expect_err("gecersiz tur reddedilmeli");
    assert!(hata.contains("MESAM"), "{hata}");

    for kotu_yil in [0, 1800, 2400] {
        let hata = save_license(
            &mut conn,
            KIRACI_A,
            girdi("MESAM", kotu_yil, 1000, &gun(120)),
        )
        .await
        .expect_err("gecersiz yil reddedilmeli");
        assert!(hata.contains("yıl"), "{hata}");
    }

    let hata = save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 1000, "31.12.2026"))
        .await
        .expect_err("gecersiz tarih reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn suresi_dolan_lisanslar_penceresine_girer() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 350000, &gun(5)))
        .await
        .expect("yakın");
    save_license(&mut conn, KIRACI_A, girdi("MSG", yil, 120000, &gun(180)))
        .await
        .expect("uzak");

    let expiring = get_expiring_licenses(&mut conn, KIRACI_A, 30)
        .await
        .expect("pencerede");
    assert_eq!(expiring.len(), 1);
    assert_eq!(expiring[0].license_type, "MESAM");
}

#[tokio::test]
async fn hatirlatma_penceresi_satir_bazli_calisir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    let mut uzun = girdi("BILGI", yil, 80000, &gun(45));
    uzun.reminder_days = Some(60);
    save_license(&mut conn, KIRACI_A, uzun)
        .await
        .expect("lisans");

    let expiring = get_expiring_licenses(&mut conn, KIRACI_A, 30)
        .await
        .expect("pencerede");
    assert_eq!(
        expiring.len(),
        1,
        "genel pencere 30 olsa da satirin 60 gunluk hatirlatmasi gecerli"
    );
}

#[tokio::test]
async fn gecmis_lisans_sayaci_bugun_sartina_gore_calisir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    save_license(
        &mut conn,
        KIRACI_A,
        girdi("MESAM", yil - 1, 300000, &gun(-100)),
    )
    .await
    .expect("gecmis lisans");
    save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 400000, &gun(100)))
        .await
        .expect("gelecek lisans");

    assert_eq!(
        expired_count(&mut conn, KIRACI_A).await.expect("sayim"),
        1,
        "yalnizca suresi dolmus lisans sayilmali"
    );
    assert_eq!(
        expired_count(&mut conn, KIRACI_B).await.expect("sayim"),
        0,
        "baska isletmenin gecmis lisansi sayilmamali"
    );
}

#[tokio::test]
async fn bugun_dolan_lisans_gecmis_sayilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 300000, &bugun()))
        .await
        .expect("bugun dolan");

    assert_eq!(
        expired_count(&mut conn, KIRACI_A).await.expect("sayim"),
        0,
        "bugun dolan lisans henuz gecmis degildir"
    );
    let expiring = get_expiring_licenses(&mut conn, KIRACI_A, 30)
        .await
        .expect("pencerede");
    assert_eq!(expiring.len(), 1, "ama yenilenmesi icin pencerede olmali");
}

#[tokio::test]
async fn yil_filtresi_calisir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 350000, &gun(120)))
        .await
        .expect("bu yil");
    save_license(
        &mut conn,
        KIRACI_A,
        girdi("MESAM", yil - 1, 300000, &gun(-400)),
    )
    .await
    .expect("gecmis yil");

    let bu_yil = list_licenses(&mut conn, KIRACI_A, Some(yil))
        .await
        .expect("yil filtresi");
    assert_eq!(bu_yil.len(), 1);
    assert_eq!(bu_yil[0].year, yil);
}

#[tokio::test]
async fn kiracilar_arasinda_lisans_gorunmez_ve_duzenlenemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    let lisans = save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 350000, &gun(10)))
        .await
        .expect("A lisans");

    let b_liste = list_licenses(&mut conn, KIRACI_B, None)
        .await
        .expect("B listesi");
    assert!(b_liste.is_empty(), "B, A'nin lisansini gormemeli");

    let b_toplam = total_license_cents(&mut conn, KIRACI_B, yil)
        .await
        .expect("B toplami");
    assert_eq!(b_toplam, 0, "B toplami A'nin bedelini icermemeli");

    let mut saldirgan = girdi("MESAM", yil, 1, &gun(1));
    saldirgan.id = Some(lisans.id.clone());
    let hata = save_license(&mut conn, KIRACI_B, saldirgan)
        .await
        .expect_err("B, A'nin lisansini guncelleyememeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    let a_liste = list_licenses(&mut conn, KIRACI_A, None)
        .await
        .expect("A listesi");
    assert_eq!(a_liste[0].amount_cents, 350000, "A kaydi bozulmamali");
}

#[tokio::test]
async fn pasif_lisans_yillik_toplam_dahil_edilmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let yil = bu_yil();

    let lisans = save_license(&mut conn, KIRACI_A, girdi("MESAM", yil, 350000, &gun(120)))
        .await
        .expect("lisans");
    let mut pasif = girdi("MESAM", yil, 350000, &gun(120));
    pasif.id = Some(lisans.id.clone());
    pasif.is_active = Some(false);
    save_license(&mut conn, KIRACI_A, pasif)
        .await
        .expect("pasiflestirilmeli");

    let toplam = total_license_cents(&mut conn, KIRACI_A, yil)
        .await
        .expect("toplam");
    assert_eq!(toplam, 0, "pasif lisans borcu sayilmamali");
}
