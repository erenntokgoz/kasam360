//! `report_service` testleri (Faz 5).
//!
//! Kapsam karar kurallarıdır: **tenant izolasyonu**, tarih aralığı filtresi,
//! kuruş bütünlüğü ve "kim onayladı" bilgisinin taşınması. İçerik uyduran
//! ("şu satır şu çıkar" gibi sabit listeye dayanan) testler yazılmaz.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");

const TENANT_A: &str = "tenant_a";
const TENANT_B: &str = "tenant_b";

/// Denetim defteri `previous_hash` alanı için geçerli bir onaltılık dizi.
const HASH_ZEROS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

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

async fn conn_of(pool: &sqlx::SqlitePool) -> sqlx::pool::PoolConnection<sqlx::Sqlite> {
    pool.acquire().await.expect("bağlantı alınır")
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
        .bind(id)
        .execute(pool)
        .await
        .expect("masa eklenir");
}

async fn seed_category(pool: &sqlx::SqlitePool, tenant: &str, id: &str) {
    sqlx::query("INSERT OR IGNORE INTO categories (id, tenant_id, name, display_order) VALUES (?, ?, ?, 0)")
        .bind(id)
        .bind(tenant)
        .bind(id)
        .execute(pool)
        .await
        .expect("kategori eklenir");
}

async fn seed_product(pool: &sqlx::SqlitePool, tenant: &str, id: &str, category_id: &str) {
    sqlx::query(
        "INSERT OR IGNORE INTO products (id, tenant_id, name, price_cents, tax_rate, category_id, is_active) \
         VALUES (?, ?, ?, 10000, 20.0, ?, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .bind(category_id)
    .execute(pool)
    .await
    .expect("ürün eklenir");
}

/// `orders` tablosunun CHECK kısıtı yalnız bu durumları kabul eder.
async fn seed_order(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    id: &str,
    table_id: &str,
    total_cents: i64,
    created_at: &str,
    status: &str,
) {
    seed_table(pool, tenant, table_id).await;
    sqlx::query(
        "INSERT OR REPLACE INTO orders (id, tenant_id, table_id, status, total_cents, created_at, updated_at, cashier_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(tenant)
    .bind(table_id)
    .bind(status)
    .bind(total_cents)
    .bind(created_at)
    .bind(created_at)
    .bind(format!("usr_{}", tenant))
    .execute(pool)
    .await
    .expect("sipariş eklenir");
}

async fn seed_order_item(
    pool: &sqlx::SqlitePool,
    item_id: &str,
    order_id: &str,
    product_id: &str,
    quantity: i64,
    total_cents: i64,
) {
    sqlx::query(
        "INSERT OR REPLACE INTO order_items \
         (id, order_id, product_id, quantity, unit_price_cents, tax_rate, subtotal_cents, tax_amount_cents, total_cents, status) \
         VALUES (?, ?, ?, ?, 0, 0.0, ?, 0, ?, 'Sent')",
    )
    .bind(item_id)
    .bind(order_id)
    .bind(product_id)
    .bind(quantity)
    .bind(total_cents)
    .bind(total_cents)
    .execute(pool)
    .await
    .expect("kalem eklenir");
}

/// Denetim defteri satırı elle yazılır: testler hash zincirini değil, raporun
/// okuma kararını denetler. Zincir trigger'ı `previous_hash` değerinin bir
/// önceki kaydın `current_hash` ile birebir aynı olmasını zorunlu tutar.
async fn seed_audit(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    seq: i64,
    action: &str,
    resource_id: &str,
    actor_id: &str,
    payload: &serde_json::Value,
    timestamp: &str,
) {
    let previous_hash: String =
        sqlx::query_scalar("SELECT current_hash FROM audit_ledger ORDER BY sequence DESC LIMIT 1")
            .fetch_optional(pool)
            .await
            .expect("defter ucu okunur")
            .unwrap_or_else(|| HASH_ZEROS.to_string());

    sqlx::query(
        "INSERT INTO audit_ledger \
         (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload, previous_hash, current_hash, hash_version) \
         VALUES (?, ?, ?, ?, ?, 'OWNER', 'SISTEM', ?, ?, ?, ?, ?, 1)",
    )
    .bind(format!("aud_{}_{}", tenant, seq))
    .bind(tenant)
    .bind(seq)
    .bind(timestamp)
    .bind(actor_id)
    .bind(action)
    .bind(resource_id)
    .bind(payload.to_string())
    .bind(previous_hash)
    // Denetim defteri trigger'ları hash'in 64 karakterlik SHA-256 onaltılık
    // olduğunu doğrular; test kaydı da bu kurala uyar.
    .bind(format!("{:064x}", seq))
    .execute(pool)
    .await
    .expect("denetim kaydı eklenir");
}

fn range(from: &str, to: &str) -> ReportRange {
    ReportRange::new(from, to)
}

const ARALIK: (&str, &str) = ("2026-01-01T00:00:00+00:00", "2026-12-31T23:59:59+00:00");

// ─── Satış raporu ────────────────────────────────────────────────────────────

#[tokio::test]
async fn ciro_yalnizca_paid_siparislerden_hesaplanir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(&pool, TENANT_A, "ord_paid", "tbl_1", 45000, "2026-03-05 12:00:00", "PAID").await;
    seed_order(&pool, TENANT_A, "ord_open", "tbl_1", 99000, "2026-03-05 12:05:00", "OPEN").await;
    let mut conn = conn_of(&pool).await;

    let report = sales_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert_eq!(report.total_revenue_cents, 45000, "açık sipariş cirosa girmemeli");
    assert_eq!(report.total_orders, 1);
    assert_eq!(report.average_order_value_cents, 45000);
}

#[tokio::test]
async fn baska_tenantin_cirosu_rapora_girmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_order(&pool, TENANT_A, "ord_a", "tbl_a", 10000, "2026-03-05 12:00:00", "PAID").await;
    seed_order(&pool, TENANT_B, "ord_b", "tbl_b", 999000, "2026-03-05 12:00:00", "PAID").await;
    let mut conn = conn_of(&pool).await;

    let a_report = sales_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("A raporu okunur");
    assert_eq!(a_report.total_revenue_cents, 10000, "çapraz tenant sızıntısı");
}

