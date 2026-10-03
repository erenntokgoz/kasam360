//! Sigorta poliçesi testleri: kayıt, geçerlilik sınırları, süresi dolanlar.
//!
//! Kritik konu `coverage_cents` NULL davranışı: teminat bilinmiyorsa rapor
//! "teminat yok" **demelidir**, "limitsiz" değil (AGENTS.md §3.4).

use super::support::{bugun, conn_of, gun, null_kolon_dogrula, test_pool, KIRACI_A, KIRACI_B};
use crate::services::legal360::insurance::{
    get_expiring_policies, list_policies, save_policy, total_premium_cents, PolicyInput,
};

fn girdi(tur: &str, prim: i64, teminat: Option<i64>, bitis: &str) -> PolicyInput {
    PolicyInput {
        id: None,
        policy_type: tur.to_string(),
        insurance_company: "Anadolu Sigorta".to_string(),
        policy_number: "POL-2026-001".to_string(),
        premium_cents: prim,
        coverage_cents: teminat,
        issue_date: gun(-365),
        expiry_date: bitis.to_string(),
        reminder_days: Some(30),
        notes: None,
        is_active: None,
    }
}

#[tokio::test]
async fn polica_kaydedilir_ve_listelenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let polica = save_policy(
        &mut conn,
        KIRACI_A,
        girdi("ISYERI", 120000, Some(5000000), &gun(200)),
    )
    .await
    .expect("polica kaydedilmeli");

    assert!(polica.id.starts_with("pol_"), "{}", polica.id);
    assert_eq!(polica.premium_cents, 120000);
    assert_eq!(polica.coverage_cents, Some(5000000));

    let liste = list_policies(&mut conn, KIRACI_A, None)
        .await
        .expect("liste okunmali");
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0].policy_type, "ISYERI");
}

#[tokio::test]
async fn bilinmeyen_teminat_null_kalir_sifira_donusmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let polica = save_policy(
        &mut conn,
        KIRACI_A,
        girdi("SORUMLULUK", 90000, None, &gun(150)),
    )
    .await
    .expect("polica");

    assert_eq!(
        polica.coverage_cents, None,
        "girilmemis teminat 0 olmamali, 'bilinmiyor' kalmali"
    );

    // Aynı bilgi veritabanında da NULL'dur.
    null_kolon_dogrula(&mut conn, KIRACI_A, "insurance_policies", "coverage_cents").await;
}

#[tokio::test]
async fn negatif_prim_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let hata = save_policy(&mut conn, KIRACI_A, girdi("SGK", -100, None, &gun(150)))
        .await
        .expect_err("negatif prim reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
    assert!(hata.contains("prim"), "{hata}");

    let hata = save_policy(
        &mut conn,
        KIRACI_A,
        girdi("SGK", 100, Some(-5000), &gun(150)),
    )
    .await
    .expect_err("negatif teminat reddedilmeli");
    assert!(hata.contains("teminat"), "{hata}");
}

#[tokio::test]
async fn gecersiz_polica_turu_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let hata = save_policy(&mut conn, KIRACI_A, girdi("HAYAT", 100, None, &gun(150)))
        .await
        .expect_err("gecersiz tur reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
    assert!(
        hata.contains("KASKO"),
        "hata secilebilir turleri saymali: {hata}"
    );
}

#[tokio::test]
async fn bite_tarihi_duzenlemeden_once_olamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let hata = save_policy(&mut conn, KIRACI_A, girdi("KASKO", 100, None, &gun(-400)))
        .await
        .expect_err("bitis onceki tarih reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn sirket_ve_numara_zorunludur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let mut sirket_yok = girdi("KASKO", 100, None, &gun(150));
    sirket_yok.insurance_company = "  ".to_string();
    let hata = save_policy(&mut conn, KIRACI_A, sirket_yok)
        .await
        .expect_err("bos sirket reddedilmeli");
    assert!(hata.contains("şirket"), "{hata}");

    let mut numara_yok = girdi("KASKO", 100, None, &gun(150));
    numara_yok.policy_number = String::new();
    let hata = save_policy(&mut conn, KIRACI_A, numara_yok)
        .await
        .expect_err("bos numara reddedilmeli");
    assert!(hata.contains("numara"), "{hata}");
}

#[tokio::test]
async fn suresi_dolan_policalar_penceresine_girer() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // 10 gün sonra dolan poliçe kendi 30 günlük hatırlatmasıyla pencerede.
    save_policy(&mut conn, KIRACI_A, girdi("ISYERI", 100000, None, &gun(10)))
        .await
        .expect("yakın poliçe");
    // 200 gün sonra dolan poliçe pencerede değil.
    save_policy(&mut conn, KIRACI_A, girdi("KASKO", 50000, None, &gun(200)))
        .await
        .expect("uzak poliçe");

    let expiring = get_expiring_policies(&mut conn, KIRACI_A, 30)
        .await
        .expect("suresi dolanlar okunmali");
    assert_eq!(expiring.len(), 1, "yalnizca yakin poliçe pencerede olmali");
    assert_eq!(expiring[0].policy_type, "ISYERI");
}

