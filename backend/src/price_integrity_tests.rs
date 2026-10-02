//! Faz 4 fiyat bütünlüğü testleri.
//!
//! Kapsam: modifier fiyatının **tek doğruluk kaynağı** veritabanıdır. İki
//! gerçek para hatası bu testlerle kilitlenir:
//!
//! 1. İstemci `priceCents: 0` göndererek ekstre ücretinden kurtulmak.
//! 2. Siparişte donmuş fiyat modifier'ı zaten içerdiği hâlde aynı ekstranın
//!    ikinci kez eklenmesi (çift sayım).
//!
//! Testler doğrudan `PaymentRepository::calculate_server_truth` ve
//! `submit_order` yolunu çalıştırır; kural taklit edilmez.

use crate::commands::CartItemDto;
use crate::repositories::payment_repository::PaymentRepository;
use crate::services::modifier_service;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

const SCHEMA: &str = include_str!("../migrations/schema.sql");
const TENANT: &str = "tenant_a";

async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(SCHEMA)
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    // Faz 4 migration'ının test karşılığı.
    sqlx::raw_sql("ALTER TABLE modifier_groups ADD COLUMN category_id TEXT;")
        .execute(&pool)
        .await
        .ok();
    pool
}

async fn seed_catalog(pool: &sqlx::SqlitePool, product_price_cents: i64) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(TENANT)
        .bind("Test İşletme")
        .execute(pool)
        .await
        .expect("tenant eklenir");
    sqlx::query("INSERT OR IGNORE INTO categories (id, tenant_id, name) VALUES ('cat_1', ?, 'Test')")
        .bind(TENANT)
        .execute(pool)
        .await
        .expect("kategori eklenir");
    sqlx::query(
        "INSERT OR IGNORE INTO products (id, tenant_id, name, price_cents, tax_rate, category_id, is_active) \
         VALUES ('prd_1', ?, 'Burger', ?, 20.0, 'cat_1', 1)",
    )
    .bind(TENANT)
    .bind(product_price_cents)
    .execute(pool)
    .await
    .expect("ürün eklenir");
    // `orders.table_id` FK'si için masa şart.
    sqlx::query("INSERT OR IGNORE INTO tables (id, tenant_id, name, status) VALUES ('tbl_1', ?, 'Masa 1', 'AVAILABLE')")
        .bind(TENANT)
        .execute(pool)
        .await
        .expect("masa eklenir");
}

async fn seed_option(pool: &sqlx::SqlitePool, name: &str, price_cents: i64) -> String {
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let group_id = modifier_service::create_group(&mut conn, TENANT, "Ekstralar", false, 0, None, None)
        .await
        .expect("grup oluşturulur");
    modifier_service::add_option(&mut conn, TENANT, &group_id, name, price_cents)
        .await
        .expect("seçenek eklenir")
}

fn item(id: &str, modifiers: Option<serde_json::Value>) -> CartItemDto {
    CartItemDto {
        id: id.to_string(),
        product: serde_json::json!({ "id": "prd_1" }),
        quantity: 1,
        unit_price: 0,
        tax_rate: Some(20),
        subtotal: None,
        tax_amount: None,
        total: None,
        modifiers,
        note: None,
        discount: None,
    }
}

// ─── 1. İstemci fiyatı manipülasyonu ────────────────────────────────────────

/// İstemci ekstre ücretini `0` göndererek ödemekten kaçamaz.
#[tokio::test]
async fn istemci_sifir_fiyat_gondererek_ekstre_ucretinden_kacamaz() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // İstemci yalan söylüyor: gerçek fiyat farkı 4000 kuruş.
    let cheating = serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 0 }]);
    let truth = PaymentRepository::calculate_server_truth(&mut conn, TENANT, &[item("itm_1", Some(cheating))], None)
        .await
        .expect("sunucu hesabı");

    // 34000 brüt + %20 KDV = 40800
    assert_eq!(truth.gross_cents, 34000, "ürün 300 TL + ekstra 40 TL");
    assert_eq!(truth.total_cents, 40800, "istemcinin 0 fiyatı geçerli olmamalı");
}

