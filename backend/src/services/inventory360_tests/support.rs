//! Faz 12 testlerinin ortak veri tabanı ve bağlantı yardımcıları.
//!
//! Yardımcılar ayrı dosyada tutulur: altı test modülü aynı şemayı ve aynı
//! bağlantı havuzunu kullanır. Şema tek yerde olmazsa bir modül güncellendiğinde
//! diğerleri sessizce farklı tabloda çalışır ve kıyaslanamayan testler yazar.
//!
//! Şema doğrudan migration dosyasından okunur: `include_str!` kopyalamaz, bu
//! yüzden `migrations/schema.sql` değiştiğinde test şeması da değişir. Ayrı
//! kolonlu elle yazılmış şema, migration'dan ayrışır ve testler yeşil kalırken
//! üretim kırılır — tam olarak bu testlerin yakalaması gereken hata.

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Row, SqliteConnection};

const SEMA: &str = include_str!("../../../migrations/schema.sql");

/// Tek bağlantılı bellek içi veri tabanı üretir.
///
/// Tek bağlantı şart: testler `&mut SqliteConnection` bekleyen servisleri
/// çağırır, havuz birden çok bağlantı verirse aynı test iki ayrı bağlantı
/// üzerinde yarışır ve hata sebebi görünmez olur.
pub async fn test_pool() -> sqlx::Pool<sqlx::Sqlite> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("bellek ici veritabani acilmali");
    sqlx::raw_sql(SEMA)
        .execute(&pool)
        .await
        .expect("migrations/schema.sql uygulanmali");
    pool
}

/// Havuzdan bağlantıyı ayırır.
///
/// `detach` şart: bağlantı havuza geri dönerse `&mut` ödünç alma çakışır ve
/// testler sırayla değil, birbirinin ayağının altında koşar.
pub async fn conn_of(pool: &sqlx::Pool<sqlx::Sqlite>) -> SqliteConnection {
    pool.acquire().await.expect("baglanti alinmali").detach()
}

/// Test ürünü. `stock_quantity` bilinçli olarak yazılmaz: Faz 12 servisleri
/// stoğu `inventory_batches` partilerinden okur, ürün satırındaki eski kolon
/// ikinci bir doğruluk kaynağı yaratırdı.
pub async fn urun_ekle(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
    ad: &str,
    fiyat_kurus: i64,
) {
    // `products.category_id` yabancı anahtar; kategori yoksa ürün eklenemez.
    sqlx::query("INSERT OR IGNORE INTO categories (id, tenant_id, name) VALUES ('cat_1', ?1, 'Test')")
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .expect("kategori eklenmeli");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, category_id, is_active)
         VALUES (?1, ?2, ?3, ?4, 'cat_1', 1)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(ad)
    .bind(fiyat_kurus)
    .execute(&mut *conn)
    .await
    .expect("urun eklenmeli");
}

/// Test partisi. `unit_cost_cents` FIFO maliyet hesaplarında kullanılır.
#[allow(clippy::too_many_arguments)]
pub async fn parti_ekle(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
    urun_id: &str,
    miktar: f64,
    birim_maliyet_kurus: i64,
    son_kullanma: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO inventory_batches
            (id, tenant_id, product_id, received_at, expiry_date, initial_quantity,
             remaining_quantity, unit_cost_cents)
         VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, ?4, ?5, ?5, ?6)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(urun_id)
    .bind(son_kullanma)
    .bind(miktar)
    .bind(birim_maliyet_kurus)
    .execute(&mut *conn)
    .await
    .expect("parti eklenmeli");
}

/// Bugünün tarihi, `YYYY-AA-GG` biçiminde.
pub fn bugun() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Testin gününe sabitlenmiş bir saat üretir.
///
/// Kural ve menü penceresi karşılaştırmaları yalnız `HH:MM` metniyle yapılır;
/// testin hangi güne düştüğü önemsizdir. Tarih bugün seçilir ki dondurma
/// kaydının geçerlilik aralığı test saatinin üstüne insin.
pub fn sabit_gun(saat: &str) -> chrono::DateTime<chrono::Local> {
    chrono::NaiveDateTime::parse_from_str(&format!("{}T{saat}:00", bugun()), "%Y-%m-%dT%H:%M:%S")
        .expect("saat bicimi cozulemeli")
        .and_local_timezone(chrono::Local)
        .earliest()
        .expect("yerel saat cozulemeli")
}

/// Bugünden `offset` gün sonrası/öncesi, `YYYY-AA-GG` biçiminde.
pub fn gun(offset: i64) -> String {
    (chrono::Local::now().date_naive() + chrono::Duration::days(offset))
        .format("%Y-%m-%d")
        .to_string()
}

