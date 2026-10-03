//! Faz 12 · Fire ve kör sayım testleri.
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
    assert_eq!(stok, Some(-8), "urun kolonu fire kadar dusmeli");
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
    assert_ne!(partsiz.total_cost_cents, Some(0), "maliyet bilinmiyorsa sifir yazilmamali");

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

    let kayitlar = list_waste_records(&mut conn, T, None).await.expect("kayitlar okunmali");
    assert_eq!(kayitlar.len(), 2);
    // Sıralama zaman damgasına göre; hangisinin önce olduğuna değil, ikisinin de
    // raporda bulunduğuna bakılır.
    let adlar: Vec<&str> = kayitlar.iter().map(|k| k.product_name.as_str()).collect();
    assert!(adlar.contains(&"Çay") && adlar.contains(&"Süt"), "kayitlar eksik: {adlar:?}");

    nullable_kolon_dogrula(&mut conn, T).await;
}

#[tokio::test]
async fn gecersiz_fire_gerekcesi_ve_miktari_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_1", "prd_1", 5.0, 3000, None).await;

    let gerekce = record_waste(&mut conn, T, AKTOR, fire_girdisi("prd_1", "BILINMIYOR", 1.0))
        .await
        .expect_err("gecersiz gerekce reddedilmeli");
    assert!(gerekce.contains("geçersiz"), "izin verilenler yazilmali: {gerekce}");

    // Frontend'in gönderdiği gerekçeler backend kümesinde yok: sözleşme
    // ayrışması sessiz kalmamalı, hata mesajı izin verilenleri listeler.
    for uyumsuz in ["BOZULMA", "SURE", "KIRILMA", "DIGER"] {
        let hata = record_waste(&mut conn, T, AKTOR, fire_girdisi("prd_1", uyumsuz, 1.0))
            .await
            .expect_err("sozlesme disi gerekce reddedilmeli");
        assert!(hata.contains("BOZULDU"), "izin verilenler yazilmali: {hata}");
    }

    for miktar in [0.0, -1.0, f64::NAN] {
        let hata = record_waste(&mut conn, T, AKTOR, fire_girdisi("prd_1", "BOZULDU", miktar))
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

#[tokio::test]
async fn kor_sayimda_beklenen_miktar_sayim_sirasinda_gorunmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_1", "prd_1", 20.0, 3000, None).await;

    let sayim = open_stock_count(&mut conn, T, AKTOR, Some("depo".to_string()), None)
        .await
        .expect("sayim acilmali");
    assert_eq!(sayim.status, "ACIK");
    assert!(sayim.lines.is_empty(), "sayim satirsiz baslamali");

    record_count_line(&mut conn, T, &sayim.id, "prd_1", 18.0, AKTOR)
        .await
        .expect("satir yazilmali");

    // Beklenen miktar yalnız kapanışta hesaplanır: sayan kişi kendi ölçümüne
    // göre yazmalıdır.
    let acik = get_stock_count(&mut conn, T, &sayim.id).await.expect("sayim okunmali");
    assert_eq!(acik.lines.len(), 1);
    assert_eq!(acik.lines[0].counted_quantity, 18.0);
    assert_eq!(acik.lines[0].expected_quantity, None);
    assert_eq!(acik.lines[0].variance_quantity, None);
    assert_eq!(acik.lines[0].variance_cost_cents, None);

    let kolon: Option<f64> = sqlx::query_scalar(
        "SELECT expected_quantity FROM stock_count_lines WHERE stock_count_id = ?",
    )
    .bind(&sayim.id)
    .fetch_one(&mut conn)
    .await
    .expect("satir okunmali");
    assert_eq!(kolon, None, "sayim sirasinda beklenen miktar yazilmamali");

    // Satırı yeniden yazmak üstüne yazar, ikinci satır açılmaz.
    record_count_line(&mut conn, T, &sayim.id, "prd_1", 19.0, AKTOR)
        .await
        .expect("satir guncellenmeli");
    let tekrar = get_stock_count(&mut conn, T, &sayim.id).await.expect("sayim okunmali");
    assert_eq!(tekrar.lines.len(), 1);
    assert_eq!(tekrar.lines[0].counted_quantity, 19.0);
}

