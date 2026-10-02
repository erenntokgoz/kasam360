//! Faz 10 analitik testleri — BCG, medyan, ürün marjı, kombinasyon.
//!
//! Her test kendi izole in-memory veritabanını kurar; ortak fixture yoktur.
//! Böylece bir testin tabloyu değiştirmesi diğerini sessizce bozmaz.

use sqlx::SqlitePool;

use crate::services::analytics_service::{
    bcg_classify, bcg_counts, combinations, median, product_margins,
};
use super::analytics_types::{AnalyticsRange, BcgQuadrant, ProductMargin};

/// Test tablosu minimal şemayla kurulur: analitik yalnız bu alanları okur.
async fn test_pool() -> SqlitePool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory db");
    for stmt in [
        "CREATE TABLE categories (tenant_id TEXT, id TEXT, name TEXT, PRIMARY KEY (tenant_id, id))",
        "CREATE TABLE products (tenant_id TEXT, id TEXT, name TEXT, category_id TEXT, price_cents INTEGER NOT NULL, PRIMARY KEY (tenant_id, id))",
        "CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT, status TEXT, created_at TEXT)",
        "CREATE TABLE order_items (tenant_id TEXT, id TEXT, order_id TEXT, product_id TEXT, quantity INTEGER, total_cents INTEGER, PRIMARY KEY (tenant_id, id))",
        "CREATE TABLE inventory_batches (tenant_id TEXT, id TEXT, product_id TEXT, initial_qty INTEGER, remaining_qty INTEGER, unit_cost_cents INTEGER, PRIMARY KEY (tenant_id, id))",
    ] {
        sqlx::query(stmt)
            .execute(&pool)
            .await
            .expect("tablo kurulmali");
    }
    pool
}

/// FIFO partisi ekler. `qty`/`cost` kuruş cinsindendir.
async fn batch(pool: &SqlitePool, tenant: &str, product: &str, qty: i64, remaining: i64, cost: i64) {
    sqlx::query(
        "INSERT INTO inventory_batches
         (tenant_id, id, product_id, initial_qty, remaining_qty, unit_cost_cents)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(tenant)
    .bind(format!("bat_{product}_{qty}"))
    .bind(product)
    .bind(qty)
    .bind(remaining)
    .bind(cost)
    .execute(pool)
    .await
    .expect("parti eklenmeli");
}

/// `None` aralığı "içinde bulunulan ay" demektir; testler Mart 2026 verisi
/// kullandığı için aralık açıkça verilir. Böylece test, takvim gününe değil
/// üretilebilir veriye bağlı kalır.
fn mart() -> AnalyticsRange {
    Some(("2026-03-01".to_string(), "2026-03-31".to_string()))
}

async fn product(pool: &SqlitePool, tenant: &str, id: &str, name: &str, category: &str, price: i64) {
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, category_id, price_cents)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(id)
    .bind(tenant)
    .bind(name)
    .bind(category)
    .bind(price)
    .execute(pool)
    .await
    .expect("urun eklenmeli");
}

async fn paid_order(pool: &SqlitePool, tenant: &str, id: &str, at: &str) {
    sqlx::query("INSERT INTO orders (id, tenant_id, status, created_at) VALUES (?1, ?2, 'PAID', ?3)")
        .bind(id)
        .bind(tenant)
        .bind(at)
        .execute(pool)
        .await
        .expect("siparis eklenmeli");
}

