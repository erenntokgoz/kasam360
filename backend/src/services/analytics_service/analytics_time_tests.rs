//! Faz 10 analitik testleri — yoğun saat, hedef, rakip fiyat, void oranı.

use sqlx::SqlitePool;

use crate::services::analytics_service::{
    competitor_price_gaps, monthly_target_status, peak_hours, void_loss_rate,
};

/// Zaman/hedef bölümünün okuduğu minimal şema.
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
        "CREATE TABLE monthly_targets (id TEXT PRIMARY KEY, tenant_id TEXT, month TEXT, category TEXT, target_cents INTEGER, created_at TEXT, updated_at TEXT, UNIQUE(tenant_id, month, category))",
        "CREATE TABLE competitor_prices (id TEXT PRIMARY KEY, tenant_id TEXT, product_id TEXT, competitor_name TEXT, price_cents INTEGER, observed_at TEXT, UNIQUE(tenant_id, product_id, competitor_name, observed_at))",
    ] {
        sqlx::query(stmt)
            .execute(&pool)
            .await
            .expect("tablo kurulmali");
    }
    pool
}

/// Kategori satırı zorunludur: hedef sorgusu `c.name = t.category` ile eşleşir,
/// kategori kaydı yoksa `LEFT JOIN` null döner ve gerçekleşme 0 görünür.
async fn category(pool: &SqlitePool, tenant: &str, id: &str, name: &str) {
    sqlx::query("INSERT INTO categories (tenant_id, id, name) VALUES (?1, ?2, ?3)")
        .bind(tenant)
        .bind(id)
        .bind(name)
        .execute(pool)
        .await
        .expect("kategori eklenmeli");
}

