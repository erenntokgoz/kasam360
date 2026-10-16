//! Tedarikçi oluşturma, fiyat karşılaştırması ve tercih testleri.

use super::super::support::*;
use crate::services::inventory360::suppliers::*;

const T: &str = "tnt_1";
const AKTOR: &str = "usr_1";

pub fn tedarikci_girdisi(ad: &str) -> SupplierInput {
    SupplierInput {
        id: None,
        name: ad.to_string(),
        contact_person: None,
        phone: None,
        email: None,
        tax_number: None,
        address: None,
        payment_term_days: Some(30),
        lead_time_days: Some(2),
        is_active: Some(true),
        notes: None,
    }
}

pub fn fiyat_girdisi(
    tedarikci: &str,
    urun: &str,
    birim_maliyet: i64,
    tercih: bool,
) -> SupplierProductInput {
    SupplierProductInput {
        supplier_id: tedarikci.to_string(),
        product_id: urun.to_string(),
        unit_cost_cents: birim_maliyet,
        min_order_quantity: Some(1.0),
        pack_size: None,
        is_preferred: Some(tercih),
    }
}

pub fn siparis_girdisi(
    tedarikci: &str,
    urun: &str,
    miktar: f64,
    birim_maliyet: Option<i64>,
) -> PurchaseOrderInput {
    PurchaseOrderInput {
        supplier_id: tedarikci.to_string(),
        order_number: "PO-1".to_string(),
        expected_at: None,
        notes: None,
        items: vec![PurchaseOrderLineInput {
            product_id: urun.to_string(),
            quantity: miktar,
            unit_cost_cents: birim_maliyet,
        }],
    }
}

#[tokio::test]
async fn fiyat_karsilastirmasi_en_ucuzu_isaretler_ve_farki_hesaplar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;

    let ucuz = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Ucuz"))
        .await
        .expect("tedarikci olusmali");
    let pahali = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Pahali"))
        .await
        .expect("tedarikci olusmali");

    set_supplier_product(
        &mut conn,
        T,
        fiyat_girdisi(&pahali.id, "prd_1", 4200, false),
    )
    .await
    .expect("fiyat yazilmali");
    set_supplier_product(&mut conn, T, fiyat_girdisi(&ucuz.id, "prd_1", 3800, false))
        .await
        .expect("fiyat yazilmali");

    let karsilastirma = compare_supplier_prices(&mut conn, T, "prd_1", Some(1200.0))
        .await
        .expect("karsilastirma calismali");

    assert_eq!(karsilastirma.compared_count, 2);
    assert_eq!(
        karsilastirma.cheapest_supplier_id.as_deref(),
        Some(ucuz.id.as_str())
    );
    assert_eq!(karsilastirma.cheapest_unit_cost_cents, Some(3800));
    assert_eq!(karsilastirma.rows.len(), 2, "fiyata gore siralanmali");
    assert_eq!(karsilastirma.rows[0].supplier_name, "Ucuz");

    // En ucuzun farkı kendine göre gerçek bir sıfırdır; "bilinmiyor" değil.
    assert_eq!(karsilastirma.rows[0].premium_over_cheapest_cents, Some(0));
    assert_eq!(karsilastirma.rows[0].yearly_saving_cents, Some(0));

    let fark = karsilastirma.rows[1].premium_over_cheapest_cents;
    assert_eq!(fark, Some(400), "pahali tedarikcinin farki hesaplanmali");
    // 400 kuruş × 1200 adet = 480.000 kuruş yıllık fark.
    assert_eq!(karsilastirma.rows[1].yearly_saving_cents, Some(480_000));
}

#[tokio::test]
async fn fiyati_girilmemis_tedarikci_karsilastirmaya_girmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;

    let fiyatlı = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Fiyatli"))
        .await
        .expect("tedarikci olusmali");
    upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Fiyatsiz"))
        .await
        .expect("tedarikci olusmali");
    set_supplier_product(
        &mut conn,
        T,
        fiyat_girdisi(&fiyatlı.id, "prd_1", 3800, false),
    )
    .await
    .expect("fiyat yazilmali");

    let karsilastirma = compare_supplier_prices(&mut conn, T, "prd_1", None)
        .await
        .expect("karsilastirma calismali");

    assert_eq!(karsilastirma.compared_count, 1);
    assert_eq!(karsilastirma.missing_price_count, 1);
    assert_eq!(
        karsilastirma.missing_price_suppliers,
        vec!["Fiyatsiz".to_string()],
        "fiyati girilmemis tedarikci raporda gorunmeli"
    );
    assert_eq!(karsilastirma.cheapest_unit_cost_cents, Some(3800));

    // Hacim bilinmiyken yıllık tasarruf uydurulmaz.
    for satir in &karsilastirma.rows {
        assert_eq!(
            satir.yearly_saving_cents, None,
            "hacim bilinmiyken tasarruf hesaplanmamali"
        );
    }

    // Hiçbir tedarikçide fiyat yoksa "en ucuz" bilinmiyordur, sıfır değil.
    urun_ekle(&mut conn, T, "prd_2", "Çay", 1500).await;
    let boses = compare_supplier_prices(&mut conn, T, "prd_2", Some(100.0))
        .await
        .expect("karsilastirma calismali");
    assert_eq!(boses.compared_count, 0);
    assert_eq!(boses.cheapest_unit_cost_cents, None);
    assert_ne!(
        boses.cheapest_unit_cost_cents,
        Some(0),
        "sifir fiyat uydurulmamali"
    );
    assert_eq!(boses.cheapest_supplier_id, None);
}