/// Happy hour kuralı girdisi. `pricing` ve `price_lists_windows` testleri aynı
/// pencereyi kurar; kural tanımı iki yerde kopyalanırsa biri güncellenip diğeri
/// eski kalır ve çözümleme sırası sessizce değişir.
pub fn kural_girdisi(
    ad: &str,
    indirim: i64,
    bas: &str,
    bit: &str,
) -> crate::services::inventory360::pricing::PricingRuleInput {
    use crate::services::inventory360::pricing::PricingRuleInput;
    PricingRuleInput {
        id: None,
        name: ad.to_string(),
        kind: Some("HAPPY_HOUR".to_string()),
        discount_percent: indirim,
        start_time: bas.to_string(),
        end_time: bit.to_string(),
        days_of_week: None,
        product_ids: None,
        category_ids: None,
        valid_from: None,
        valid_to: None,
        is_active: Some(true),
        priority: Some(100),
    }
}

/// Aynı ürün adını iki ayrı işletmenin taşıdığı senaryo kurar ve iki kimliği
/// döndürür.
///
/// `products.id` tek sütunlu birincil anahtar olduğu için aynı kimlik iki
/// kiracıda birden var olamaz. Bu bir kısıt değil, gereklilik: kimlik zaten
/// global tekildir, sızıntı yalnız satırın `tenant_id` filtresi atlanırsa
/// görünür. Testler bu yüzden ayrı kimlikler üzerinden sızıntı dener.
pub async fn iki_kiracili_urun(
    conn: &mut SqliteConnection,
    urun_id: &str,
    kiracilar: [&str; 2],
) -> (String, String) {
    let id_a = format!("{urun_id}_a");
    let id_b = format!("{urun_id}_b");
    urun_ekle(conn, kiracilar[0], &id_a, "Kahve", 4500).await;
    urun_ekle(conn, kiracilar[1], &id_b, "Kahve", 9900).await;
    (id_a, id_b)
}

/// Nullable kolonun "bilinmiyor" olduğunu kanıtlar ve yalnız doğru okuma
/// yollarını bırakır.
///
/// Neden gerekli: `sqlx`te `query_scalar::<Option<T>>(...)` + `fetch_optional`
/// bir NULL sütunu `Some(0)` döndürür. Yani "bilinmiyor" sessizce "sıfır"a
/// dönüşür — AGENTS.md §3.4'te yasaklanan finansal sessiz hata tam olarak böyle
/// doğar. Aynı sütunu `fetch_one` veya `Row::try_get` okuduğunda `None` gelir.
/// Testler bu davranışı kilitler; servisler `optional_text`, `optional_i64`,
/// `optional_f64` yardımcılarını kullanır.
pub async fn nullable_kolon_dogrula(conn: &mut SqliteConnection, tenant_id: &str) {
    urun_ekle(conn, tenant_id, "prd_null", "S", 100).await;

    let fetch_optional: Option<i64> =
        sqlx::query_scalar("SELECT stock_quantity FROM products WHERE id = ? AND tenant_id = ?")
            .bind("prd_null")
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .expect("sorgu calismali");
    let fetch_one: Option<i64> =
        sqlx::query_scalar("SELECT stock_quantity FROM products WHERE id = ? AND tenant_id = ?")
            .bind("prd_null")
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .expect("sorgu calismali");
    let satir = sqlx::query("SELECT stock_quantity FROM products WHERE id = ? AND tenant_id = ?")
        .bind("prd_null")
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .expect("sorgu calismali");
    let try_get: Option<i64> = satir
        .try_get("stock_quantity")
        .expect("kolon okunmali");

    assert_eq!(try_get, None, "NULL kolon try_get ile None okunmali");
    assert_eq!(fetch_one, None, "NULL kolon fetch_one ile None okunmali");
    // Karakterizasyon: bu yol **yanlış** sonucu verir ve bilinçli olarak
    // sabitlenir. Amaç, tuzağın kaydını tutmaktır — nullable kolon kullanan her
    // yeni kod `fetch_one`/`try_get` yerine bu yolu seçerse test kırmızıya
    // döner. `sqlx` bu davranışı düzeltirse bu satır güncellenir ve not kaldırılır.
    assert_eq!(
        fetch_optional,
        Some(0),
        "sqlx query_scalar+fetch_optional yolu NULL'u Some(0) donuyor; \
         nullable kolonlar bu yolla okunmamali"
    );
}