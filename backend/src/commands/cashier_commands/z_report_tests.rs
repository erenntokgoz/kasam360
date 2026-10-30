//! Z raporu kaynakları ve gün sonu kapısı.

use super::*;
use crate::commands::day_close_commands::day_close_blocker;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

const TENANT: &str = "tnt_a";

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .in_memory(true)
                .foreign_keys(true),
        )
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name, tax_id) VALUES ('tnt_a', 'Deniz', '123');
         INSERT INTO users (id, tenant_id, role, name) VALUES ('usr_1', 'tnt_a', 'CASHIER', 'Ali');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents)
            VALUES ('prd_1', 'tnt_a', 'cat_1', 'Çay', 1000);
         INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_1', 'tnt_a', 'Masa 1');
         INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, closed_at,
                             expected_amount_cents, actual_amount_cents, difference_cents)
            VALUES ('shf_abcdef', 'tnt_a', 'usr_1', 'CLOSED', datetime('now', '-1 hour'),
                    datetime('now', '+1 minute'), 500, 450, -50);
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents)
            VALUES ('ord_1', 'tnt_a', 'tbl_1', 'PAID', 1100);
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price_cents,
                                  tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status)
            VALUES ('itm_1', 'tnt_a', 'ord_1', 'prd_1', 1, 1000, 1000, 1000, 100, 1100, 'Pending'),
                   ('itm_2', 'tnt_a', 'ord_1', 'prd_1', 1, 1000, 1000, 1000, 100, 1100, 'CANCELLED');
         INSERT INTO refunds (id, tenant_id, original_transaction_id, compensation_txn_id,
                              amount_cents, reason, method, actor_id)
            VALUES ('ref_1', 'tnt_a', 'txn_1', 'ref_1', 200, 'test', 'CREDIT_CARD', 'usr_1');",
    )
    .execute(&pool)
    .await
    .expect("kayıt");
    pool
}

#[tokio::test]
async fn z_raporu_kayitli_kaynaklardan_kurulur() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let report = build_z_report(&mut conn, TENANT, "shf_abcdef")
        .await
        .expect("rapor");
    assert_eq!(report.report_number, "Z-ABCDEF");
    assert_eq!(report.tenant_name, "Deniz");
    assert_eq!(report.tax_number.as_deref(), Some("123"));
    assert_eq!(report.cashier_name.as_deref(), Some("Ali"));
    // İptal kalemin KDV'si rapora girmez.
    assert_eq!(report.total_vat_cents, 100);
    assert_eq!(report.order_count, 1);
    assert_eq!(report.refund_total_cents, 200);
    assert_eq!(report.counted_cash_cents, 450);
    assert_eq!(report.difference_cents, -50);
}

#[tokio::test]
async fn acik_veya_sayimsiz_vardiyada_z_raporu_uretilmez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    sqlx::query("UPDATE shifts SET actual_amount_cents = NULL, difference_cents = NULL")
        .execute(&mut *conn)
        .await
        .expect("sayımsız");
    assert!(build_z_report(&mut conn, TENANT, "shf_abcdef")
        .await
        .expect_err("sayım")
        .contains("sayımı"));
    sqlx::query("UPDATE shifts SET status = 'OPEN', closed_at = NULL")
        .execute(&mut *conn)
        .await
        .expect("açık");
    assert!(build_z_report(&mut conn, TENANT, "shf_abcdef")
        .await
        .expect_err("açık")
        .starts_with("INVALID_STATE"));
}

#[tokio::test]
async fn gun_sonu_kapisi_acik_adisyon_acik_vardiya_ve_acik_farki_durdurur() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert!(day_close_blocker(&mut conn, TENANT)
        .await
        .expect("kapı")
        .expect("fark")
        .starts_with("UNEXPLAINED_DIFFERENCE"));

    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let ctx = AuditContext::new(
        TENANT.to_string(),
        "usr_1".to_string(),
        "CASHIER".to_string(),
        category::FINANS,
        "shift:difference_explained",
        "shf_abcdef".to_string(),
        serde_json::json!({ "note": "para üstü hatası" }),
        chrono::Utc::now().to_rfc3339(),
    )
    .expect("kayıt");
    AuditService::append(&mut conn, &lock, &ctx)
        .await
        .expect("açıklama");
    assert_eq!(
        day_close_blocker(&mut conn, TENANT).await.expect("kapı"),
        None
    );

    sqlx::query("UPDATE orders SET status = 'IN_PROGRESS'")
        .execute(&mut *conn)
        .await
        .expect("adisyon");
    assert!(day_close_blocker(&mut conn, TENANT)
        .await
        .expect("kapı")
        .expect("adisyon")
        .starts_with("OPEN_ORDERS"));

    sqlx::query("UPDATE orders SET status = 'PAID'")
        .execute(&mut *conn)
        .await
        .expect("adisyon");
    sqlx::query("UPDATE shifts SET status = 'OPEN'")
        .execute(&mut *conn)
        .await
        .expect("vardiya");
    assert!(day_close_blocker(&mut conn, TENANT)
        .await
        .expect("kapı")
        .expect("vardiya")
        .starts_with("SHIFT_OPEN"));
}