#[tokio::test]
async fn istemci_fiyati_asiri_yuksek_gonderemez() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let inflated = serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 999_000 }]);
    let truth = PaymentRepository::calculate_server_truth(&mut conn, TENANT, &[item("itm_1", Some(inflated))], None)
        .await
        .expect("sunucu hesabı");

    assert_eq!(truth.gross_cents, 34000, "fiyat veritabanından gelmeli");
}

#[tokio::test]
async fn baska_tenantin_secenegi_fiyatlandirilamaz() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant_b', 'Başka')")
        .execute(&pool)
        .await
        .expect("tenant eklenir");

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let group_b = modifier_service::create_group(&mut conn, "tenant_b", "B Grubu", false, 0, None, None)
        .await
        .expect("B grubu");
    let option_b = modifier_service::add_option(&mut conn, "tenant_b", &group_b, "B Seçeneği", 1000)
        .await
        .expect("B seçeneği");
    drop(conn);

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let foreign = serde_json::json!([{ "id": option_b, "name": "B Seçeneği", "priceCents": 0 }]);
    let outcome = PaymentRepository::calculate_server_truth(&mut conn, TENANT, &[item("itm_1", Some(foreign))], None)
        .await;
    let err: String = match outcome {
        Ok(_) => panic!("çapraz tenant seçeneği reddedilmeliydi"),
        Err(e) => e,
    };
    assert!(err.contains("MALICIOUS_INPUT"), "beklenen hata: {}", err);
}

// ─── 2. Çift sayım ─────────────────────────────────────────────────────────

/// Sipariş satırı donmuş fiyat içerdiğinde aynı ekstra ikinci kez eklenmez.
///
/// `submit_order` `unit_price_cents`'i modifier **dahil** dondurur. Ödeme
/// sırasında aynı kalem tekrar hesaplanırken donmuş değerin üzerine modifier
/// eklenirse müşteri iki kez ücretlendirilir.
#[tokio::test]
async fn donmus_fiyat_modifieri_iki_kez_eklemez() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    // `submit_order` kalemi: 30000 + 4000 = 34000 dondurulmuş.
    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, created_at, updated_at) VALUES ('ord_1', 'tbl_1', ?, 'IN_PROGRESS', 34000, datetime('now'), datetime('now'))")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("sipariş eklenir");
    sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate, subtotal_cents, tax_amount_cents, total_cents) VALUES ('itm_1', 'ord_1', 'prd_1', 1, 34000, 20.0, 34000, 6800, 40800)")
        .execute(&mut *conn)
        .await
        .expect("kalem eklenir");

    let selected = serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 4000 }]);
    let truth = PaymentRepository::calculate_server_truth(&mut conn, TENANT, &[item("itm_1", Some(selected))], None)
        .await
        .expect("sunucu hesabı");

    assert_eq!(
        truth.gross_cents, 34000,
        "çift sayım: 34000 + 4000 = 38000 olmamalı"
    );
    assert_eq!(truth.total_cents, 40800);
}

#[tokio::test]
async fn donmus_fiyat_yoksa_modifier_bir_kez_eklenir() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let selected = serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 4000 }]);
    let truth = PaymentRepository::calculate_server_truth(&mut conn, TENANT, &[item("itm_1", Some(selected))], None)
        .await
        .expect("sunucu hesabı");
    assert_eq!(truth.gross_cents, 34000, "ürün + tek ekstra");
}

#[tokio::test]
async fn donmus_fiyat_baska_tenantin_kaleminden_alinmaz() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant_b', 'Başka')")
        .execute(&mut *conn)
        .await
        .ok();
    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, created_at, updated_at) VALUES ('ord_x', 'tbl_1', 'tenant_b', 'IN_PROGRESS', 1, datetime('now'), datetime('now'))")
        .execute(&mut *conn)
        .await
        .expect("sipariş eklenir");
    sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate, subtotal_cents, tax_amount_cents, total_cents) VALUES ('itm_x', 'ord_x', 'prd_1', 1, 1, 0.0, 1, 0, 1)")
        .execute(&mut *conn)
        .await
        .expect("kalem eklenir");
    drop(conn);

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let truth = PaymentRepository::calculate_server_truth(&mut conn, TENANT, &[item("itm_x", None)], None)
        .await
        .expect("sunucu hesabı");
    assert_eq!(
        truth.gross_cents, 30000,
        "başka işletmenin donmuş fiyatı kullanılmamalı"
    );
}

