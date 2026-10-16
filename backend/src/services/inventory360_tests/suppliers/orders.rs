//! Satın alma siparişleri, FIFO partisi oluşturma ve kiracı tebliği testleri.

use sqlx::Row;

use super::super::support::*;
use super::comparison::{fiyat_girdisi, siparis_girdisi, tedarikci_girdisi};
use crate::services::inventory360::suppliers::*;

const T: &str = "tnt_1";
const T2: &str = "tnt_2";
const AKTOR: &str = "usr_1";

#[tokio::test]
async fn siparisi_teslim_almak_fifo_partisi_acar_ve_stogu_gunceller() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    let tedarikci = upsert_supplier(&mut conn, T, AKTOR, tedarikci_girdisi("Tedarikci"))
        .await
        .expect("tedarikci olusmali");

    let siparis = create_purchase_order(
        &mut conn,
        T,
        AKTOR,
        siparis_girdisi(&tedarikci.id, "prd_1", 10.0, Some(3800)),
    )
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
    let miktar: f64 = parti
        .try_get("remaining_quantity")
        .expect("miktar okunmali");
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
    set_supplier_product(
        &mut conn,
        T,
        fiyat_girdisi(&tedarikci.id, "prd_1", 3800, false),
    )
    .await
    .expect("fiyat yazilmali");

    // Çay için tedarikçi fiyatı girilmemiş: toplam sıfır çıkmasın diye reddedilir.
    let belirsiz = create_purchase_order(
        &mut conn,
        T,
        AKTOR,
        siparis_girdisi(&tedarikci.id, "prd_2", 10.0, None),
    )
    .await
    .expect_err("fiyati girilmemis kalem reddedilmeli");
    assert!(
        belirsiz.contains("girilmemiş"),
        "neden belirtilmeli: {belirsiz}"
    );

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
    assert!(
        bos_kalem.contains("kalem"),
        "neden belirtilmeli: {bos_kalem}"
    );

    let sifir_miktar = create_purchase_order(
        &mut conn,
        T,
        AKTOR,
        siparis_girdisi(&tedarikci.id, "prd_1", 0.0, Some(3800)),
    )
    .await
    .expect_err("sifir miktarli siparis reddedilmeli");
    assert!(
        sifir_miktar.contains("büyük"),
        "neden belirtilmeli: {sifir_miktar}"
    );

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
    assert!(
        bos_numara.contains("numarası"),
        "neden belirtilmeli: {bos_numara}"
    );
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
    set_supplier_product(
        &mut conn,
        T,
        fiyat_girdisi(&benim_tedarikci.id, &urun_a, 3800, false),
    )
    .await
    .expect("fiyat yazilmali");
    set_supplier_product(
        &mut conn,
        T2,
        fiyat_girdisi(&yabanci_tedarikci.id, &urun_b, 100, false),
    )
    .await
    .expect("fiyat yazilmali");

    let siparis = create_purchase_order(
        &mut conn,
        T,
        AKTOR,
        siparis_girdisi(&benim_tedarikci.id, &urun_a, 10.0, Some(3800)),
    )
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
    assert!(
        hirsizlik.contains("NOT_FOUND") || hirsizlik.contains("bulunam"),
        "neden: {hirsizlik}"
    );

    let sizinti = create_purchase_order(
        &mut conn,
        T2,
        AKTOR,
        siparis_girdisi(&yabanci_tedarikci.id, &urun_a, 5.0, Some(100)),
    )
    .await
    .expect_err("yabanci urun siparis kalemi olamamali");
    assert!(
        sizinti.contains("NOT_FOUND") || sizinti.contains("bulunam"),
        "neden: {sizinti}"
    );

    let fiyat_sizintisi = set_supplier_product(
        &mut conn,
        T2,
        fiyat_girdisi(&yabanci_tedarikci.id, &urun_a, 100, false),
    )
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
    assert_eq!(
        durum, "TASI",
        "basarisiz teblig siparis durumunu degistirmemeli"
    );
}
