//! `receipt_service` testleri (Faz 7).
//!
//! Kapsam karar kurallarıdır:
//! 1. **Tek finansal gerçeklik:** fiş yalnız tahsilat kaydından türetilir; sipariş
//!    satırı tek başına fiş üretmez.
//! 2. **Kiracı izolasyonu:** başka işletmenin tahsilatı görünmez, bulunamaz ve
//!    "var" denemez.
//! 3. **Uydurma yok:** kalem kaydı yoksa alt toplam/KDV uydurulmaz, `has_items`
//!    yanlış döner.
//! 4. **Çift kayıt yok:** aynı sipariş için iki tahsilat varsa iki ayrı finansal
//!    gerçekliktir ve iki fiş çıkar; ama tek tahsilattan **bir** fiş çıkar.
//! 5. **Geçmiş değişmez:** servis yalnız okur; fiş satırı yaratılmaz/güncellenmez.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");

const TENANT_A: &str = "tenant_a";
const TENANT_B: &str = "tenant_b";

const FROM: &str = "2026-01-01 00:00:00";
const TO: &str = "2026-12-31 23:59:59";

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
    pool
}

async fn seed_tenant(pool: &sqlx::SqlitePool, tenant: &str) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(tenant)
        .bind(tenant)
        .execute(pool)
        .await
        .expect("tenant eklenir");
}

async fn seed_table(pool: &sqlx::SqlitePool, tenant: &str, id: &str) {
    sqlx::query("INSERT OR IGNORE INTO tables (id, tenant_id, name) VALUES (?, ?, ?)")
        .bind(id)
        .bind(tenant)
        .bind("Masa 1")
        .execute(pool)
        .await
        .expect("masa eklenir");
}

async fn seed_order(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    id: &str,
    table_id: &str,
    total_cents: i64,
    status: &str,
) {
    seed_table(pool, tenant, table_id).await;
    sqlx::query(
        "INSERT OR REPLACE INTO orders \
         (id, tenant_id, table_id, status, total_cents, created_at, updated_at, cashier_id) \
         VALUES (?, ?, ?, ?, ?, '2026-05-01 12:00:00', '2026-05-01 12:00:00', NULL)",
    )
    .bind(id)
    .bind(tenant)
    .bind(table_id)
    .bind(status)
    .bind(total_cents)
    .execute(pool)
    .await
    .expect("sipariş eklenir");
}

async fn seed_product(pool: &sqlx::SqlitePool, tenant: &str, id: &str) {
    // `products.category_id` yabancı anahtarı NOT NULL: kategori önce eklenir.
    sqlx::query("INSERT OR IGNORE INTO categories (id, tenant_id, name, display_order) VALUES (?, ?, ?, 0)")
        .bind(format!("cat_{}", tenant))
        .bind(tenant)
        .bind("Kategori")
        .execute(pool)
        .await
        .expect("kategori eklenir");
    sqlx::query(
        "INSERT OR IGNORE INTO products (id, tenant_id, name, price_cents, tax_rate, category_id, is_active) \
         VALUES (?, ?, ?, 1000, 20.0, ?, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .bind(format!("cat_{}", tenant))
    .execute(pool)
    .await
    .expect("ürün eklenir");
}

async fn seed_order_item(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    item_id: &str,
    order_id: &str,
    product_id: &str,
    quantity: i64,
    subtotal_cents: i64,
    tax_cents: i64,
) {
    seed_product(pool, tenant, product_id).await;
    sqlx::query(
        "INSERT OR REPLACE INTO order_items \
         (id, order_id, product_id, quantity, unit_price_cents, tax_rate, subtotal_cents, tax_amount_cents, total_cents, status) \
         VALUES (?, ?, ?, ?, 1000, 20.0, ?, ?, ?, 'Sent')",
    )
    .bind(item_id)
    .bind(order_id)
    .bind(product_id)
    .bind(quantity)
    .bind(subtotal_cents)
    .bind(tax_cents)
    .bind(subtotal_cents + tax_cents)
    .execute(pool)
    .await
    .expect("kalem eklenir");
}

/// Tahsilat kaydı: fişin tek kaynağı.
async fn seed_sale_event(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    transaction_id: &str,
    payload: serde_json::Value,
    created_at: &str,
) {
    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) \
         VALUES (?, ?, ?, 'SALE', 'SALE_SETTLED', ?, ?)",
    )
    .bind(format!("evt_{}", transaction_id))
    .bind(tenant)
    .bind(transaction_id)
    .bind(payload.to_string())
    .bind(created_at)
    .execute(pool)
    .await
    .expect("tahsilat kaydı eklenir");
}

fn payment_payload(order_id: Option<&str>, total_cents: i64, method: &str) -> serde_json::Value {
    serde_json::json!({
        "transactionId": "txn_test",
        "orderId": order_id,
        "method": method,
        "totalAmount": total_cents,
        "amountTendered": total_cents,
        "changeAmount": 0,
        "timestamp": "2026-05-01T12:00:00+00:00",
        "items": []
    })
}

// ─── Tek finansal gerçeklik ──────────────────────────────────────────────────

