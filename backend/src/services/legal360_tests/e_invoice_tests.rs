//! e-Arşiv testleri: KDV aritmetiği, durum makinesi, kiracı izolasyonu.
//!
//! KDV hesabının kilit testi **değişmezdir**: `matrah + kdv == toplam`.
//! Geri çözüm yerine ileri hesap kullanılsaydı bu eşitlik her faturada birkaç
//! kuruş bozulur ve kayıt ile gönderilen belge arasındaki fark denetimde
//! yakalanırdı.

use super::support::{conn_of, siparis_ekle, test_pool, KIRACI_A, KIRACI_B};
use crate::services::legal360::e_invoice::{
    cancel_e_invoice, generate_e_invoice, get_e_invoice, kdv_hesapla, list_e_invoices,
    mark_e_invoice_accepted, mark_e_invoice_rejected, mark_e_invoice_sent, pending_count,
    EInvoiceInput,
};

fn girdi(siparis: &str, oran: i64) -> EInvoiceInput {
    EInvoiceInput {
        order_id: siparis.to_string(),
        kdv_rate_percent: oran,
        invoice_number: None,
    }
}

#[test]
fn kdv_yuzde10_geri_cozumle_hesaplanir() {
    // 1100 kuruş + %10 KDV => matrah 1000, KDV 100.
    let (kdv, matrah) = kdv_hesapla(1100, 10).expect("hesaplanmali");
    assert_eq!(matrah, 1000);
    assert_eq!(kdv, 100);
    assert_eq!(matrah + kdv, 1100, "matrah ve kdv toplami tutari vermeli");
}

#[test]
fn kdv_yuzde1_ve_20_ile_de_ayisiz_calisir() {
    for (toplam, oran, matrah_beklenen, kdv_beklenen) in [
        (101i64, 1i64, 100i64, 1i64),
        (1200, 20, 1000, 200),
        (55, 10, 50, 5),
        (0, 20, 0, 0),
    ] {
        let (kdv, matrah) = kdv_hesapla(toplam, oran).expect("hesaplanmali");
        assert_eq!(matrah, matrah_beklenen, "{toplam} @ %{oran} matrah");
        assert_eq!(kdv, kdv_beklenen, "{toplam} @ %{oran} kdv");
        assert_eq!(matrah + kdv, toplam, "{toplam} @ %{oran} toplam korunmali");
    }
}

#[test]
fn gecersiz_kdv_orani_reddedilir() {
    for oran in [0i64, 5, 18, 25, -10, 100] {
        let hata = kdv_hesapla(1000, oran).expect_err("gecersiz oran reddedilmeli");
        assert!(hata.starts_with("VALIDATION"), "oran {oran}: {hata}");
        assert!(
            hata.contains("1, 10, 20"),
            "hata gecerli oranlari saymali: {hata}"
        );
    }
}

#[test]
fn negatif_tutar_reddedilir() {
    let hata = kdv_hesapla(-100, 10).expect_err("negatif tutar reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn siparisten_fatura_uretilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_001", 11000).await;

    let fatura = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_001", 10))
        .await
        .expect("fatura uretilmeli");

    assert!(fatura.id.starts_with("ear_"), "{}", fatura.id);
    assert_eq!(fatura.status, "PENDING");
    assert_eq!(fatura.total_cents, 11000);
    assert_eq!(fatura.matrah_cents, 10000);
    assert_eq!(fatura.kdv_cents, 1000);
    assert_eq!(
        fatura.matrah_cents + fatura.kdv_cents,
        fatura.total_cents,
        "matrah + KDV siparis tutarina esit olmali"
    );
    assert!(
        fatura.invoice_number.is_some(),
        "fatura numarasi turetilmeli"
    );
}

#[tokio::test]
async fn fatura_numarasi_siparis_kimliginden_turetilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_002", 5000).await;

    let fatura = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_002", 20))
        .await
        .expect("fatura");
    assert_eq!(
        fatura.invoice_number.as_deref(),
        Some("EARS-ord_002"),
        "numara elle verilmedigi icin siparisten turemeli"
    );
}

#[tokio::test]
async fn elle_verilen_fatura_numarasi_kullanilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_003", 5000).await;

    let mut veri = girdi("ord_003", 10);
    veri.invoice_number = Some("EAR-2026-0001".to_string());
    let fatura = generate_e_invoice(&mut conn, KIRACI_A, veri)
        .await
        .expect("fatura");
    assert_eq!(fatura.invoice_number.as_deref(), Some("EAR-2026-0001"));
}