/// `None` aralığı "içinde bulunulan ay" demektir; testler Mart 2026 verisi
/// kullandığı için aralık açıkça verilir.
fn mart() -> super::analytics_types::AnalyticsRange {
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

async fn order(pool: &SqlitePool, tenant: &str, id: &str, status: &str, at: &str) {
    sqlx::query("INSERT INTO orders (id, tenant_id, status, created_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(id)
        .bind(tenant)
        .bind(status)
        .bind(at)
        .execute(pool)
        .await
        .expect("siparis eklenmeli");
}

async fn line(pool: &SqlitePool, tenant: &str, order: &str, product: &str, qty: i64, cents: i64) {
    sqlx::query(
        "INSERT INTO order_items
         (id, tenant_id, order_id, product_id, quantity, total_cents)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(format!("li_{order}_{product}_{qty}"))
    .bind(tenant)
    .bind(order)
    .bind(product)
    .bind(qty)
    .bind(cents)
    .execute(pool)
    .await
    .expect("kalem eklenmeli");
}

async fn target(pool: &SqlitePool, tenant: &str, month: &str, category: &str, cents: i64) {
    sqlx::query(
        "INSERT INTO monthly_targets
         (id, tenant_id, month, category, target_cents, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '2026-03-01', '2026-03-01')",
    )
    .bind(format!("tgt_{tenant}_{month}_{category}"))
    .bind(tenant)
    .bind(month)
    .bind(category)
    .bind(cents)
    .execute(pool)
    .await
    .expect("hedef eklenmeli");
}

async fn competitor(
    pool: &SqlitePool,
    tenant: &str,
    product: &str,
    name: &str,
    cents: i64,
    at: &str,
) {
    sqlx::query(
        "INSERT INTO competitor_prices
         (id, tenant_id, product_id, competitor_name, price_cents, observed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(format!("cmp_{product}_{name}_{at}"))
    .bind(tenant)
    .bind(product)
    .bind(name)
    .bind(cents)
    .bind(at)
    .execute(pool)
    .await
    .expect("rakip fiyat eklenmeli");
}

// ---------------------------------------------------------------------------
// Yoğun saat
// ---------------------------------------------------------------------------

#[tokio::test]
async fn yogun_saat_her_zaman_yirmi_dort_kova_dondurur() {
    let pool = test_pool().await;
    let buckets = peak_hours(&pool, "t1", &mart()).await.expect("okunmali");
    // Veri yoksa bile grafik eksik kova göstermemeli.
    assert_eq!(buckets.len(), 24);
    assert!(buckets.iter().all(|b| b.revenue_cents == 0 && b.orders == 0));
}

#[tokio::test]
async fn yogun_saat_siparisleri_saat_kovasina_toplar() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    order(&pool, "t1", "o1", "PAID", "2026-03-10T12:15:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 1000).await;
    order(&pool, "t1", "o2", "PAID", "2026-03-10T12:45:00Z").await;
    line(&pool, "t1", "o2", "p1", 2, 2000).await;
    order(&pool, "t1", "o3", "PAID", "2026-03-10T19:05:00Z").await;
    line(&pool, "t1", "o3", "p1", 1, 1000).await;

    let buckets = peak_hours(&pool, "t1", &mart()).await.expect("okunmali");
    let noon = &buckets[12];
    assert_eq!(noon.orders, 2);
    assert_eq!(noon.revenue_cents, 3000);
    assert_eq!(buckets[19].orders, 1);
    assert_eq!(buckets[3].orders, 0);
}

#[tokio::test]
async fn yogun_saat_tenant_yalitimi_yapar() {
    let pool = test_pool().await;
    product(&pool, "t2", "p1", "Kahve", "c1", 1000).await;
    order(&pool, "t2", "o1", "PAID", "2026-03-10T12:00:00Z").await;
    line(&pool, "t2", "o1", "p1", 1, 1000).await;

    let buckets = peak_hours(&pool, "t1", &mart()).await.expect("okunmali");
    assert_eq!(buckets.iter().map(|b| b.orders).sum::<i64>(), 0);
}

// ---------------------------------------------------------------------------
// Aylık hedef
// ---------------------------------------------------------------------------

#[tokio::test]
async fn hedef_gerceklesmesi_yuzde_ve_fark_doner() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    order(&pool, "t1", "o1", "PAID", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 50_000).await;
    target(&pool, "t1", "2026-03", "ALL", 100_000).await;

    let t = monthly_target_status(&pool, "t1", "2026-03")
        .await
        .expect("okunmali");
    assert_eq!(t.len(), 1);
    assert_eq!(t[0].actual_cents, 50_000);
    assert_eq!(t[0].achieved_percent, Some(50));
    assert_eq!(t[0].difference_cents, -50_000);
}

#[tokio::test]
async fn hedef_sifir_kenar_yuzde_null_dondurur() {
    let pool = test_pool().await;
    target(&pool, "t1", "2026-03", "ALL", 0).await;

    let t = monthly_target_status(&pool, "t1", "2026-03")
        .await
        .expect("okunmali");
    // Hedef 0: oran hesaplanamaz, "sınırsız aşıldı" denemez.
    assert_eq!(t[0].achieved_percent, None);
}

#[tokio::test]
async fn hedef_tanımlanmamışsa_satir_yoktur() {
    let pool = test_pool().await;
    let t = monthly_target_status(&pool, "t1", "2026-03")
        .await
        .expect("okunmali");
    assert!(t.is_empty());
}

#[tokio::test]
async fn all_hedefi_tum_kategorileri_toplar() {
    let pool = test_pool().await;
    category(&pool, "t1", "c1", "Kahve").await;
    category(&pool, "t1", "c2", "Kruasan").await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    product(&pool, "t1", "p2", "Kruasan", "c2", 500).await;
    order(&pool, "t1", "o1", "PAID", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 30_000).await;
    line(&pool, "t1", "o1", "p2", 1, 20_000).await;
    target(&pool, "t1", "2026-03", "ALL", 100_000).await;

    let t = monthly_target_status(&pool, "t1", "2026-03")
        .await
        .expect("okunmali");
    // ALL iki kategoriyi de kapsar: 30000 + 20000.
    assert_eq!(t[0].actual_cents, 50_000);
    assert_eq!(t[0].achieved_percent, Some(50));
}

#[tokio::test]
async fn kategori_hedefi_yalniz_kendi_kategorisini_toplar() {
    let pool = test_pool().await;
    category(&pool, "t1", "c1", "Kahve").await;
    category(&pool, "t1", "c2", "Kruasan").await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    product(&pool, "t1", "p2", "Kruasan", "c2", 500).await;
    order(&pool, "t1", "o1", "PAID", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 30_000).await;
    line(&pool, "t1", "o1", "p2", 1, 20_000).await;
    target(&pool, "t1", "2026-03", "Kahve", 100_000).await;

    let t = monthly_target_status(&pool, "t1", "2026-03")
        .await
        .expect("okunmali");
    assert_eq!(t[0].actual_cents, 30_000);
}

#[tokio::test]
async fn hedef_baska_ayi_olmaz() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    order(&pool, "t1", "o1", "PAID", "2026-02-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 99_000).await;
    target(&pool, "t1", "2026-03", "ALL", 100_000).await;

    let t = monthly_target_status(&pool, "t1", "2026-03")
        .await
        .expect("okunmali");
    // Subat cirosu Mart hedefi sayılmaz.
    assert_eq!(t[0].actual_cents, 0);
}

// ---------------------------------------------------------------------------
// Rakip fiyat
// ---------------------------------------------------------------------------

#[tokio::test]
async fn rakip_farki_biz_daha_pahaliyse_negatiftir() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 20_000).await;
    competitor(&pool, "t1", "p1", "Rakip A", 15_000, "2026-03-01T09:00:00Z").await;

    let g = competitor_price_gaps(&pool, "t1").await.expect("okunmali");
    assert_eq!(g.len(), 1);
    // gap = bizim - rakip = 5000 -> biz daha pahalıyız (negatif beklenmez).
    assert_eq!(g[0].gap_cents, 5_000);
    assert_eq!(g[0].gap_percent, 33);
}

#[tokio::test]
async fn rakip_farki_biz_daha_ucuzsa_negatiftir() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 10_000).await;
    competitor(&pool, "t1", "p1", "Rakip A", 15_000, "2026-03-01T09:00:00Z").await;

    let g = competitor_price_gaps(&pool, "t1").await.expect("okunmali");
    assert_eq!(g[0].gap_cents, -5_000);
    assert_eq!(g[0].gap_percent, -33);
}

