//! Yasal belge testleri: mutlu yol, kiracı izolasyonu, sınır durum.
//!
//! Üç eksen zorunludur ve her modülde tekrarlanır:
//!   1. Mutlu yol — kayıt açılır, listelenir, hatırlatmada bulunur.
//!   2. Kiracı izolasyonu — B işletmesi A'nın kaydını ne görebilir ne
//!      değiştirebilir.
//!   3. Sınır durum — süresi geçmiş belge, hatalı tarih, hatalı tür.

use super::support::{bugun, conn_of, gun, test_pool, KIRACI_A, KIRACI_B};
use crate::services::legal360::legal::{
    get_expiring_documents, list_documents, list_upcoming_reminders, save_document,
    LegalDocumentInput,
};

fn girdi(doc_type: &str, bitis: &str) -> LegalDocumentInput {
    LegalDocumentInput {
        id: None,
        doc_type: doc_type.to_string(),
        title: "İşyeri Ruhsatı".to_string(),
        authority: Some("Belediye".to_string()),
        document_number: Some("2026-114".to_string()),
        issue_date: Some(gun(-365)),
        expiry_date: bitis.to_string(),
        reminder_days: Some(30),
        file_path: None,
        notes: None,
        is_active: None,
    }
}

#[tokio::test]
async fn belge_kaydedilir_ve_listelenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let belge = save_document(&mut conn, KIRACI_A, "usr_sahip", girdi("RUHSAT", &gun(120)))
        .await
        .expect("belge kaydedilmeli");

    assert!(
        belge.id.starts_with("leg_"),
        "kimlik prefixed olmali: {}",
        belge.id
    );
    assert_eq!(belge.doc_type, "RUHSAT");
    assert_eq!(belge.reminder_days, 30);

    let liste = list_documents(&mut conn, KIRACI_A, None, true)
        .await
        .expect("liste okunmali");
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0].title, "İşyeri Ruhsatı");
}

#[tokio::test]
async fn belge_turu_buyuk_harfle_normalize_eder() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let belge = save_document(&mut conn, KIRACI_A, "usr_sahip", girdi("ruhsat", &gun(90)))
        .await
        .expect("kucuk harfli tur kabul edilmeli");
    assert_eq!(belge.doc_type, "RUHSAT", "tur kanonik bicimde saklanmali");
}

#[tokio::test]
async fn gecersiz_belge_turu_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let hata = save_document(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        girdi("PASAPORT", &gun(90)),
    )
    .await
    .expect_err("gecersiz tur reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
    assert!(
        hata.contains("RUHSAT"),
        "hata secilebilir turleri saymali: {hata}"
    );
}

#[tokio::test]
async fn gecersiz_tarih_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // "31.02.2026" geçerli bir gün değildir ama sabit uzunlukta olduğu için
    // yalnız uzunluk kontrolü geçerdi; biçim denetimi yakalamalı.
    let hata = save_document(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        girdi("RUHSAT", "31.02.2026"),
    )
    .await
    .expect_err("gecersiz tarih reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");

    let hata = save_document(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        girdi("RUHSAT", "2026-02-31"),
    )
    .await
    .expect_err("var olmayan gun reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn hatirlatma_penceresi_belgenin_kendi_suresini_kullanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // Ruhsat 20 gün sonra doluyor, kasko 200 gün sonra.
    let mut kisa = girdi("RUHSAT", &gun(20));
    kisa.reminder_days = Some(30);
    save_document(&mut conn, KIRACI_A, "usr_sahip", kisa)
        .await
        .expect("kisa vadeli belge");

    let mut uzun = girdi("DIGER", &gun(200));
    uzun.reminder_days = Some(30);
    save_document(&mut conn, KIRACI_A, "usr_sahip", uzun)
        .await
        .expect("uzun vadeli belge");

    let hatirlatmalar = list_upcoming_reminders(&mut conn, KIRACI_A, 30)
        .await
        .expect("hatirlatmalar okunmali");
    assert_eq!(
        hatirlatmalar.len(),
        1,
        "yalnizca 30 gun icindeki belge hatirlatmali"
    );
    assert_eq!(hatirlatmalar[0].doc_type, "RUHSAT");
}

#[tokio::test]
async fn suresi_gecmis_belge_hatirlatmadan_ayrilir_ve_ayri_listede_gorunur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let mut gecmis = girdi("RUHSAT", &gun(-5));
    gecmis.reminder_days = Some(30);
    save_document(&mut conn, KIRACI_A, "usr_sahip", gecmis)
        .await
        .expect("gecmis belge");
    save_document(&mut conn, KIRACI_A, "usr_sahip", girdi("HACCP", &gun(10)))
        .await
        .expect("gelecek belge");

    let hatirlatmalar = list_upcoming_reminders(&mut conn, KIRACI_A, 30)
        .await
        .expect("hatirlatmalar okunmali");
    assert_eq!(hatirlatmalar.len(), 1, "gecmis belge hatirlatmada olmamali");
    assert_eq!(hatirlatmalar[0].doc_type, "HACCP");

    let dolanlar = get_expiring_documents(&mut conn, KIRACI_A)
        .await
        .expect("gecmis belgeler okunmali");
    assert_eq!(dolanlar.len(), 1, "gecmis belge ayri listede gorunmeli");
    assert_eq!(dolanlar[0].doc_type, "RUHSAT");
}