#[tokio::test]
async fn kor_sayim_kapanisi_farki_hesaplar_ve_stogu_gunceller() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_1", "prd_1", 20.0, 3000, None).await;

    let sayim = open_stock_count(&mut conn, T, AKTOR, None, None)
        .await
        .expect("sayim acilmali");
    record_count_line(&mut conn, T, &sayim.id, "prd_1", 17.0, AKTOR)
        .await
        .expect("satir yazilmali");

    let kapali = close_stock_count(&mut conn, T, &sayim.id, AKTOR, true)
        .await
        .expect("sayim kapatilmali");
    assert_eq!(kapali.status, "UYGULANDI");
    assert_eq!(kapali.lines.len(), 1);
    assert_eq!(kapali.lines[0].expected_quantity, Some(20.0));
    assert_eq!(kapali.lines[0].variance_quantity, Some(-3.0));
    // Eksen stok: 3 birim × 3000 kuruş = 9000 kuruş zarar.
    assert_eq!(kapali.lines[0].variance_cost_cents, Some(-9000));

    let stok = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT stock_quantity FROM products WHERE id = 'prd_1' AND tenant_id = 'tnt_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("urun okunmali");
    assert_eq!(stok, Some(17), "stok sayilan degere cekilmeli");

    let hareket = sqlx::query(
        "SELECT quantity, movement_type FROM stock_movements WHERE product_id = 'prd_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("hareket yazilmali");
    let miktar: f64 = hareket.try_get("quantity").expect("miktar okunmali");
    assert_eq!(hareket.try_get::<String, _>("movement_type").expect("kolon okunmali"), "ADJUST");
    assert_eq!(miktar, -3.0, "hareket defteri farkla eslesmeli");

    // Kapanmış sayıma satır girilemez ve yeniden kapatılamaz.
    let satir = record_count_line(&mut conn, T, &sayim.id, "prd_1", 5.0, AKTOR)
        .await
        .expect_err("kapali sayima satir girilememeli");
    assert!(satir.contains("CONFLICT"), "neden belirtilmeli: {satir}");
    let tekrar = close_stock_count(&mut conn, T, &sayim.id, AKTOR, true)
        .await
        .expect_err("kapali sayim tekrar kapatilamamali");
    assert!(tekrar.contains("CONFLICT"), "neden belirtilmeli: {tekrar}");

    let sayimlar = list_stock_counts(&mut conn, T).await.expect("sayimlar okunmali");
    assert_eq!(sayimlar.len(), 1);
}

#[tokio::test]
async fn kor_sayim_partisiz_urunde_stok_kolonunu_beklenen_olarak_kullanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    sqlx::query("UPDATE products SET stock_quantity = 12 WHERE id = 'prd_1'")
        .execute(&mut conn)
        .await
        .expect("stok yazilmali");

    let sayim = open_stock_count(&mut conn, T, AKTOR, None, None)
        .await
        .expect("sayim acilmali");
    record_count_line(&mut conn, T, &sayim.id, "prd_1", 10.0, AKTOR)
        .await
        .expect("satir yazilmali");

    let kapali = close_stock_count(&mut conn, T, &sayim.id, AKTOR, true)
        .await
        .expect("sayim kapatilmali");
    // Parti yok, ürün kolonu var: beklenen miktar kolondan okunur.
    assert_eq!(kapali.lines[0].expected_quantity, Some(12.0));
    assert_eq!(kapali.lines[0].variance_quantity, Some(-2.0));
    // Parti olmadığı için birim maliyet bilinmiyor: sahte sıfır fark yazılmaz.
    assert_eq!(kapali.lines[0].variance_cost_cents, None);
    assert_ne!(kapali.lines[0].variance_cost_cents, Some(0));
}

#[tokio::test]
async fn kor_sayim_beklenen_miktari_bilinmiyorsa_fark_uretmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    // Parti yok ve `stock_quantity` NULL: hiç stok hareketi görmemiş ürün.
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;

    let sayim = open_stock_count(&mut conn, T, AKTOR, None, None)
        .await
        .expect("sayim acilmali");
    record_count_line(&mut conn, T, &sayim.id, "prd_1", 6.0, AKTOR)
        .await
        .expect("satir yazilmali");

    let kapali = close_stock_count(&mut conn, T, &sayim.id, AKTOR, true)
        .await
        .expect("sayim kapatilmali");
    let satir = &kapali.lines[0];
    assert_eq!(satir.counted_quantity, 6.0);
    // Beklenen miktar bilinmiyor: sıfır yazmak "stokta hiçbir şey yok" der ve
    // sayılan malın tamamını fazla stok gibi gösterir.
    assert_eq!(satir.expected_quantity, None);
    assert_eq!(satir.variance_quantity, None);
    assert_eq!(satir.variance_cost_cents, None);

    let hareket_sayisi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stock_movements")
        .fetch_one(&mut conn)
        .await
        .expect("sorgu calismali");
    assert_eq!(hareket_sayisi, 0, "fark bilinmiyorsa hareket yazilmamali");
}