#[tokio::test]
async fn ayni_siparis_icin_ikinci_fatura_uretilemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_004", 5000).await;

    generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_004", 10))
        .await
        .expect("ilk fatura");
    let hata = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_004", 10))
        .await
        .expect_err("ayni siparis icin ikinci e-Arsiv kaydi reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn bilinmeyen_siparis_icin_sifir_fatura_uretilmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let hata = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_yok", 10))
        .await
        .expect_err("bilinmeyen siparis reddedilmeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    // Sıfır tutarlı fatura üretilmediğini doğrula: kuyruk boş kalmalı.
    assert_eq!(
        pending_count(&mut conn, KIRACI_A).await.expect("sayim"),
        0,
        "bulunmayan siparis icin sifir tutarli fatura olusmamali"
    );
}

#[tokio::test]
async fn gecersiz_kdv_orani_fatura_uretmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_005", 5000).await;

    for oran in [0i64, 18, 25] {
        let hata = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_005", oran))
            .await
            .expect_err("gecersiz oran reddedilmeli");
        assert!(hata.starts_with("VALIDATION"), "{hata}");
    }
    assert_eq!(
        pending_count(&mut conn, KIRACI_A).await.expect("sayim"),
        0,
        "gecersiz oranla kuyruga satir girmemeli"
    );
}

#[tokio::test]
async fn bos_siparis_kimligi_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let hata = generate_e_invoice(&mut conn, KIRACI_A, girdi("   ", 10))
        .await
        .expect_err("bos siparis kimligi reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn durum_makinesi_gonder_kabul_akisi_isler() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_006", 12000).await;

    let fatura = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_006", 20))
        .await
        .expect("fatura");

    let gonderilen = mark_e_invoice_sent(&mut conn, KIRACI_A, &fatura.id)
        .await
        .expect("gonderilmeli");
    assert_eq!(gonderilen.status, "SENT");
    assert!(gonderilen.sent_at.is_some(), "gonderim zamani islenmeli");

    let kabul = mark_e_invoice_accepted(
        &mut conn,
        KIRACI_A,
        &fatura.id,
        Some("GIB-2026-OK".to_string()),
    )
    .await
    .expect("kabul edilmeli");
    assert_eq!(kabul.status, "ACCEPTED");
    assert_eq!(kabul.response.as_deref(), Some("GIB-2026-OK"));
}

#[tokio::test]
async fn reddedilmis_fatura_durumu_kaydedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_007", 12000).await;

    let fatura = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_007", 20))
        .await
        .expect("fatura");
    mark_e_invoice_sent(&mut conn, KIRACI_A, &fatura.id)
        .await
        .expect("gonderilmeli");

    let red = mark_e_invoice_rejected(
        &mut conn,
        KIRACI_A,
        &fatura.id,
        Some("veri hatasi".to_string()),
    )
    .await
    .expect("reddedilmeli");
    assert_eq!(red.status, "REJECTED");
    assert_eq!(red.response.as_deref(), Some("veri hatasi"));
}

#[tokio::test]
async fn gecersiz_durum_gecisi_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_008", 12000).await;

    let fatura = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_008", 10))
        .await
        .expect("fatura");

    // PENDING olan kayıt doğrudan kabul edilemez: gönderilmemiş.
    let hata = mark_e_invoice_accepted(&mut conn, KIRACI_A, &fatura.id, None)
        .await
        .expect_err("PENDING -> ACCEPTED gecisi reddedilmeli");
    assert!(hata.starts_with("DURUM_GECERSIZ"), "{hata}");

    // İki kez gönderilemez.
    mark_e_invoice_sent(&mut conn, KIRACI_A, &fatura.id)
        .await
        .expect("gonderilmeli");
    let hata = mark_e_invoice_sent(&mut conn, KIRACI_A, &fatura.id)
        .await
        .expect_err("SENT -> SENT gecisi reddedilmeli");
    assert!(hata.starts_with("DURUM_GECERSIZ"), "{hata}");

    // Reddedilen durumun kaydı bozulmamalı.
    assert_eq!(
        get_e_invoice(&mut conn, KIRACI_A, &fatura.id)
            .await
            .expect("okunmali")
            .status,
        "SENT"
    );
}