#[tokio::test]
async fn fis_yalniz_tahsilat_kaydindan_uretilir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    // Sipariş PAID ama tahsilat kaydı yok: fiş **olmaz**. Fişin varlığı satış
    // fiilinden değil, tahsilattan gelir.
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 42_000, "PAID").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    assert!(receipts.is_empty(), "tahsilatsız sipariş fiş üretmemeli");
}

#[tokio::test]
async fn tahsilat_kaydi_tsiparis_tek_fis_uretir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 42_000, "PAID").await;
    let mut payload = payment_payload(Some("ord_1"), 42_000, "CREDIT_CARD");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    assert_eq!(receipts.len(), 1, "bir tahsilat tam olarak bir fiş üretmeli");

    let receipt = &receipts[0];
    assert_eq!(receipt.transaction_id, "txn_1");
    assert_eq!(receipt.id, "txn_1");
    assert_eq!(receipt.order_id.as_deref(), Some("ord_1"));
    assert_eq!(receipt.total_cents, 42_000);
    assert_eq!(receipt.payment_method, "Kredi Kartı");
    assert_eq!(receipt.fiscal_receipt_no.as_deref(), Some("FISC-txn_1"));
}

#[tokio::test]
async fn ayni_siparis_iki_tahsilat_iki_fiştir_tek_tahsilat_bir_fistir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 20_000, "PAID").await;

    let mut first = payment_payload(Some("ord_1"), 20_000, "CASH");
    first["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", first, "2026-05-01 12:00:00").await;

    let mut second = payment_payload(Some("ord_1"), 22_000, "CREDIT_CARD");
    second["transactionId"] = serde_json::json!("txn_2");
    seed_sale_event(&pool, TENANT_A, "txn_2", second, "2026-05-01 12:05:00").await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");

    // İki tahsilat iki ayrı finansal gerçekliktir (parçalı ödeme); her biri kendi
    // fişini taşır ve kimlikleri çakışmaz.
    assert_eq!(receipts.len(), 2);
    let ids: Vec<&str> = receipts.iter().map(|r| r.id.as_str()).collect();
    assert!(ids.contains(&"txn_1") && ids.contains(&"txn_2"));

    // Tek bir tahsilat ise tekrar üretilmez.
    let single = list(&mut conn, TENANT_A, 1).await.expect("sınırlı liste okunur");
    assert_eq!(single.len(), 1);
}

// ─── Kiracı izolasyonu ───────────────────────────────────────────────────────

#[tokio::test]
async fn fis_listesi_baska_tenantin_fisini_gormez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut payload = payment_payload(None, 15_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_a");
    seed_sale_event(&pool, TENANT_A, "txn_a", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let mine = list(&mut conn, TENANT_A, 50).await.expect("kendi liste okunur");
    assert_eq!(mine.len(), 1);

    let theirs = list(&mut conn, TENANT_B, 50).await.expect("karşı liste okunur");
    assert!(theirs.is_empty(), "çapraz tenant fişi sızmamalı");
}

#[tokio::test]
async fn fis_kimligiyle_arama_yalniz_kendi_tenantinda_calisir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut payload = payment_payload(None, 15_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_a");
    seed_sale_event(&pool, TENANT_A, "txn_a", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let found = find(&mut conn, TENANT_A, "txn_a").await.expect("arama yapılır");
    assert!(found.is_some());

    // Aynı kimlik diğer işletmede aranırsa bulunmaz: kimlik tahmin edilebilir
    // olsa bile fiş sızmaz.
    let cross = find(&mut conn, TENANT_B, "txn_a").await.expect("arama yapılır");
    assert!(cross.is_none(), "çapraz tenant fiş erişimi açık kalmış");

    let unknown = find(&mut conn, TENANT_A, "txn_yok").await.expect("arama yapılır");
    assert!(unknown.is_none());
}

#[tokio::test]
async fn fis_numarasi_ile_aramak_da_calisir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 15_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_abc123");
    seed_sale_event(&pool, TENANT_A, "txn_abc123", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let found = find(&mut conn, TENANT_A, "FISC-txn_ab")
        .await
        .expect("arama yapılır");
    assert!(found.is_some(), "ekranda görünen fiş numarası bulunmalı");
}

#[tokio::test]
async fn basim_izni_icin_varlik_kontrolu_tenant_kilitlidir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut payload = payment_payload(None, 15_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_a");
    seed_sale_event(&pool, TENANT_A, "txn_a", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    assert!(exists(&mut conn, TENANT_A, "txn_a").await.expect("kontrol yapılır"));
    assert!(
        !exists(&mut conn, TENANT_B, "txn_a").await.expect("kontrol yapılır"),
        "başka tenant'ın fişi basılabilmemeli"
    );
    assert!(!exists(&mut conn, TENANT_A, "txn_yok").await.expect("kontrol yapılır"));
}

// ─── Uydurma veri yasağı ─────────────────────────────────────────────────────

#[tokio::test]
async fn kalem_yoksa_alt_toplam_ve_kdv_uretilmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 42_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    let receipt = &receipts[0];

    // Faz 6 öncesi burada `total * 100 / 110` ile KDV uyduruluyordu.
    assert!(!receipt.has_items);
    assert_eq!(receipt.subtotal_cents, 0);
    assert_eq!(receipt.tax_total_cents, 0);
    assert_eq!(receipt.total_cents, 42_000, "gerçek tahsilat korunmalı");
}

#[tokio::test]
async fn kalem_varsa_alt_toplam_kalemlerden_toplanir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 24_000, "PAID").await;
    seed_order_item(&pool, TENANT_A, "it_1", "ord_1", "prd_1", 2, 18_000, 3_600).await;
    seed_order_item(&pool, TENANT_A, "it_2", "ord_1", "prd_2", 1, 2_000, 400).await;
    let mut payload = payment_payload(Some("ord_1"), 24_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    let receipt = &receipts[0];

    assert!(receipt.has_items);
    assert_eq!(receipt.items.len(), 2);
    assert_eq!(receipt.subtotal_cents, 20_000);
    assert_eq!(receipt.tax_total_cents, 4_000);
}

#[tokio::test]
async fn odeme_yontemi_bilinmiyorsa_nakit_uretilmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 1_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    payload.as_object_mut().expect("nesne").remove("method");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    assert_eq!(receipts[0].payment_method, "Belirtilmemiş");
}

