//! Yasal ve kampanya testlerinin ortak veri tabanı ve bağlantı yardımcıları.
//!
//! Yardımcılar ayrı dosyada tutulur: altı test modülü aynı şemayı ve aynı
//! bağlantı havuzunu kullanır. Şema tek yerde olmazsa bir modül güncellendiğinde
//! diğerleri sessizce farklı tabloda çalışır ve kıyaslanamayan testler yazar.
//!
//! Şema doğrudan migration dosyasından okunur: `include_str!` kopyalamaz, bu
//! yüzden `migrations/schema.sql` değiştiğinde test şeması da değişir. Elle
//! yazılmış ikinci bir şema, migration'dan ayrışır ve testler yeşil kalırken
//! üretim kırılır — tam olarak bu testlerin yakalaması gereken hata.

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqliteConnection;

const SEMA: &str = include_str!("../../../migrations/schema.sql");

/// İki ayrı işletme kimliği. İzolasyon testleri bu ikisini karşılaştırır.
pub const KIRACI_A: &str = "ten_a";
pub const KIRACI_B: &str = "ten_b";

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
/// testler sırayla değil birbirinin ayağının altında koşar.
pub async fn conn_of(pool: &sqlx::Pool<sqlx::Sqlite>) -> SqliteConnection {
    pool.acquire().await.expect("baglanti alinmali").detach()
}

/// Bugünün tarihi, `YYYY-AA-GG` biçiminde.
pub fn bugun() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Bugünden `offset` gün sonrası/öncesi, `YYYY-AA-GG` biçiminde.
pub fn gun(offset: i64) -> String {
    (chrono::Local::now().date_naive() + chrono::Duration::days(offset))
        .format("%Y-%m-%d")
        .to_string()
}

/// Kampanya kayıt girdisi kurar.
///
/// `campaign_tests` ve `coupon_tests` aynı girdiyi kurar; burada
/// paylaşılmazsa iki dosyada iki kopya yaşar ve biri güncellendiğinde
/// testler farklı kampanyaları sınar.
pub fn kampanya_girdisi(
    ad: &str,
    kural_json: &str,
    kupon: Option<&str>,
) -> crate::services::legal360::campaigns::CampaignInput {
    use crate::services::legal360::campaigns::CampaignInput;
    CampaignInput {
        id: None,
        name: ad.to_string(),
        rule_json: Some(kural_json.to_string()),
        rule: None,
        coupon_code: kupon.map(str::to_string),
        max_usage: None,
        valid_from: None,
        valid_to: None,
        is_active: None,
    }
}

/// Fiili sipariş satırı ekler.
///
/// e-Arşiv testleri sipariş **toplamını** okur; `orders` tablosu
/// `table_id` yabancı anahtarı istediği için önce masa gerekir. Testte sıfır
/// tutarlı sahte sipariş yeterli değildir: KDV hesabının girdisi tam olarak
/// bu toplamdır.
pub async fn siparis_ekle(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
    total_cents: i64,
) {
    let masa_id = format!("tbl_{order_id}");
    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status) VALUES (?1, ?2, 'T1', 'AVAILABLE')",
    )
    .bind(&masa_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .expect("masa eklenmeli");

    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents)
         VALUES (?1, ?2, ?3, 'PAID', ?4)",
    )
    .bind(order_id)
    .bind(tenant_id)
    .bind(&masa_id)
    .bind(total_cents)
    .execute(&mut *conn)
    .await
    .expect("siparis eklenmeli");
}