#[tokio::test]
async fn kabul_edilmis_fatura_iptal_edilemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_009", 12000).await;

    let fatura = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_009", 10))
        .await
        .expect("fatura");
    mark_e_invoice_sent(&mut conn, KIRACI_A, &fatura.id)
        .await
        .expect("gonderilmeli");
    mark_e_invoice_accepted(&mut conn, KIRACI_A, &fatura.id, None)
        .await
        .expect("kabul");

    let hata = cancel_e_invoice(&mut conn, KIRACI_A, &fatura.id, None)
        .await
        .expect_err("kabul edilmis fatura iptal edilememeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn bekleyen_fatura_iptal_edilir_ve_tekrar_uretilebilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_010", 12000).await;

    let fatura = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_010", 10))
        .await
        .expect("fatura");
    let iptal = cancel_e_invoice(
        &mut conn,
        KIRACI_A,
        &fatura.id,
        Some("müşteri iptali".into()),
    )
    .await
    .expect("iptal edilmeli");
    assert_eq!(iptal.status, "CANCELLED");

    // İptal edilen kayıt aynı siparişte yeniden üretime izin verir: aynı satış
    // beyan edilmemiş kalır.
    let yeni = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_010", 10))
        .await
        .expect("iptalden sonra yeniden uretilmeli");
    assert_ne!(
        yeni.id, fatura.id,
        "yeni kayit eskisinin uzerine yazilmamali"
    );
    assert_eq!(pending_count(&mut conn, KIRACI_A).await.expect("sayim"), 1);
}

#[tokio::test]
async fn kiracilar_arasinda_fatura_gorunmez_ve_durumu_degistirilemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_011", 12000).await;

    let fatura = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_011", 10))
        .await
        .expect("A faturası");

    let hata = get_e_invoice(&mut conn, KIRACI_B, &fatura.id)
        .await
        .expect_err("B, A'nin faturasini gormemeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    let b_liste = list_e_invoices(&mut conn, KIRACI_B, None)
        .await
        .expect("B listesi");
    assert!(b_liste.is_empty(), "B listesinde A faturasi olmamali");

    let hata = mark_e_invoice_sent(&mut conn, KIRACI_B, &fatura.id)
        .await
        .expect_err("B, A'nin faturasini gonderememeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    let hata = generate_e_invoice(&mut conn, KIRACI_B, girdi("ord_011", 10))
        .await
        .expect_err("B, A'nin siparisinden fatura uretememeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    // A'nın kaydı hâlâ PENDING.
    assert_eq!(
        get_e_invoice(&mut conn, KIRACI_A, &fatura.id)
            .await
            .expect("okunmali")
            .status,
        "PENDING"
    );
}

#[tokio::test]
async fn durum_filtresi_ve_bekleyen_sayimi_calisir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_012", 5000).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_013", 6000).await;

    let bir = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_012", 10))
        .await
        .expect("birinci");
    generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_013", 20))
        .await
        .expect("ikinci");
    mark_e_invoice_sent(&mut conn, KIRACI_A, &bir.id)
        .await
        .expect("gonderilmeli");

    assert_eq!(pending_count(&mut conn, KIRACI_A).await.expect("sayim"), 1);
    assert_eq!(
        pending_count(&mut conn, KIRACI_B).await.expect("sayim"),
        0,
        "B'nin bekleyen faturasi olmamali"
    );

    let bekleyenler = list_e_invoices(&mut conn, KIRACI_A, Some("pending"))
        .await
        .expect("filtreli liste");
    assert_eq!(
        bekleyenler.len(),
        1,
        "durum filtresi kucuk harf de kabul etmeli"
    );
    assert_eq!(bekleyenler[0].order_id.as_deref(), Some("ord_013"));
}

#[tokio::test]
async fn sifir_tutarli_siparis_faturasi_uretilir_ama_sessiz_hata_yoktur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    siparis_ekle(&mut conn, KIRACI_A, "ord_sifir", 0).await;

    let fatura = generate_e_invoice(&mut conn, KIRACI_A, girdi("ord_sifir", 10))
        .await
        .expect("sifir tutarli siparis icin fatura uretilmeli");

    // Buradaki 0 bir **gerçek sıfır**tır (sipariş tutarı 0), hata değil: KDV
    // de 0 olmalı ve bu tutarlıdır.
    assert_eq!(fatura.total_cents, 0);
    assert_eq!(fatura.kdv_cents, 0);
    assert_eq!(fatura.matrah_cents, 0);
}
