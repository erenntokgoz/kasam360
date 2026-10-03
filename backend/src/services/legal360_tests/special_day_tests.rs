//! Özel gün testleri: kayıt, yıllık tekrar ve yaklaşan gün listesi.
//!
//! Kritik senaryo yıllık tekrardır: 29 Kasım 2024'te kaydedilen bir gün
//! 2027'de de görünmelidir. Testler bu yüzden kayıt tarihini bilerek geçmiş
//! bir yıla sabitler.

use chrono::Datelike;

use super::support::{bugun, conn_of, gun, test_pool, KIRACI_A, KIRACI_B};
use crate::services::legal360::special_days::{
    list_special_days, list_upcoming_special_days, save_special_day, SpecialDayInput,
};

fn girdi(ad: &str, tarih: &str, tekrarlar: bool) -> SpecialDayInput {
    SpecialDayInput {
        id: None,
        name: ad.to_string(),
        date: tarih.to_string(),
        recurring_yearly: Some(tekrarlar),
        advance_days: Some(7),
        discount_percent: Some(15),
        description: None,
        is_active: None,
    }
}

#[tokio::test]
async fn ozel_gun_kaydedilir_ve_listelenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let gun_kaydi = save_special_day(&mut conn, KIRACI_A, girdi("Kadınlar Günü", &gun(50), false))
        .await
        .expect("gun kaydedilmeli");

    assert!(gun_kaydi.id.starts_with("spd_"), "{}", gun_kaydi.id);
    assert_eq!(gun_kaydi.discount_percent, 15);
    assert!(!gun_kaydi.recurring_yearly);

    let liste = list_special_days(&mut conn, KIRACI_A)
        .await
        .expect("liste okunmali");
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0].name, "Kadınlar Günü");
}

#[tokio::test]
async fn indirim_yuzdesi_siniri_denenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // %100 indirim zarar yazar; reddedilmeli.
    let mut asiri = girdi("Aşırı", &gun(10), false);
    asiri.discount_percent = Some(100);
    let hata = save_special_day(&mut conn, KIRACI_A, asiri)
        .await
        .expect_err("%100 indirim reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");

    // %90 sınırdır ve kabul edilir.
    let mut sinirda = girdi("Sınırdaki", &gun(10), false);
    sinirda.discount_percent = Some(90);
    assert!(save_special_day(&mut conn, KIRACI_A, sinirda).await.is_ok());
}

#[tokio::test]
async fn hazirlama_suresi_sinirlari_denenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let mut cok = girdi("Çok erken", &gun(10), false);
    cok.advance_days = Some(91);
    let hata = save_special_day(&mut conn, KIRACI_A, cok)
        .await
        .expect_err("91 gun hazirlik reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn tekrarlayan_gun_gecmis_yildan_bugune_tasinir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // Geçmiş bir yıla kaydedilmiş yıllık tekrarlayan gün.
    let gecmis_yil = chrono::Local::now().year() - 2;
    let kayit = save_special_day(
        &mut conn,
        KIRACI_A,
        girdi("Kara Cuma", &format!("{gecmis_yil}-11-29"), true),
    )
    .await
    .expect("gecmis yila kaydedilmeli");
    assert!(kayit.recurring_yearly);

    let yaklasan = list_upcoming_special_days(&mut conn, KIRACI_A, 365)
        .await
        .expect("yaklasan gunler okunmali");
    assert_eq!(yaklasan.len(), 1, "yillik tekrar gelecek yila tasinmali");

    let (_, gerceklesme, _) = &yaklasan[0];
    let gerceklesme_tarih =
        chrono::NaiveDate::parse_from_str(gerceklesme, "%Y-%m-%d").expect("tarih cozulmeli");
    assert_eq!(gerceklesme_tarih.month(), 11, "ay korunmali");
    assert_eq!(gerceklesme_tarih.day(), 29, "gun korunmali");
    assert!(
        gerceklesme_tarih >= chrono::Local::now().date_naive(),
        "gerceklesme bugunden once olmamali: {gerceklesme}"
    );
}

#[tokio::test]
async fn tekrarlayan_gun_bugunki_tarihte_bugun_secilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let bugun_tarih = chrono::Local::now().date_naive();
    save_special_day(
        &mut conn,
        KIRACI_A,
        girdi(
            "Bugünün Günü",
            &bugun_tarih.format("%Y-%m-%d").to_string(),
            true,
        ),
    )
    .await
    .expect("bugunun gunu kaydedilmeli");

    let yaklasan = list_upcoming_special_days(&mut conn, KIRACI_A, 30)
        .await
        .expect("yaklasan gunler okunmali");
    assert_eq!(yaklasan.len(), 1);
    assert_eq!(
        yaklasan[0].1,
        bugun(),
        "bugune denk gelen tekrar yarin degil bugun secilmeli"
    );
}