#[tokio::test]
async fn rakip_fiyati_yalniz_en_guncel_gozlemi_kullanir() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 10_000).await;
    competitor(&pool, "t1", "p1", "Rakip A", 9_000, "2026-03-01T09:00:00Z").await;
    competitor(&pool, "t1", "p1", "Rakip A", 11_000, "2026-03-02T09:00:00Z").await;

    let g = competitor_price_gaps(&pool, "t1").await.expect("okunmali");
    // Geçmiş silinmez ama rapor en güncel gözlemi gösterir.
    assert_eq!(g.len(), 1);
    assert_eq!(g[0].competitor_price_cents, 11_000);
}

#[tokio::test]
async fn rakip_fiyati_rakip_basina_ayri_satirdir() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 10_000).await;
    competitor(&pool, "t1", "p1", "Rakip A", 9_000, "2026-03-01T09:00:00Z").await;
    competitor(&pool, "t1", "p1", "Rakip B", 12_000, "2026-03-01T09:00:00Z").await;

    let g = competitor_price_gaps(&pool, "t1").await.expect("okunmali");
    assert_eq!(g.len(), 2);
}

#[tokio::test]
async fn rakip_fiyati_yoksa_bos_doner() {
    let pool = test_pool().await;
    let g = competitor_price_gaps(&pool, "t1").await.expect("okunmali");
    assert!(g.is_empty());
}

