//! Faz 12 · Tedarikçi ve satın alma testleri.
//!
//! Kapsam: tedarikçi fiyat karşılaştırmasının en ucuzu işaretlemesi, negatif
//! alış fiyatının reddi, teslim almanın FIFO partisi açması, fiyatı girilmemiş
//! kalemin reddi ve çapraz kiracı tebliğ yazamaması.

use sqlx::Row;

use super::support::*;
use crate::services::inventory360::suppliers::*;

const T: &str = "tnt_1";
const T2: &str = "tnt_2";
const AKTOR: &str = "usr_1";

fn tedarikci_girdisi(ad: &str) -> SupplierInput {
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

fn fiyat_girdisi(
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

fn siparis_girdisi(
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

    set_supplier_product(&mut conn, T, fiyat_girdisi(&pahali.id, "prd_1", 4200, false))
        .await
        .expect("fiyat yazilmali");
    set_supplier_product(&mut conn, T, fiyat_girdisi(&ucuz.id, "prd_1", 3800, false))
        .await
        .expect("fiyat yazilmali");

    let karsilastirma = compare_supplier_prices(&mut conn, T, "prd_1", Some(1200.0))
        .await
        .expect("karsilastirma calismali");

    assert_eq!(karsilastirma.compared_count, 2);
    assert_eq!(karsilastirma.cheapest_supplier_id.as_deref(), Some(ucuz.id.as_str()));
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
    set_supplier_product(&mut conn, T, fiyat_girdisi(&fiyatlı.id, "prd_1", 3800, false))
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
    assert_ne!(boses.cheapest_unit_cost_cents, Some(0), "sifir fiyat uydurulmamali");
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

    let negatif = set_supplier_product(&mut conn, T, fiyat_girdisi(&tedarikci.id, "prd_1", -100, false))
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
    assert!(sifir_miktar.contains("büyük"), "neden belirtilmeli: {sifir_miktar}");

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
    assert!(negatif_vade.contains("negatif"), "neden belirtilmeli: {negatif_vade}");

    let sayi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM supplier_products")
        .fetch_one(&mut conn)
        .await
        .expect("sorgu calismali");
    assert_eq!(sayi, 0, "reddedilen fiyat yazilmamali");

    // Sipariş kalemindeki negatif fiyat da reddedilir: sipariş anındaki fiyat
    // güvenilir kabul edilir.
    set_supplier_product(&mut conn, T, fiyat_girdisi(&tedarikci.id, "prd_1", 3800, false))
        .await
        .expect("fiyat yazilmali");
    let siparis = create_purchase_order(&mut conn, T, AKTOR, siparis_girdisi(&tedarikci.id, "prd_1", 5.0, Some(-50)))
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

#[tokio::test]
async fn siparisi_teslim_almak_fifo_partisi_acar_ve_stogu_gunceller() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    let tedarikci = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Tedarikci"))
        .await
        .expect("tedarikci olusmali");

    let siparis = create_purchase_order(&mut conn, T, AKTOR, siparis_girdisi(&tedarikci.id, "prd_1", 10.0, Some(3800)))
        .await
        .expect("siparis acilmali");
    assert_eq!(siparis.status, "TASI");
    assert_eq!(siparis.total_cents, 38_000);

    let maliyet = receive_purchase_order(&mut conn, T, &siparis.id)
        .await
        .expect("siparis alinmali");
    assert_eq!(maliyet, 38_000);

    // Teslim bir FIFO partisi açar: parti stoğu ve birim maliyeti kaynağıdır.
    let parti = sqlx::query(
        "SELECT remaining_quantity, unit_cost_cents FROM inventory_batches
          WHERE tenant_id = 'tnt_1' AND product_id = 'prd_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("parti acilmali");
    let miktar: f64 = parti.try_get("remaining_quantity").expect("miktar okunmali");
    let birim: i64 = parti.try_get("unit_cost_cents").expect("maliyet okunmali");
    assert_eq!(miktar, 10.0);
    assert_eq!(birim, 3800);

    let stok = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT stock_quantity FROM products WHERE id = 'prd_1' AND tenant_id = 'tnt_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("urun okunmali");
    assert_eq!(stok, Some(10), "stok teslim miktari kadar artmali");

    let durum: String = sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ?")
        .bind(&siparis.id)
        .fetch_one(&mut conn)
        .await
        .expect("siparis okunmali");
    assert_eq!(durum, "ALINDI");

    // Sipariş iki kez alınamaz: aynı mal iki kez stoğa giremezdi.
    let ikinci = receive_purchase_order(&mut conn, T, &siparis.id)
        .await
        .expect_err("alinmis siparis tekrar alinamamali");
    assert!(ikinci.contains("CONFLICT"), "neden belirtilmeli: {ikinci}");

    let parti_sayisi: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inventory_batches WHERE product_id = 'prd_1'")
            .fetch_one(&mut conn)
            .await
            .expect("sorgu calismali");
    assert_eq!(parti_sayisi, 1, "ikinci teslimde yeni parti acilmamali");
}

#[tokio::test]
async fn fiyati_girilmemis_kalemli_siparis_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    urun_ekle(&mut conn, T, "prd_2", "Çay", 1500).await;
    let tedarikci = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Tedarikci"))
        .await
        .expect("tedarikci olusmali");
    set_supplier_product(&mut conn, T, fiyat_girdisi(&tedarikci.id, "prd_1", 3800, false))
        .await
        .expect("fiyat yazilmali");

    // Çay için tedarikçi fiyatı girilmemiş: toplam sıfır çıkmasın diye reddedilir.
    let belirsiz = create_purchase_order(&mut conn, T, AKTOR, siparis_girdisi(&tedarikci.id, "prd_2", 10.0, None))
        .await
        .expect_err("fiyati girilmemis kalem reddedilmeli");
    assert!(belirsiz.contains("girilmemiş"), "neden belirtilmeli: {belirsiz}");

    let baslik_sayisi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM purchase_orders")
        .fetch_one(&mut conn)
        .await
        .expect("sorgu calismali");
    assert_eq!(baslik_sayisi, 0, "reddedilen siparisin basligi yazilmamali");

    let bos_kalem = create_purchase_order(
        &mut conn,
        T,
        AKTOR,
        PurchaseOrderInput {
            supplier_id: tedarikci.id.clone(),
            order_number: "PO-2".to_string(),
            expected_at: None,
            notes: None,
            items: Vec::new(),
        },
    )
    .await
    .expect_err("kalemsiz siparis reddedilmeli");
    assert!(bos_kalem.contains("kalem"), "neden belirtilmeli: {bos_kalem}");

    let sifir_miktar = create_purchase_order(
        &mut conn,
        T,
        AKTOR,
        siparis_girdisi(&tedarikci.id, "prd_1", 0.0, Some(3800)),
    )
    .await
    .expect_err("sifir miktarli siparis reddedilmeli");
    assert!(sifir_miktar.contains("büyük"), "neden belirtilmeli: {sifir_miktar}");

    let bos_numara = create_purchase_order(
        &mut conn,
        T,
        AKTOR,
        PurchaseOrderInput {
            order_number: "   ".to_string(),
            ..siparis_girdisi(&tedarikci.id, "prd_1", 5.0, Some(3800))
        },
    )
    .await
    .expect_err("bos siparis numarasi reddedilmeli");
    assert!(bos_numara.contains("numarası"), "neden belirtilmeli: {bos_numara}");
}

#[tokio::test]
async fn siparisi_teblig_eden_baska_kiraci_yazamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let (urun_a, urun_b) = iki_kiracili_urun(&mut conn, "prd_kahve", [T, T2]).await;

    let benim_tedarikci = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Benim"))
        .await
        .expect("tedarikci olusmali");
    let yabanci_tedarikci = upsert_supplier(&mut conn, T2, AKTOR, tedarikci_girdisi("Yabancı"))
        .await
        .expect("tedarikci olusmali");

    // Her işletme kendi ürününe kendi tedarikçi fiyatını yazar.
    set_supplier_product(&mut conn, T, fiyat_girdisi(&benim_tedarikci.id, &urun_a, 3800, false))
        .await
        .expect("fiyat yazilmali");
    set_supplier_product(&mut conn, T2, fiyat_girdisi(&yabanci_tedarikci.id, &urun_b, 100, false))
        .await
        .expect("fiyat yazilmali");

    let siparis = create_purchase_order(&mut conn, T, AKTOR, siparis_girdisi(&benim_tedarikci.id, &urun_a, 10.0, Some(3800)))
        .await
        .expect("siparis acilmali");

    // Yabancı işletmenin kendi ürününde kendi fiyatı geçerli; bizim ürünümüzde
    // yabancı tedarikçinin 100 kuruşluk fiyatı görünmemeli.
    let benim = compare_supplier_prices(&mut conn, T, &urun_a, None)
        .await
        .expect("karsilastirma calismali");
    assert_eq!(benim.cheapest_unit_cost_cents, Some(3800));
    assert_eq!(benim.compared_count, 1);

    let yabanci = compare_supplier_prices(&mut conn, T2, &urun_b, None)
        .await
        .expect("karsilastirma calismali");
    assert_eq!(yabanci.cheapest_unit_cost_cents, Some(100));

    // Yabancı işletme bizim siparişimizi alamaz, bizim ürünümüze fiyat yazamaz.
    let hirsizlik = receive_purchase_order(&mut conn, T2, &siparis.id)
        .await
        .expect_err("yabanci siparis teslim alamamamali");
    assert!(hirsizlik.contains("NOT_FOUND") || hirsizlik.contains("bulunam"), "neden: {hirsizlik}");

    let sizinti = create_purchase_order(&mut conn, T2, AKTOR, siparis_girdisi(&yabanci_tedarikci.id, &urun_a, 5.0, Some(100)))
        .await
        .expect_err("yabanci urun siparis kalemi olamamali");
    assert!(sizinti.contains("NOT_FOUND") || sizinti.contains("bulunam"), "neden: {sizinti}");

    let fiyat_sizintisi = set_supplier_product(&mut conn, T2, fiyat_girdisi(&yabanci_tedarikci.id, &urun_a, 100, false))
        .await
        .expect_err("yabanci urune fiyat yazilamamali");
    assert!(
        fiyat_sizintisi.contains("NOT_FOUND") || fiyat_sizintisi.contains("bulunam"),
        "neden: {fiyat_sizintisi}"
    );

    let durum: String = sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ?")
        .bind(&siparis.id)
        .fetch_one(&mut conn)
        .await
        .expect("siparis okunmali");
    assert_eq!(durum, "TASI", "basarisiz teblig siparis durumunu degistirmemeli");
}