async fn line(pool: &SqlitePool, tenant: &str, order: &str, product: &str, qty: i64, cents: i64) {
    sqlx::query(
        "INSERT INTO order_items
         (tenant_id, id, order_id, product_id, quantity, total_cents)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(tenant)
    .bind(format!("li_{order}_{product}"))
    .bind(order)
    .bind(product)
    .bind(qty)
    .bind(cents)
    .execute(pool)
    .await
    .expect("kalem eklenmeli");
}

// ---------------------------------------------------------------------------
// Medyan
// ---------------------------------------------------------------------------

#[test]
fn medyan_tek_eleman_ortadir() {
    assert_eq!(median(&[42]), Some(42));
}

#[test]
fn medyan_cift_eleman_ortalamadir() {
    // 10 ve 20 -> 15; yuvarlamaya değil atılmış ortalamaya düşülmez.
    assert_eq!(median(&[20, 10]), Some(15));
}

#[test]
fn medyan_bos_girdi_none_dondurur() {
    assert_eq!(median(&[]), None);
}

#[test]
fn medyan_siralamadan_bagimsizdir() {
    assert_eq!(median(&[5, 1, 3]), median(&[1, 3, 5]));
}

#[test]
fn medyan_taşmadan_dogru_hesaplanir() {
    // iki medyan toplamı i64::MAX'ı aşsa taşma olmamalı.
    assert_eq!(median(&[i64::MAX, i64::MAX]), Some(i64::MAX));
}

// ---------------------------------------------------------------------------
// BCG sınıflandırma
// ---------------------------------------------------------------------------

fn margin(id: &str, units: i64, margin_percent: Option<i64>) -> ProductMargin {
    ProductMargin {
        product_id: id.to_string(),
        product_name: id.to_string(),
        category_name: "Test".to_string(),
        units_sold: units,
        revenue_cents: 1000,
        unit_cost_cents: Some(500),
        gross_profit_cents: Some(500),
        margin_percent,
    }
}

#[test]
fn bcg_yalniz_medyan_ustu_marji_yildiz_yapar() {
    let margins = vec![
        margin("a", 10, Some(90)),
        margin("b", 10, Some(10)),
        margin("c", 10, Some(50)),
        margin("d", 10, Some(30)),
    ];
    // Medyan marj = (30+50)/2 = 40; medyan birim = 10.
    let out = bcg_classify(&margins).expect("siniflandirilmali");
    let q = |id: &str| {
        out.iter()
            .find(|e| e.product_id == id)
            .map(|e| e.quadrant)
            .unwrap()
    };
    assert_eq!(q("a"), BcgQuadrant::Star);
    assert_eq!(q("c"), BcgQuadrant::Star);
    assert_eq!(q("b"), BcgQuadrant::CashCow);
    assert_eq!(q("d"), BcgQuadrant::CashCow);
}

#[test]
fn bcg_dusuk_hacim_yuksek_marj_bova_olur() {
    let margins = vec![
        margin("buyuk", 100, Some(10)),
        margin("nis", 1, Some(90)),
    ];
    let out = bcg_classify(&margins).expect("siniflandirilmali");
    let nis = out.iter().find(|e| e.product_id == "nis").unwrap();
    assert_eq!(nis.quadrant, BcgQuadrant::Plowhorse);
}

#[test]
fn bcg_maliyeti_bilinmeyen_urun_kovaya_yazilir_ama_marji_null_kalir() {
    let margins = vec![margin("a", 10, Some(50)), margin("b", 10, None)];
    let out = bcg_classify(&margins).expect("siniflandirilmali");
    let b = out.iter().find(|e| e.product_id == "b").unwrap();
    // Marj null ise ekranda "%" gösterilemez; değer uydurulmaz.
    assert!(b.margin_percent.is_none());
}

#[test]
fn bcg_maliyeti_olmayan_tek_urun_hata_dondurur() {
    let margins = vec![margin("a", 10, None)];
    // Tek bilinen marj yoksa medyan tanımsızdır; 0 kabul etmek yanlış kova üretirdi.
    let err = bcg_classify(&margins).expect_err("hata beklenmeli");
    assert!(err.contains("maliyeti bilinmeli"));
}

#[test]
fn bcg_sayimlari_kovaya_gore_dagilir() {
    let margins = vec![
        margin("a", 100, Some(90)),
        margin("b", 100, Some(10)),
        margin("c", 1, Some(90)),
        margin("d", 1, Some(10)),
    ];
    let entries = bcg_classify(&margins).expect("siniflandirilmali");
    let c = bcg_counts(&entries);
    assert_eq!((c.star, c.cash_cow, c.plowhorse, c.dog), (1, 1, 1, 1));
}

// ---------------------------------------------------------------------------
// Ürün marjı
// ---------------------------------------------------------------------------

#[tokio::test]
async fn urun_marji_fifo_ortalamasindan_hesaplanir() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 2000).await;
    // İki parti: 6 adet 100 kuruş + 4 adet 200 kuruş -> ağırlıklı ortalama 140.
    batch(&pool, "t1", "p1", 6, 6, 100).await;
    batch(&pool, "t1", "p1", 4, 4, 200).await;
    paid_order(&pool, "t1", "o1", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 2, 4000).await;

    let m = product_margins(&pool, "t1", &mart()).await.expect("marj okunmali");
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].unit_cost_cents, Some(140));
    // 2 adet x 140 = 280 ciro 4000 -> 3720 kâr, marj %93.
    assert_eq!(m[0].gross_profit_cents, Some(3720));
    assert_eq!(m[0].margin_percent, Some(93));
}

#[tokio::test]
async fn partisi_olmayan_urun_maliyeti_null_dondurur() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 2000).await;
    paid_order(&pool, "t1", "o1", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 2000).await;

    let m = product_margins(&pool, "t1", &mart()).await.expect("marj okunmali");
    // Maliyet bilinmiyor: 0'a çevrilmez, null kalır.
    assert_eq!(m[0].unit_cost_cents, None);
    assert_eq!(m[0].gross_profit_cents, None);
    assert_eq!(m[0].margin_percent, None);
}