#[tokio::test]
async fn tarih_araligi_disi_kalan_siparisler_hicelenmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(&pool, TENANT_A, "ord_inside", "tbl_1", 10000, "2026-03-10 12:00:00", "PAID").await;
    seed_order(&pool, TENANT_A, "ord_before", "tbl_1", 70000, "2025-12-31 23:00:00", "PAID").await;
    seed_order(&pool, TENANT_A, "ord_after", "tbl_1", 80000, "2026-06-01 09:00:00", "PAID").await;
    let mut conn = conn_of(&pool).await;

    let report = sales_report(
        &mut conn,
        TENANT_A,
        &range("2026-03-01T00:00:00+00:00", "2026-03-31T23:59:59+00:00"),
    )
    .await
    .expect("rapor okunur");

    assert_eq!(report.total_orders, 1, "yalnız aralıktaki sipariş sayılmalı");
    assert_eq!(report.total_revenue_cents, 10000);
}

#[tokio::test]
async fn odeme_yontemi_yuzdesi_kuru_toplamdan_guncellenir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_audit(
        &pool,
        TENANT_A,
        1,
        "payment:settled_fifo",
        "ord_1",
        "usr_1",
        &serde_json::json!({ "method": "Nakit", "totalAmount": 2500 }),
        "2026-03-05 12:00:00",
    )
    .await;
    seed_audit(
        &pool,
        TENANT_A,
        2,
        "payment:settled_fifo",
        "ord_2",
        "usr_1",
        &serde_json::json!({ "method": "Kredi Kartı", "totalAmount": 7500 }),
        "2026-03-05 12:10:00",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let report = sales_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert_eq!(report.payment_methods.len(), 2);
    let nakit = report
        .payment_methods
        .iter()
        .find(|m| m.method == "Nakit")
        .expect("nakit satırı");
    assert_eq!(nakit.amount_cents, 2500);
    assert_eq!(nakit.share_percent, 25);
    let kart = report
        .payment_methods
        .iter()
        .find(|m| m.method == "Kredi Kartı")
        .expect("kart satırı");
    assert_eq!(kart.share_percent, 75);
}

#[tokio::test]
async fn kategori_hacmi_baska_tenant_urununu_saymaz() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_category(&pool, TENANT_A, "cat_a").await;
    seed_category(&pool, TENANT_B, "cat_b").await;
    seed_product(&pool, TENANT_A, "prd_a", "cat_a").await;
    seed_product(&pool, TENANT_B, "prd_b", "cat_b").await;
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 30000, "2026-03-05 12:00:00", "PAID").await;
    seed_order_item(&pool, "it_1", "ord_1", "prd_a", 3, 30000).await;
    let mut conn = conn_of(&pool).await;

    let report = sales_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert_eq!(report.category_volume.len(), 1);
    assert_eq!(report.category_volume[0].name, "cat_a");
    assert_eq!(report.category_volume[0].quantity, 3);
    assert_eq!(report.category_volume[0].total_cents, 30000);
}

// ─── Vardiya raporu ──────────────────────────────────────────────────────────

