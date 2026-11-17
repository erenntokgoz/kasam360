//! e-Belge testlerinin ortak tohumları ve kısa yardımcıları.

use sqlx::SqlitePool;

use super::queue::{self, QueueEntry};
use super::settings::{self, EDocumentSettings};
use crate::services::audit_service::AuditLock;
use crate::services::cash_flow_test_support::{pool, seed_order, seed_payment, seed_table};

pub use crate::services::cash_flow_test_support::{TENANT_A, TENANT_B};

pub const ACTOR: &str = "usr_sahip";

pub async fn fresh_pool() -> SqlitePool {
    pool().await
}

pub fn valid_settings(enabled: bool) -> EDocumentSettings {
    EDocumentSettings {
        enabled,
        tax_id: "0690000001".to_string(),
        legal_name: "Örnek Lokanta Ltd. Şti.".to_string(),
        tax_office: "Küçükçekmece".to_string(),
        series_code: "ADS".to_string(),
        street: "Florya Cd. No:7".to_string(),
        district: "Bakırköy".to_string(),
        city: "İstanbul".to_string(),
    }
}

pub async fn save_settings(
    pool: &SqlitePool,
    tenant: &str,
    input: &EDocumentSettings,
) -> Result<EDocumentSettings, String> {
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    settings::save(&mut conn, &lock, tenant, ACTOR, "OWNER", input).await
}

pub async fn enable(pool: &SqlitePool, tenant: &str) {
    save_settings(pool, tenant, &valid_settings(true))
        .await
        .expect("ayar kaydedilir");
}

pub async fn draft(pool: &SqlitePool, tenant: &str, order_id: &str) -> Result<QueueEntry, String> {
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    queue::create_draft(&mut conn, &lock, tenant, ACTOR, "OWNER", order_id).await
}

pub async fn submit(pool: &SqlitePool, tenant: &str, id: &str) -> Result<QueueEntry, String> {
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    queue::submit(&mut conn, &lock, tenant, ACTOR, "OWNER", id).await
}

pub async fn retry(pool: &SqlitePool, tenant: &str, id: &str) -> Result<QueueEntry, String> {
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    queue::retry(&mut conn, &lock, tenant, ACTOR, "OWNER", id).await
}

pub async fn entry(pool: &SqlitePool, tenant: &str, id: &str) -> Option<QueueEntry> {
    let mut conn = pool.acquire().await.expect("bağlantı");
    queue::find(&mut conn, tenant, id).await.expect("okunur")
}

/// Ödenmiş adisyon: iki kalem (%10 ve %8 KDV), 158,00 TL, nakit 100,00 + kart 58,00.
pub async fn seed_paid_order(pool: &SqlitePool, tenant: &str, order_id: &str) {
    let user = format!("usr_{tenant}");
    let table = format!("tbl_{order_id}");
    let _ = sqlx::query(
        "INSERT OR IGNORE INTO users (id, tenant_id, role, name) VALUES (?, ?, 'CASHIER', 'Ayşe')",
    )
    .bind(&user)
    .bind(tenant)
    .execute(pool)
    .await;
    seed_table(pool, tenant, &table, "B11").await;
    seed_order(pool, tenant, order_id, &table, "PAID", 15800, &user).await;
    for (suffix, name, bp) in [("cay", "Çay & Simit", 1000_i64), ("su", "Su", 800)] {
        sqlx::query(
            "INSERT OR IGNORE INTO products (id, tenant_id, sku, name, price_cents, tax_rate_bp) \
             VALUES (?, ?, ?, ?, 100, ?)",
        )
        .bind(format!("prd_{tenant}_{suffix}"))
        .bind(tenant)
        .bind(format!("sku_{tenant}_{suffix}"))
        .bind(name)
        .bind(bp)
        .execute(pool)
        .await
        .expect("ürün eklenir");
    }
    for (suffix, qty, unit, bp, net, tax, total) in [
        (
            "cay", 2_i64, 2500_i64, 1000_i64, 4545_i64, 455_i64, 5000_i64,
        ),
        ("su", 1, 10800, 800, 10000, 800, 10800),
    ] {
        sqlx::query(
            "INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price_cents, \
                tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Served')",
        )
        .bind(format!("itm_{order_id}_{suffix}"))
        .bind(tenant)
        .bind(order_id)
        .bind(format!("prd_{tenant}_{suffix}"))
        .bind(qty)
        .bind(unit)
        .bind(bp)
        .bind(net)
        .bind(tax)
        .bind(total)
        .execute(pool)
        .await
        .expect("kalem eklenir");
    }
    seed_payment(
        pool,
        tenant,
        order_id,
        &format!("txn_{order_id}"),
        &user,
        10000,
        5800,
        "2026-03-01T14:20:00+00:00",
    )
    .await;
}