#[tokio::test]
async fn hatirlatma_penceresi_satir_bazli_calisir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // Kasko 60 gün sonra doluyor ama hatırlatma süresi 90 gün: 30 günlük
    // genel pencereye girmelidir çünkü satırın kendi süresi 90.
    let mut uzun_hatirlatma = girdi("KASKO", 50000, None, &gun(60));
    uzun_hatirlatma.reminder_days = Some(90);
    save_policy(&mut conn, KIRACI_A, uzun_hatirlatma)
        .await
        .expect("kasko");

    let expiring = get_expiring_policies(&mut conn, KIRACI_A, 30)
        .await
        .expect("pencerede");
    assert_eq!(
        expiring.len(),
        1,
        "genel pencere 30 gun olsa bile satirin 90 gunluk hatirlatmasi gecerli"
    );
}

#[tokio::test]
async fn bugun_dolan_police_gecmis_sayilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_policy(&mut conn, KIRACI_A, girdi("SGK", 400000, None, &bugun()))
        .await
        .expect("bugun dolan");

    let expiring = get_expiring_policies(&mut conn, KIRACI_A, 30)
        .await
        .expect("pencerede");
    assert_eq!(expiring.len(), 1, "bugun dolan prim yenilenmeli");
}

#[tokio::test]
async fn pencere_sinirlari_denenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    for pencere in [-1, 400] {
        let hata = get_expiring_policies(&mut conn, KIRACI_A, pencere)
            .await
            .expect_err("gecersiz pencere reddedilmeli");
        assert!(hata.starts_with("VALIDATION"), "{hata}");
    }
}

#[tokio::test]
async fn pasif_police_listeden_duser() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let polica = save_policy(&mut conn, KIRACI_A, girdi("ISYERI", 100, None, &gun(10)))
        .await
        .expect("polica");
    let mut pasif = girdi("ISYERI", 100, None, &gun(10));
    pasif.id = Some(polica.id.clone());
    pasif.is_active = Some(false);
    save_policy(&mut conn, KIRACI_A, pasif)
        .await
        .expect("pasiflestirilmeli");

    let expiring = get_expiring_policies(&mut conn, KIRACI_A, 30)
        .await
        .expect("pencerede");
    assert!(expiring.is_empty(), "pasif polica pencerede gorunmemeli");
}

#[tokio::test]
async fn tur_filtresi_calisir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_policy(&mut conn, KIRACI_A, girdi("ISYERI", 100, None, &gun(10)))
        .await
        .expect("isyeri");
    save_policy(&mut conn, KIRACI_A, girdi("kasko", 100, None, &gun(10)))
        .await
        .expect("kasko");

    let kaskolar = list_policies(&mut conn, KIRACI_A, Some("kasko"))
        .await
        .expect("filtreli liste");
    assert_eq!(kaskolar.len(), 1);
    assert_eq!(kaskolar[0].policy_type, "KASKO");
}

#[tokio::test]
async fn kiracilar_arasinda_polica_gorunmez_ve_duzenlenemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let polica = save_policy(&mut conn, KIRACI_A, girdi("ISYERI", 100000, None, &gun(10)))
        .await
        .expect("A polica");

    let b_liste = list_policies(&mut conn, KIRACI_B, None)
        .await
        .expect("B listesi");
    assert!(b_liste.is_empty(), "B, A'nin policesini gormemeli");

    let b_exp = get_expiring_policies(&mut conn, KIRACI_B, 30)
        .await
        .expect("B penceresi");
    assert!(b_exp.is_empty(), "B penceresinde A policesi olmamali");

    let mut saldirgan = girdi("KASKO", 1, None, &gun(5));
    saldirgan.id = Some(polica.id.clone());
    let hata = save_policy(&mut conn, KIRACI_B, saldirgan)
        .await
        .expect_err("B, A'nin policesini guncelleyememeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    let a_liste = list_policies(&mut conn, KIRACI_A, None)
        .await
        .expect("A listesi");
    assert_eq!(a_liste[0].premium_cents, 100000, "A polica bozulmamali");
    assert_eq!(a_liste[0].policy_type, "ISYERI");
}

#[tokio::test]
async fn toplam_prim_bos_isletmede_sifirdir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // Kayıt yoksa toplam gerçekten sıfırdır: burada `COALESCE` meşrudur.
    let toplam = total_premium_cents(&mut conn, KIRACI_B)
        .await
        .expect("toplam okunmali");
    assert_eq!(toplam, 0);
}

#[tokio::test]
async fn toplam_prim_kayitlari_toplar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_policy(
        &mut conn,
        KIRACI_A,
        girdi("ISYERI", 120000, None, &gun(200)),
    )
    .await
    .expect("birinci");
    save_policy(&mut conn, KIRACI_A, girdi("SGK", 400000, None, &gun(200)))
        .await
        .expect("ikinci");

    let toplam = total_premium_cents(&mut conn, KIRACI_A)
        .await
        .expect("toplam okunmali");
    assert_eq!(toplam, 520000, "primler toplanmali");

    // B'nin primi A'nın toplamına karışmamalı.
    save_policy(
        &mut conn,
        KIRACI_B,
        girdi("ISYERI", 999999, None, &gun(200)),
    )
    .await
    .expect("B polica");
    let a_toplam = total_premium_cents(&mut conn, KIRACI_A)
        .await
        .expect("A toplami");
    assert_eq!(a_toplam, 520000, "kiraci toplamlari birbirine karismamali");
}