#[tokio::test]
async fn kor_sayim_duzeltmesi_uygulanmadiginda_stok_ayakta_kalar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_1", "prd_1", 20.0, 3000, None).await;
    sqlx::query("UPDATE products SET stock_quantity = 20 WHERE id = 'prd_1'")
        .execute(&mut conn)
        .await
        .expect("stok yazilmali");

    let sayim = open_stock_count(&mut conn, T, AKTOR, None, None)
        .await
        .expect("sayim acilmali");
    record_count_line(&mut conn, T, &sayim.id, "prd_1", 17.0, AKTOR)
        .await
        .expect("satir yazilmali");

    let kapali = close_stock_count(&mut conn, T, &sayim.id, AKTOR, false)
        .await
        .expect("sayim kapatilmali");
    assert_eq!(kapali.status, "KAPALI");
    // Fark yine hesaplanır ve raporlanır, yalnız stoğa dokunulmaz.
    assert_eq!(kapali.lines[0].variance_quantity, Some(-3.0));

    let stok = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT stock_quantity FROM products WHERE id = 'prd_1' AND tenant_id = 'tnt_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("urun okunmali");
    assert_eq!(stok, Some(20), "duzeltme uygulanmadiginda stok degismemeli");

    let parti_kalan = sqlx::query_scalar::<_, f64>(
        "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("parti okunmali");
    assert_eq!(parti_kalan, 20.0);
}

#[tokio::test]
async fn satirsiz_kor_sayim_kapatilamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let sayim = open_stock_count(&mut conn, T, AKTOR, None, None)
        .await
        .expect("sayim acilmali");
    let hata = close_stock_count(&mut conn, T, &sayim.id, AKTOR, true)
        .await
        .expect_err("satirsiz sayim kapatilamamali");
    assert!(hata.contains("satır"), "neden belirtilmeli: {hata}");

    // Sayım hâlâ açık: reddedilen kapanış durumu bozmamalı.
    let acik = get_stock_count(&mut conn, T, &sayim.id).await.expect("sayim okunmali");
    assert_eq!(acik.status, "ACIK");

    // Aynı işletmede ikinci açık sayım açılamaz.
    let ikinci = open_stock_count(&mut conn, T, AKTOR, None, None)
        .await
        .expect_err("ikinci acik sayim reddedilmeli");
    assert!(ikinci.contains("CONFLICT"), "neden belirtilmeli: {ikinci}");

    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    let negatif = record_count_line(&mut conn, T, &sayim.id, "prd_1", -1.0, AKTOR)
        .await
        .expect_err("negatif sayim reddedilmeli");
    assert!(negatif.contains("negatif"), "neden belirtilmeli: {negatif}");
}

#[tokio::test]
async fn baska_kiracinin_sayimina_satir_yazilamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_benim", "Süt", 1500).await;
    urun_ekle(&mut conn, T2, "prd_yabanci", "Süt", 9900).await;
    parti_ekle(&mut conn, T, "bat_benim", "prd_benim", 20.0, 3000, None).await;

    let sayim = open_stock_count(&mut conn, T, AKTOR, None, None)
        .await
        .expect("sayim acilmali");

    let yabanci_urun = record_count_line(&mut conn, T, &sayim.id, "prd_yabanci", 5.0, AKTOR)
        .await
        .expect_err("yabanci urun satiri yazilamamali");
    assert!(
        yabanci_urun.contains("NOT_FOUND") || yabanci_urun.contains("bulunam"),
        "neden: {yabanci_urun}"
    );

    let yabanci_sayim = record_count_line(&mut conn, T2, &sayim.id, "prd_benim", 5.0, AKTOR)
        .await
        .expect_err("yabanci sayima satir yazilamamali");
    assert!(
        yabanci_sayim.contains("NOT_FOUND") || yabanci_sayim.contains("bulunam"),
        "neden: {yabanci_sayim}"
    );

    let kapatma = close_stock_count(&mut conn, T2, &sayim.id, AKTOR, true)
        .await
        .expect_err("yabanci sayim kapatilamamali");
    assert!(
        kapatma.contains("NOT_FOUND") || kapatma.contains("bulunam"),
        "neden: {kapatma}"
    );

    let yabanci_fire = record_waste(&mut conn, T2, AKTOR, fire_girdisi("prd_benim", "KIRILDI", 1.0))
        .await
        .expect_err("yabanci urun fire kaydi yazilamamali");
    assert!(
        yabanci_fire.contains("NOT_FOUND") || yabanci_fire.contains("bulunam"),
        "neden: {yabanci_fire}"
    );

    let parti_kalan = sqlx::query_scalar::<_, f64>(
        "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_benim'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("parti okunmali");
    assert_eq!(parti_kalan, 20.0, "basarisiz cagrilar stoğa dokunmamali");

    let sayimlar = list_stock_counts(&mut conn, T2).await.expect("sayimlar okunmali");
    assert!(sayimlar.is_empty(), "yabanci isletmede sayim gorunmemeli");
}