#[tokio::test]
async fn vardiya_raporu_kasiyer_adini_birlestirir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, is_active) VALUES (?, ?, 'CASHIER', ?, 1)",
    )
    .bind("usr_cashier")
    .bind(TENANT_A)
    .bind("Elif Kasa")
    .execute(&pool)
    .await
    .expect("kullanıcı eklenir");
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents, actual_amount_cents, difference_cents) \
         VALUES ('shf_1', ?, 'usr_cashier', 'CLOSED', '2026-03-05 08:00:00', '2026-03-05 20:00:00', 10000, 10500, 500)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");

    let mut conn = conn_of(&pool).await;
    let rows = shift_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1), 50)
        .await
        .expect("vardiya raporu okunur");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].cashier_name, "Elif Kasa");
    assert_eq!(rows[0].difference_cents, Some(500));
}

#[tokio::test]
async fn vardiya_raporu_baska_tenantin_vardiyasini_gormez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents) \
         VALUES ('shf_b', ?, 'usr_b', 'OPEN', '2026-03-05 08:00:00', 50000)",
    )
    .bind(TENANT_B)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");
    let mut conn = conn_of(&pool).await;

    let rows = shift_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1), 50)
        .await
        .expect("vardiya raporu okunur");
    assert!(rows.is_empty(), "çapraz tenant sızıntısı");
}

// ─── Fiş raporu ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn fis_raporu_kalem_toplamini_tek_sorguda_getirir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_category(&pool, TENANT_A, "cat_a").await;
    seed_product(&pool, TENANT_A, "prd_a", "cat_a").await;
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 42000, "2026-03-05 12:00:00", "PAID").await;
    seed_order_item(&pool, "it_1", "ord_1", "prd_a", 2, 20000).await;
    seed_order_item(&pool, "it_2", "ord_1", "prd_a", 1, 22000).await;
    let mut conn = conn_of(&pool).await;

    let rows = receipts_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1), 50)
        .await
        .expect("fiş raporu okunur");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].item_count, 2);
    assert_eq!(rows[0].items_total_cents, 42000);
    assert_eq!(rows[0].status, "PAID");
}

#[tokio::test]
async fn fis_raporu_baska_tenantin_fisini_gormez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_order(&pool, TENANT_B, "ord_b", "tbl_b", 77000, "2026-03-05 12:00:00", "PAID").await;
    let mut conn = conn_of(&pool).await;

    let rows = receipts_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1), 50)
        .await
        .expect("fiş raporu okunur");
    assert!(rows.is_empty(), "çapraz tenant sızıntısı");
}

// ─── İptal / iade / zayi ────────────────────────────────────────────────────

#[tokio::test]
async fn iptal_kaydi_onaylayani_birlikte_getirir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_audit(
        &pool,
        TENANT_A,
        1,
        "order:voided",
        "ord_9",
        "usr_voider",
        &serde_json::json!({
            "orderId": "ord_9",
            "reason": "müşteri iptali",
            "orderTotalCents": 33000,
            "approverId": "usr_manager",
            "approverRole": "MANAGER"
        }),
        "2026-03-05 13:00:00",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let report = adjustments_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert_eq!(report.rows.len(), 1);
    let row = &report.rows[0];
    assert_eq!(row.kind, "VOID");
    assert_eq!(row.amount_cents, 33000);
    assert_eq!(row.actor_id, "usr_voider");
    assert_eq!(row.approver_id, "usr_manager");
    assert_eq!(row.approver_role, "MANAGER");
    assert_eq!(row.reason, "müşteri iptali");
}

#[tokio::test]
async fn kaydi_bulunmayan_hareket_turu_bildirilir_sifir_sayilmaz() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let report = adjustments_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert!(report.rows.is_empty());
    // Uydurma "0 ₺" yerine "bu tür için kayıt yok" bildirilir.
    assert!(report.kinds_without_records.contains(&"VOID".to_string()));
    assert!(report.kinds_without_records.contains(&"REFUND".to_string()));
    assert!(report.kinds_without_records.contains(&"WASTE".to_string()));
}

#[tokio::test]
async fn iptal_kaydi_baska_tenantin_raporuna_girmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_audit(
        &pool,
        TENANT_B,
        1,
        "order:voided",
        "ord_b",
        "usr_b",
        &serde_json::json!({ "orderTotalCents": 500000, "approverId": "usr_b_mgr" }),
        "2026-03-05 13:00:00",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let report = adjustments_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");
    assert!(report.rows.is_empty(), "çapraz tenant sızıntısı");
}

// ─── Aralık yardımcısı ───────────────────────────────────────────────────────

#[tokio::test]
async fn aralik_gun_sayisi_yalniz_gozlem_icin_hesaplanir() {
    assert_eq!(
        range("2026-03-01T00:00:00+00:00", "2026-03-07T00:00:00+00:00").days(),
        7
    );
    // Ters veya bozuk aralık bir gün olarak davranır; rapor boş döner, panik yok.
    assert_eq!(
        range("2026-03-07T00:00:00+00:00", "2026-03-01T00:00:00+00:00").days(),
        1
    );
    assert_eq!(range("bozuk", "bozuk").days(), 1);
}