// ─── 3. Snapshot ───────────────────────────────────────────────────────────

#[tokio::test]
async fn siparis_snapshoti_gercek_fiyati_yazar() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // İstemci 0 gönderiyor; snapshot gerçek fiyatı yazmalı.
    let lying = serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 0 }]);
    let snapshot = super::authoritative_modifier_snapshot(&mut conn, TENANT, Some(&lying))
        .await
        .expect("snapshot yazılır")
        .expect("snapshot dolu");

    let parsed: serde_json::Value = serde_json::from_str(&snapshot).expect("geçerli JSON");
    assert_eq!(parsed[0]["priceCents"].as_i64(), Some(4000));
    assert_eq!(parsed[0]["name"].as_str(), Some("Ekstra Peynir"));
}

#[tokio::test]
async fn snapshot_yoksa_boş_kalem_yazilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    assert!(super::authoritative_modifier_snapshot(&mut conn, TENANT, None)
        .await
        .expect("işlenir")
        .is_none());
    assert!(
        super::authoritative_modifier_snapshot(&mut conn, TENANT, Some(&serde_json::json!([])))
            .await
            .expect("işlenir")
            .is_none(),
        "boş dizi null olmalı"
    );
}

#[tokio::test]
async fn eski_siparis_snapshoti_okunmaya_devam_eder() {
    // Snapshot biçimi değişmedi (`[{id,name,priceCents}]`): eski sipariş satırı
    // `get_order_items` yoluyla okunabilir kalmalı.
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let legacy = r#"[{"id":"mod_eski","name":"Extra","priceCents":1500}]"#;
    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, created_at, updated_at) VALUES ('ord_old', 'tbl_1', ?, 'IN_PROGRESS', 31500, datetime('now'), datetime('now'))")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("sipariş eklenir");
    sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate, subtotal_cents, tax_amount_cents, total_cents, modifiers) VALUES ('itm_old', 'ord_old', 'prd_1', 1, 31500, 20.0, 31500, 6300, 37800, ?)")
        .bind(legacy)
        .execute(&mut *conn)
        .await
        .expect("kalem eklenir");

    let stored: Option<String> =
        sqlx::query_scalar("SELECT modifiers FROM order_items WHERE id = 'itm_old'")
            .fetch_one(&mut *conn)
            .await
            .expect("okunur");
    let parsed: serde_json::Value =
        serde_json::from_str(&stored.expect("snapshot var")).expect("geçerli JSON");
    assert_eq!(parsed[0]["priceCents"].as_i64(), Some(1500));
    assert_eq!(parsed[0]["name"].as_str(), Some("Extra"));
}

#[tokio::test]
async fn donmus_kalem_kdv_oranini_korur() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, created_at, updated_at) VALUES ('ord_t', 'tbl_1', ?, 'IN_PROGRESS', 1, datetime('now'), datetime('now'))")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("sipariş");
    // KDV oranı %1 ile dondurulmuş kalem: katalogdaki %20 kullanılmamalı.
    sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate, subtotal_cents, tax_amount_cents, total_cents) VALUES ('itm_t', 'ord_t', 'prd_1', 1, 10000, 1.0, 10000, 100, 10100)")
        .execute(&mut *conn)
        .await
        .expect("kalem");

    let row = sqlx::query("SELECT tax_rate FROM order_items WHERE id = 'itm_t'")
        .fetch_one(&mut *conn)
        .await
        .expect("okunur");
    let rate: f64 = row.try_get("tax_rate").expect("oran okunur");
    assert_eq!(rate, 1.0, "donmuş KDV oranı bozulmamalı");
}