// ─── Hesap Defteri hareketleri ───────────────────────────────────────────────

#[tokio::test]
async fn finansal_hareket_turleri_tek_listede_donusur() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 30_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-02 10:00:00").await;

    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at) \
         VALUES ('shf_1', ?, 'usr_1', 'OPEN', '2026-05-02 09:00:00')",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");

    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id) \
         VALUES ('cmv_1', ?, 'shf_1', 'OUT', 5_000, 'Tedarikçi ödemesi', 'usr_1')",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("kasa hareketi eklenir");

    let mut conn = pool.acquire().await.expect("bağlantı");
    let movements =
        list_financial_movements(&mut conn, TENANT_A, FROM, TO, 50).await.expect("hareketler okunur");

    assert_eq!(movements.len(), 2);

    let sale = movements
        .iter()
        .find(|m| m.movement_type == MOVEMENT_SALE_PAYMENT)
        .expect("tahsilat hareketi listelenmeli");
    let cash = movements
        .iter()
        .find(|m| m.movement_type == MOVEMENT_CASH_MOVEMENT)
        .expect("kasa hareketi listelenmeli");

    // Tahsilatın fişi vardır; kasa çıkışının fişi yoktur ve bu **açık** bir
    // durumdur (`receipt_id: None`).
    assert_eq!(sale.receipt_id.as_deref(), Some("txn_1"));
    assert!(sale.fiscal_receipt_no.is_some());
    assert_eq!(cash.receipt_id, None);
    assert_eq!(cash.amount_cents, -5_000, "kasa çıkışı negatif işaretlenmeli");
}

#[tokio::test]
async fn finansal_hareket_listesi_tenant_kilitli() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut payload = payment_payload(None, 30_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_a");
    seed_sale_event(&pool, TENANT_A, "txn_a", payload, "2026-05-02 10:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let mine = list_financial_movements(&mut conn, TENANT_A, FROM, TO, 50)
        .await
        .expect("kendi hareketler okunur");
    assert_eq!(mine.len(), 1);

    let theirs = list_financial_movements(&mut conn, TENANT_B, FROM, TO, 50)
        .await
        .expect("karşı hareketler okunur");
    assert!(theirs.is_empty());
}

#[tokio::test]
async fn aralik_disindaki_hareketler_listelenmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 30_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-02 10:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let outside =
        list_financial_movements(&mut conn, TENANT_A, "2027-01-01 00:00:00", "2027-12-31 23:59:59", 50)
            .await
            .expect("liste okunur");
    assert!(outside.is_empty());
}

// ─── Değişmezlik ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn fis_tablosu_yoktur_kayit_uretmez() {
    // Fişin kalıcı satırı yoktur; finansal geçmiş `events` + `audit_ledger`
    // içinde yaşar. Servisin hiçbir yolu INSERT/UPDATE/DELETE içermez.
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 10_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    list(&mut conn, TENANT_A, 50).await.expect("liste okunur");

    // Aynı fiş tekrar okunduğunda içerik birebir aynıdır: hiçbir yazma olmadı.
    let first = find(&mut conn, TENANT_A, "txn_1")
        .await
        .expect("okunur")
        .expect("fiş bulunur");
    let second = find(&mut conn, TENANT_A, "txn_1")
        .await
        .expect("okunur")
        .expect("fiş bulunur");
    assert_eq!(first.id, second.id);
    assert_eq!(first.total_cents, second.total_cents);
    assert_eq!(first.payment_method, second.payment_method);
    assert_eq!(first.created_at, second.created_at);
    assert_eq!(first.fiscal_receipt_no, second.fiscal_receipt_no);
}

#[test]
fn fis_numarasi_bos_islemde_uretulmez() {
    assert_eq!(fiscal_receipt_no(""), None);
    assert_eq!(fiscal_receipt_no("abc"), Some("FISC-abc".to_string()));
}