#[tokio::test]
async fn bugun_dolan_belge_gecmis_sayilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_document(&mut conn, KIRACI_A, "usr_sahip", girdi("VERGI", &bugun()))
        .await
        .expect("bugun dolan belge");

    let dolanlar = get_expiring_documents(&mut conn, KIRACI_A)
        .await
        .expect("liste okunmali");
    assert_eq!(
        dolanlar.len(),
        1,
        "bugun dolan belge yenilenmeyi gerektirir, 'gecmis degil' gizlenmemeli"
    );
}

#[tokio::test]
async fn pasif_belge_listelerden_duser() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let belge = save_document(&mut conn, KIRACI_A, "usr_sahip", girdi("SGK", &gun(60)))
        .await
        .expect("belge");
    let mut pasif = girdi("SGK", &gun(60));
    pasif.id = Some(belge.id.clone());
    pasif.is_active = Some(false);
    save_document(&mut conn, KIRACI_A, "usr_sahip", pasif)
        .await
        .expect("pasiflestirilmeli");

    let aktif = list_documents(&mut conn, KIRACI_A, None, true)
        .await
        .expect("liste okunmali");
    assert!(aktif.is_empty(), "pasif belge aktif listede gorunmemeli");

    let tumu = list_documents(&mut conn, KIRACI_A, None, false)
        .await
        .expect("liste okunmali");
    assert_eq!(tumu.len(), 1, "pasif belge arsivde korunmali");
    assert!(!tumu[0].is_active);
}

#[tokio::test]
async fn kiracilar_arasinda_belge_gorunmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_document(&mut conn, KIRACI_A, "usr_sahip", girdi("RUHSAT", &gun(30)))
        .await
        .expect("A belgesi");

    let b_listesi = list_documents(&mut conn, KIRACI_B, None, false)
        .await
        .expect("B listesi okunmali");
    assert!(
        b_listesi.is_empty(),
        "B isletmesi A'nin belgesini gormemeli, sizinti var: {b_listesi:?}"
    );

    let b_hatirlatma = list_upcoming_reminders(&mut conn, KIRACI_B, 30)
        .await
        .expect("B hatirlatmasi okunmali");
    assert!(
        b_hatirlatma.is_empty(),
        "B hatirlatmada A belgesini gormemeli"
    );
}

#[tokio::test]
async fn kiracilar_arasinda_belge_guncellenemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let belge = save_document(&mut conn, KIRACI_A, "usr_sahip", girdi("RUHSAT", &gun(30)))
        .await
        .expect("A belgesi");

    let mut saldirgan = girdi("YANGIN", &gun(1));
    saldirgan.id = Some(belge.id.clone());
    let hata = save_document(&mut conn, KIRACI_B, "usr_sahip_b", saldirgan)
        .await
        .expect_err("B isletmesi A belgesini guncelleyememeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    // A'nın kaydı değişmemiş olmalı.
    let a_listesi = list_documents(&mut conn, KIRACI_A, None, false)
        .await
        .expect("A listesi okunmali");
    assert_eq!(a_listesi[0].doc_type, "RUHSAT", "A belgesi bozulmamali");
    assert_eq!(a_listesi[0].expiry_date, gun(30));
}

#[tokio::test]
async fn hatirlatma_penceresi_sinir_disi_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    for pencere in [-1, 366, 1000] {
        let hata = list_upcoming_reminders(&mut conn, KIRACI_A, pencere)
            .await
            .expect_err("gecersiz pencere reddedilmeli");
        assert!(hata.starts_with("VALIDATION"), "pencere {pencere}: {hata}");
    }
}

#[tokio::test]
async fn tur_filtresi_yalniz_istenen_turu_doner() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_document(&mut conn, KIRACI_A, "usr_sahip", girdi("RUHSAT", &gun(30)))
        .await
        .expect("ruhsat");
    save_document(&mut conn, KIRACI_A, "usr_sahip", girdi("YANGIN", &gun(40)))
        .await
        .expect("yangin");

    let yangin = list_documents(&mut conn, KIRACI_A, Some("yangin"), true)
        .await
        .expect("filtreli liste");
    assert_eq!(yangin.len(), 1, "tur filtresi kucuk harf de kabul etmeli");
    assert_eq!(yangin[0].doc_type, "YANGIN");
}

#[tokio::test]
async fn bos_baslik_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let mut bos = girdi("RUHSAT", &gun(30));
    bos.title = "   ".to_string();
    let hata = save_document(&mut conn, KIRACI_A, "usr_sahip", bos)
        .await
        .expect_err("bos baslik reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn hatirlatma_suresi_sinirlari_denetlenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    for gun_sayisi in [-1, 366] {
        let mut g = girdi("RUHSAT", &gun(30));
        g.reminder_days = Some(gun_sayisi);
        let hata = save_document(&mut conn, KIRACI_A, "usr_sahip", g)
            .await
            .expect_err("gecersiz hatirlatma suresi reddedilmeli");
        assert!(hata.starts_with("VALIDATION"), "{hata}");
    }

    // 0 gün geçerlidir: bugün dolan belge bugün uyarısı alır.
    let mut sifir = girdi("RUHSAT", &gun(30));
    sifir.reminder_days = Some(0);
    assert!(save_document(&mut conn, KIRACI_A, "usr_sahip", sifir)
        .await
        .is_ok());
}