#[tokio::test]
async fn tükenmiş_parti_maliyeti_bozmaz() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 2000).await;
    // Tamamen tükenmiş parti ortalamaya katılmaz; elde kalan tek parti 100.
    batch(&pool, "t1", "p1", 10, 0, 999).await;
    batch(&pool, "t1", "p1", 5, 5, 100).await;
    paid_order(&pool, "t1", "o1", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 2000).await;

    let m = product_margins(&pool, "t1", &mart()).await.expect("marj okunmali");
    assert_eq!(m[0].unit_cost_cents, Some(100));
}

#[tokio::test]
async fn kiraci_sizinti_yoktur() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 2000).await;
    product(&pool, "t2", "p1", "Kahve", "c1", 2000).await;
    batch(&pool, "t2", "p1", 5, 5, 100).await;
    paid_order(&pool, "t1", "o1", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 2000).await;

    let m = product_margins(&pool, "t1", &mart()).await.expect("marj okunmali");
    assert_eq!(m.len(), 1);
    // t2 partisi görünmemeli.
    assert_eq!(m[0].unit_cost_cents, None);
}

#[tokio::test]
async fn iptal_siparis_ciraya_dahil_hesaplanir() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 2000).await;
    batch(&pool, "t1", "p1", 5, 5, 100).await;
    paid_order(&pool, "t1", "o1", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 2000).await;
    sqlx::query("INSERT INTO orders (id, tenant_id, status, created_at) VALUES ('o2','t1','VOID','2026-03-10T11:00:00Z')")
        .execute(&pool)
        .await
        .expect("void siparis");
    line(&pool, "t1", "o2", "p1", 1, 2000).await;

    let m = product_margins(&pool, "t1", &mart()).await.expect("marj okunmali");
    // VOID tutarı hasılat değil giderdir; hacim ve ciroya dahil edilir.
    assert_eq!(m[0].units_sold, 2);
    assert_eq!(m[0].revenue_cents, 4000);
}

// ---------------------------------------------------------------------------
// Kombinasyon
// ---------------------------------------------------------------------------

#[tokio::test]
async fn kombinasyon_birlikte_satilan_cifti_bulur() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    product(&pool, "t1", "p2", "Kruasan", "c1", 500).await;
    for (n, day) in ["01", "02", "03"].iter().enumerate() {
        let oid = format!("o{n}");
        paid_order(&pool, "t1", &oid, &format!("2026-03-{day}T10:00:00Z")).await;
        line(&pool, "t1", &oid, "p1", 1, 1000).await;
        line(&pool, "t1", &oid, "p2", 1, 500).await;
    }

    let combos = combinations(&pool, "t1", &mart(), 2)
        .await
        .expect("kombinasyon okunmali");
    assert_eq!(combos.len(), 1);
    assert_eq!(combos[0].support, 3);
    assert_eq!(combos[0].confidence_percent, 100);
}

#[tokio::test]
async fn kombinasyon_destek_esiginin_altinda_listelemez() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    product(&pool, "t1", "p2", "Kruasan", "c1", 500).await;
    paid_order(&pool, "t1", "o1", "2026-03-01T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 1000).await;
    line(&pool, "t1", "o1", "p2", 1, 500).await;

    let combos = combinations(&pool, "t1", &mart(), 2).await.expect("okunmali");
    assert!(combos.is_empty(), "tek siparis esigi gecmemeli");
}

#[tokio::test]
async fn kombinasyon_urun_adlarini_kiracili_getirir() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    product(&pool, "t1", "p2", "Kruasan", "c1", 500).await;
    paid_order(&pool, "t1", "o1", "2026-03-01T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 1000).await;
    line(&pool, "t1", "o1", "p2", 1, 500).await;

    let combos = combinations(&pool, "t1", &mart(), 1).await.expect("okunmali");
    assert_eq!(combos.len(), 1);
    // Kimlik değil insan-okur ad gösterilir.
    let adlar = [&combos[0].product_a_name, &combos[0].product_b_name];
    assert!(adlar.contains(&&"Kahve".to_string()));
    assert!(adlar.contains(&&"Kruasan".to_string()));
}

#[tokio::test]
async fn kombinasyon_veri_yoksa_bos_doner() {
    let pool = test_pool().await;
    let combos = combinations(&pool, "t1", &mart(), 2)
        .await
        .expect("okunmali");
    assert!(combos.is_empty());
    assert!(combos.first().is_none());
}

#[tokio::test]
async fn kombinasyon_tarih_araligini_honourlar() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    product(&pool, "t1", "p2", "Kruasan", "c1", 500).await;
    paid_order(&pool, "t1", "o1", "2026-03-01T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 1000).await;
    line(&pool, "t1", "o1", "p2", 1, 500).await;

    let aralik: AnalyticsRange = Some(("2026-04-01".to_string(), "2026-04-30".to_string()));
    let combos = combinations(&pool, "t1", &aralik, 1).await.expect("okunmali");
    // Mart siparisi Nisan araligina girmemeli.
    assert!(combos.is_empty());
}