#[tokio::test]
async fn negatif_alis_fiyati_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    let tedarikci = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Tedarikci"))
        .await
        .expect("tedarikci olusmali");

    let negatif = set_supplier_product(
        &mut conn,
        T,
        fiyat_girdisi(&tedarikci.id, "prd_1", -100, false),
    )
    .await
    .expect_err("negatif alis fiyati reddedilmeli");
    assert!(negatif.contains("negatif"), "neden belirtilmeli: {negatif}");

    let sifir_miktar = set_supplier_product(
        &mut conn,
        T,
        SupplierProductInput {
            min_order_quantity: Some(0.0),
            ..fiyat_girdisi(&tedarikci.id, "prd_1", 3800, false)
        },
    )
    .await
    .expect_err("sifir minimum siparis miktari reddedilmeli");
    assert!(
        sifir_miktar.contains("büyük"),
        "neden belirtilmeli: {sifir_miktar}"
    );

    let negatif_vade = upsert_supplier(
        &mut conn,
        T,
        AKTOR,
        SupplierInput {
            payment_term_days: Some(-1),
            ..tedarikci_girdisi("Negatif Vade")
        },
    )
    .await
    .expect_err("negatif vade reddedilmeli");
    assert!(
        negatif_vade.contains("negatif"),
        "neden belirtilmeli: {negatif_vade}"
    );

    let sayi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM supplier_products")
        .fetch_one(&mut conn)
        .await
        .expect("sorgu calismali");
    assert_eq!(sayi, 0, "reddedilen fiyat yazilmamali");

    // Sipariş kalemindeki negatif fiyat da reddedilir: sipariş anındaki fiyat
    // güvenilir kabul edilir.
    set_supplier_product(
        &mut conn,
        T,
        fiyat_girdisi(&tedarikci.id, "prd_1", 3800, false),
    )
    .await
    .expect("fiyat yazilmali");
    let siparis = create_purchase_order(
        &mut conn,
        T,
        AKTOR,
        siparis_girdisi(&tedarikci.id, "prd_1", 5.0, Some(-50)),
    )
    .await
    .expect_err("siparis kaleminde negatif fiyat reddedilmeli");
    assert!(siparis.contains("negatif"), "neden belirtilmeli: {siparis}");
}

#[tokio::test]
async fn tercih_edilen_tedarikci_tekildir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;

    let bir = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Bir"))
        .await
        .expect("tedarikci olusmali");
    let iki = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("İki"))
        .await
        .expect("tedarikci olusmali");

    set_supplier_product(&mut conn, T, fiyat_girdisi(&bir.id, "prd_1", 3900, true))
        .await
        .expect("fiyat yazilmali");
    set_supplier_product(&mut conn, T, fiyat_girdisi(&iki.id, "prd_1", 3800, true))
        .await
        .expect("fiyat yazilmali");

    // İki tercih edilen tedarikçi hangisinin kullanılacağını belirsizleştirir.
    let tercih_sayisi: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM supplier_products WHERE tenant_id = 'tnt_1' AND is_preferred = 1",
    )
    .fetch_one(&mut conn)
    .await
    .expect("sorgu calismali");
    assert_eq!(tercih_sayisi, 1, "urun basina tek tercih edilen olmali");

    let karsilastirma = compare_supplier_prices(&mut conn, T, "prd_1", None)
        .await
        .expect("karsilastirma calismali");
    let tercihli = karsilastirma
        .rows
        .iter()
        .find(|satir| satir.is_preferred)
        .expect("tercih edilen satir gorunmeli");
    assert_eq!(tercihli.supplier_id, iki.id);
}