#[tokio::test]
async fn tekrarlamayan_gun_gecmiste_kalmaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_special_day(&mut conn, KIRACI_A, girdi("Geçmiş", &gun(-10), false))
        .await
        .expect("gecmis gun");

    let yaklasan = list_upcoming_special_days(&mut conn, KIRACI_A, 30)
        .await
        .expect("yaklasan gunler okunmali");
    assert!(
        yaklasan.is_empty(),
        "gecmis gun yaklasan listede olmamali (yalnizca yillik tekrarlar tasinir)"
    );

    // Kayıt yine de durur: geçmiş bir kampanya raporlanabilir olmalı.
    let liste = list_special_days(&mut conn, KIRACI_A)
        .await
        .expect("liste okunmali");
    assert_eq!(liste.len(), 1, "gecmis gun kayd silinmemeli");
}

#[tokio::test]
async fn yaklasan_liste_tarihe_gore_siralanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_special_day(&mut conn, KIRACI_A, girdi("Yakın", &gun(5), false))
        .await
        .expect("yakin gun");
    save_special_day(&mut conn, KIRACI_A, girdi("Uzak", &gun(40), false))
        .await
        .expect("uzak gun");

    let yaklasan = list_upcoming_special_days(&mut conn, KIRACI_A, 60)
        .await
        .expect("yaklasan gunler okunmali");
    assert_eq!(yaklasan.len(), 2);
    assert_eq!(yaklasan[0].0.name, "Yakın", "en yakin tarih once gelmeli");
    assert_eq!(yaklasan[1].0.name, "Uzak");
}

#[tokio::test]
async fn kapsam_penceresi_disi_gunler_gorunmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_special_day(&mut conn, KIRACI_A, girdi("30 gün içinde", &gun(20), false))
        .await
        .expect("yakin gun");
    save_special_day(&mut conn, KIRACI_A, girdi("60 gün içinde", &gun(50), false))
        .await
        .expect("uzak gun");

    let on_gun = list_upcoming_special_days(&mut conn, KIRACI_A, 10)
        .await
        .expect("on gunluk liste");
    assert!(on_gun.is_empty(), "10 gunluk pencerede gun yok");

    let otuz = list_upcoming_special_days(&mut conn, KIRACI_A, 30)
        .await
        .expect("otuz gunluk liste");
    assert_eq!(
        otuz.len(),
        1,
        "30 gunluk pencerede yalnizca yakin gun olmali"
    );
}

#[tokio::test]
async fn kapsam_sinirlari_denenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    for kapsam in [0, -5, 366] {
        let sonuc = list_upcoming_special_days(&mut conn, KIRACI_A, kapsam).await;
        let hata = sonuc
            .err()
            .unwrap_or_else(|| panic!("kapsam {kapsam} reddedilmedi"));
        assert!(hata.starts_with("VALIDATION"), "kapsam {kapsam}: {hata}");
    }
}

#[tokio::test]
async fn pasif_gun_yaklasan_listede_gorunmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let gun_kaydi = save_special_day(&mut conn, KIRACI_A, girdi("Kapalı", &gun(10), false))
        .await
        .expect("gun");
    let mut pasif = girdi("Kapalı", &gun(10), false);
    pasif.id = Some(gun_kaydi.id.clone());
    pasif.is_active = Some(false);
    save_special_day(&mut conn, KIRACI_A, pasif)
        .await
        .expect("pasiflestirilmeli");

    let yaklasan = list_upcoming_special_days(&mut conn, KIRACI_A, 30)
        .await
        .expect("yaklasan gunler");
    assert!(yaklasan.is_empty(), "pasif gun yaklasan listede olmamali");
}

#[tokio::test]
async fn kiracilar_arasinda_ozel_gun_gorunmez_ve_duzenlenemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let gun_kaydi = save_special_day(&mut conn, KIRACI_A, girdi("A Güneşi", &gun(10), false))
        .await
        .expect("A gunu");

    let b_listesi = list_special_days(&mut conn, KIRACI_B)
        .await
        .expect("B listesi");
    assert!(b_listesi.is_empty(), "B isletmesi A'nin gununu gormemeli");

    let b_yaklasan = list_upcoming_special_days(&mut conn, KIRACI_B, 30)
        .await
        .expect("B yaklasan");
    assert!(
        b_yaklasan.is_empty(),
        "B yaklasan listesinde A gunu olmamali"
    );

    let mut saldirgan = girdi("Çalınmış", &gun(1), false);
    saldirgan.id = Some(gun_kaydi.id.clone());
    let hata = save_special_day(&mut conn, KIRACI_B, saldirgan)
        .await
        .expect_err("B, A'nin gununu guncelleyememeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    let a_listesi = list_special_days(&mut conn, KIRACI_A)
        .await
        .expect("A listesi");
    assert_eq!(a_listesi[0].name, "A Güneşi", "A kaydi bozulmamali");
    assert_eq!(a_listesi[0].date, gun(10));
}

#[tokio::test]
async fn gecersiz_tarih_ve_ad_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let hata = save_special_day(&mut conn, KIRACI_A, girdi("Hatalı", "2026-13-01", false))
        .await
        .expect_err("gecersiz ay reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");

    let hata = save_special_day(&mut conn, KIRACI_A, girdi("  ", &gun(10), false))
        .await
        .expect_err("bos ad reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}