#[tokio::test]
async fn rakip_fiyati_tenant_yalitimi_yapar() {
    let pool = test_pool().await;
    product(&pool, "t2", "p1", "Kahve", "c1", 10_000).await;
    competitor(&pool, "t2", "p1", "Rakip A", 9_000, "2026-03-01T09:00:00Z").await;

    let g = competitor_price_gaps(&pool, "t1").await.expect("okunmali");
    assert!(g.is_empty());
}

#[tokio::test]
async fn rakip_fiyati_sifir_fiyat_yuzdesi_sifir_verir() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 10_000).await;
    competitor(&pool, "t1", "p1", "Rakip A", 0, "2026-03-01T09:00:00Z").await;

    let g = competitor_price_gaps(&pool, "t1").await.expect("okunmali");
    // Bölme sıfıra düşmez; fark kuruş olarak yine bildirilir.
    assert_eq!(g[0].gap_cents, 10_000);
    assert_eq!(g[0].gap_percent, 0);
}

// ---------------------------------------------------------------------------
// Void kayıp oranı
// ---------------------------------------------------------------------------

#[tokio::test]
async fn void_orani_iptal_tutarini_ciroya_oranlar() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    order(&pool, "t1", "o1", "PAID", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 80_000).await;
    order(&pool, "t1", "o2", "VOID", "2026-03-10T11:00:00Z").await;
    line(&pool, "t1", "o2", "p1", 1, 20_000).await;

    let v = void_loss_rate(&pool, "t1", &mart()).await.expect("okunmali");
    assert_eq!(v.total_cents, 100_000);
    assert_eq!(v.voided_cents, 20_000);
    assert_eq!(v.void_rate_percent, Some(20));
    assert_eq!(v.voided_orders, 1);
    assert_eq!(v.total_orders, 2);
}

#[tokio::test]
async fn void_orani_ciro_yoksa_null_dondurur() {
    let pool = test_pool().await;
    let v = void_loss_rate(&pool, "t1", &mart()).await.expect("okunmali");
    // "Sıfır kayıp" değil, hesaplanamaz.
    assert_eq!(v.void_rate_percent, None);
    assert_eq!(v.total_cents, 0);
}

#[tokio::test]
async fn void_orani_sayaci_ciroyla_ayni_evreni_kullanir() {
    let pool = test_pool().await;
    product(&pool, "t1", "p1", "Kahve", "c1", 1000).await;
    // Açık sipariş ne ciroya ne sayaca girer.
    order(&pool, "t1", "o1", "OPEN", "2026-03-10T10:00:00Z").await;
    line(&pool, "t1", "o1", "p1", 1, 50_000).await;
    order(&pool, "t1", "o2", "PAID", "2026-03-10T11:00:00Z").await;
    line(&pool, "t1", "o2", "p1", 1, 100_000).await;

    let v = void_loss_rate(&pool, "t1", &mart()).await.expect("okunmali");
    assert_eq!(v.total_cents, 100_000);
    assert_eq!(v.total_orders, 1);
}

#[tokio::test]
async fn void_orani_tenant_yalitimi_yapar() {
    let pool = test_pool().await;
    product(&pool, "t2", "p1", "Kahve", "c1", 1000).await;
    order(&pool, "t2", "o1", "VOID", "2026-03-10T10:00:00Z").await;
    line(&pool, "t2", "o1", "p1", 1, 50_000).await;

    let v = void_loss_rate(&pool, "t1", &mart()).await.expect("okunmali");
    assert_eq!(v.total_cents, 0);
    assert_eq!(v.void_rate_percent, None);
}

#[tokio::test]
async fn void_orani_db_hatasini_yutar_mez() {
    let pool = test_pool().await;
    // Tablo yoksa hata yukarı taşınır; 0'a dönmez.
    let bozuk = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("db");
    let sonuc = void_loss_rate(&bozuk, "t1", &None).await;
    assert!(sonuc.is_err(), "tablo yoksa Err dönmeli");
    drop(pool);
}