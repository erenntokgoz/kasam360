//! Fire ve kör sayım testleri.
//!
//! Kapsam: FIFO'dan düşen gerçek maliyet, stoğu aşan firede bilinmeyen maliyet,
//! geçersiz gerekçenin reddi, kör sayımda beklenen miktarın gizlenmesi, kapanışta
//! fark hesabı, beklenen miktarın bilinmediği durum ve çapraz kiracı reddi.
//!
//! Fire kaydının varlık sebebi gerekçesini taşımasıdır: zararın nedeni
//! görülmeden önlem alınamaz. Kör sayımın varlık sebebi ise beklenen miktarın
//! sayım sırasında **görünmemesidir**.

use sqlx::Row;

use super::support::*;
use crate::services::inventory360::waste::*;

const T: &str = "tnt_1";
const T2: &str = "tnt_2";
const AKTOR: &str = "usr_1";

fn fire_girdisi(urun_id: &str, gerekce: &str, miktar: f64) -> WasteInput {
    WasteInput {
        product_id: urun_id.to_string(),
        reason: gerekce.to_string(),
        quantity: miktar,
        occurred_at: None,
        notes: None,
    }
}

#[tokio::test]
async fn fire_fifo_dusur_ve_gercek_maliyeti_yazar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_eski", "prd_1", 5.0, 3000, None).await;
    parti_ekle(&mut conn, T, "bat_yeni", "prd_1", 10.0, 4000, None).await;

    let kayit = record_waste(&mut conn, T, AKTOR, fire_girdisi("prd_1", "BOZULDU", 8.0))
        .await
        .expect("fire kaydedilmeli");

    // Maliyet partilerden gelir, ortalamadan değil: 5 × 3000 + 3 × 4000 = 27.000.
    assert_eq!(kayit.total_cost_cents, Some(27_000));
    assert_eq!(kayit.unit_cost_cents, Some(3375));
    assert_eq!(kayit.reason, "BOZULDU");
    assert_eq!(kayit.recorded_by, AKTOR);
    assert_eq!(kayit.notes, None, "tam karşılanan fire uyarı taşımamali");

    let eski = sqlx::query_scalar::<_, f64>(
        "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_eski'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("parti okunmali");
    let yeni = sqlx::query_scalar::<_, f64>(
        "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_yeni'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("parti okunmali");
    assert_eq!(eski, 0.0, "en eski parti once tuketilmeli");
    assert_eq!(yeni, 7.0);

    let stok = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT stock_quantity FROM products WHERE id = 'prd_1' AND tenant_id = 'tnt_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("urun okunmali");
    assert_eq!(stok, None, "fire yalnız FIFO partilerini değiştirmeli");
}

#[tokio::test]
async fn stoktan_fazla_fire_maliyeti_bilinmiyor_olarak_isaretlenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_1", "prd_1", 5.0, 3000, None).await;

    // Parti olmayan üründe fire: maliyet hesaplanamaz.
    urun_ekle(&mut conn, T, "prd_2", "Çay", 1500).await;
    let partsiz = record_waste(&mut conn, T, AKTOR, fire_girdisi("prd_2", "KIRILDI", 2.0))
        .await
        .expect("fire kaydedilmeli");
    assert_eq!(partsiz.total_cost_cents, None);
    assert_eq!(partsiz.unit_cost_cents, None);
    assert_ne!(
        partsiz.total_cost_cents,
        Some(0),
        "maliyet bilinmiyorsa sifir yazilmamali"
    );

    // Stoğu aşan fire: kısmen karşılanır, kalan miktarın maliyeti bilinmez.
    let asim = record_waste(&mut conn, T, AKTOR, fire_girdisi("prd_1", "BOZULDU", 10.0))
        .await
        .expect("fire kaydedilmeli");
    assert_eq!(asim.total_cost_cents, None);
    assert_eq!(asim.unit_cost_cents, None);
    let uyari = asim.notes.unwrap_or_default();
    assert!(
        uyari.contains("UYARI") && uyari.contains("karşılanamadı"),
        "stoktan fazla fire raporlanmali: {uyari}"
    );

    let kayitlar = list_waste_records(&mut conn, T, None)
        .await
        .expect("kayitlar okunmali");
    assert_eq!(kayitlar.len(), 2);
    // Sıralama zaman damgasına göre; hangisinin önce olduğuna değil, ikisinin de
    // raporda bulunduğuna bakılır.
    let adlar: Vec<&str> = kayitlar.iter().map(|k| k.product_name.as_str()).collect();
    assert!(
        adlar.contains(&"Çay") && adlar.contains(&"Süt"),
        "kayitlar eksik: {adlar:?}"
    );

    nullable_kolon_dogrula(&mut conn, T).await;
}

#[tokio::test]
async fn gecersiz_fire_gerekcesi_ve_miktari_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_1", "prd_1", 5.0, 3000, None).await;

    let gerekce = record_waste(
        &mut conn,
        T,
        AKTOR,
        fire_girdisi("prd_1", "BILINMIYOR", 1.0),
    )
    .await
    .expect_err("gecersiz gerekce reddedilmeli");
    assert!(
        gerekce.contains("geçersiz"),
        "izin verilenler yazilmali: {gerekce}"
    );

    // Frontend'in gönderdiği gerekçeler backend kümesinde yok: sözleşme
    // ayrışması sessiz kalmamalı, hata mesajı izin verilenleri listeler.
    for uyumsuz in ["BOZULMA", "SURE", "KIRILMA", "DIGER"] {
        let hata = record_waste(&mut conn, T, AKTOR, fire_girdisi("prd_1", uyumsuz, 1.0))
            .await
            .expect_err("sozlesme disi gerekce reddedilmeli");
        assert!(
            hata.contains("BOZULDU"),
            "izin verilenler yazilmali: {hata}"
        );
    }

    for miktar in [0.0, -1.0, f64::NAN] {
        let hata = record_waste(
            &mut conn,
            T,
            AKTOR,
            fire_girdisi("prd_1", "BOZULDU", miktar),
        )
        .await
        .expect_err("gecersiz miktar reddedilmeli");
        assert!(hata.contains("büyük"), "neden belirtilmeli: {hata}");
    }

    let sayi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM waste_records")
        .fetch_one(&mut conn)
        .await
        .expect("sorgu calismali");
    assert_eq!(sayi, 0, "reddedilen fire yazilmamali");

    let parti_kalan = sqlx::query_scalar::<_, f64>(
        "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("parti okunmali");
    assert_eq!(parti_kalan, 5.0, "reddedilen fire partiye dokunmamali");
}
