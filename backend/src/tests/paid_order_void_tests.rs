//! Ödenmiş siparişin kalemi iptal edilemez; iade ayrı akıştan yürür.
//! Yetkili onay jetonu bile bu kuralı aşmamalı, mutfak rolü iptal yapamamalıdır.

use crate::commands::payment_commands::CartItemDto;
use crate::commands::pos_commands::{execute_submit_order, SubmitOrderPayloadDto};
use crate::commands::void_commands::item_void::{execute_void_order_item, VoidOrderItemPayloadDto};
use crate::commands::void_commands::order_void::void_approval_request;
use crate::db::DbPool;
use crate::services::audit_service::AuditLock;
use sqlx::SqliteConnection;

const TENANT: &str = "t_paid_void";

async fn setup_pool() -> DbPool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory db açılmalı");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("schema.sql uygulanmalı");
    pool
}

/// Tek kalemli açık sipariş kurar ve (sipariş, kalem) kimliklerini döndürür.
async fn seed_order(conn: &mut SqliteConnection) -> (String, String) {
    sqlx::query("INSERT INTO categories (id, tenant_id, name, default_station) VALUES ('cat_v', ?1, 'Yemek', 'Mutfak')")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("kategori");
    sqlx::query("INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES ('tbl_v', ?1, 'Masa V', 'AVAILABLE', 0)")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("masa");
    sqlx::query("INSERT INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active) VALUES ('prd_v', ?1, 'Köfte', 24000, 1000, 'cat_v', 1)")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("ürün");
    let pin_hash = crate::user_credentials::hash_pin("2222").expect("PIN özeti");
    sqlx::query("INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active) VALUES ('usr_mgr', ?1, 'MANAGER', 'Müdür', ?2, 1)")
        .bind(TENANT)
        .bind(pin_hash)
        .execute(&mut *conn)
        .await
        .expect("müdür");

    let payload = SubmitOrderPayloadDto {
        order_id: String::new(),
        table_id: "tbl_v".into(),
        items: vec![CartItemDto {
            id: "i_v".into(),
            product: serde_json::json!({ "id": "prd_v" }),
            quantity: 1,
            ..Default::default()
        }],
        notes: None,
        waiter_id: Some("usr_garson".into()),
        guest_count: Some(2),
    };
    let (order_id, _) = execute_submit_order(conn, TENANT, &payload, Some("usr_garson"))
        .await
        .expect("sipariş verilmeli");
    let item_id: String =
        sqlx::query_scalar("SELECT id FROM order_items WHERE order_id = ?1 AND tenant_id = ?2")
            .bind(&order_id)
            .bind(TENANT)
            .fetch_one(&mut *conn)
            .await
            .expect("kalem");
    (order_id, item_id)
}

async fn try_void(
    conn: &mut SqliteConnection,
    item_id: &str,
    role: &str,
    with_token: bool,
) -> Result<bool, String> {
    let token = if with_token {
        let request = void_approval_request(TENANT, item_id, 24000, "usr_garson", role);
        Some(
            crate::approval_service::verify_and_issue(conn, &request, "2222")
                .await
                .expect("onay jetonu")
                .token,
        )
    } else {
        None
    };
    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = AuditLock::new(audit_mutex.lock().await);
    let payload = VoidOrderItemPayloadDto {
        item_id: item_id.into(),
        reason: "test".into(),
        actor_id: "usr_garson".into(),
        actor_role: role.into(),
        approval_token: token,
    };
    execute_void_order_item(conn, &audit_lock, TENANT, &payload).await
}

#[tokio::test]
async fn odenmis_siparisin_kalemi_onayli_bile_iptal_edilemez() {
    let pool = setup_pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let (order_id, item_id) = seed_order(&mut conn).await;

    // Şema yalnız PAID değerini kabul eder; CLOSED koruması koddaki ek savunmadır.
    for status in ["PAID"] {
        sqlx::query("UPDATE orders SET status = ?1 WHERE id = ?2 AND tenant_id = ?3")
            .bind(status)
            .bind(&order_id)
            .bind(TENANT)
            .execute(&mut *conn)
            .await
            .expect("durum");
        let err = try_void(&mut conn, &item_id, "WAITER", true)
            .await
            .expect_err("reddedilmeli");
        assert!(err.contains("CANNOT_VOID_PAID_ORDER"), "{status}: {err}");
    }
    let item_status: String =
        sqlx::query_scalar("SELECT status FROM order_items WHERE id = ?1 AND tenant_id = ?2")
            .bind(&item_id)
            .bind(TENANT)
            .fetch_one(&mut *conn)
            .await
            .expect("kalem durumu");
    assert_ne!(item_status, "CANCELLED", "ret sonrası kalem iptal olmamalı");
}

#[tokio::test]
async fn kismen_tahsil_edilmis_kalem_iptal_edilemez_mutfak_rolu_hic_iptal_edemez() {
    let pool = setup_pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let (_, item_id) = seed_order(&mut conn).await;

    let kitchen = try_void(&mut conn, &item_id, "KITCHEN", false)
        .await
        .expect_err("mutfak iptal edemez");
    assert!(kitchen.contains("UNAUTHORIZED"), "{kitchen}");

    sqlx::query("UPDATE order_items SET paid_quantity = 1 WHERE id = ?1 AND tenant_id = ?2")
        .bind(&item_id)
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("tahsilat");
    let paid = try_void(&mut conn, &item_id, "WAITER", true)
        .await
        .expect_err("tahsil edilen kalem");
    assert!(paid.contains("CANNOT_VOID_PAID_ITEM"), "{paid}");
}

#[tokio::test]
async fn garson_onay_jetonu_olmadan_kalem_iptal_edemez() {
    let pool = setup_pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let (_, item_id) = seed_order(&mut conn).await;

    let err = try_void(&mut conn, &item_id, "WAITER", false)
        .await
        .expect_err("onaysız iptal");
    assert!(
        err.to_uppercase().contains("TOKEN") || err.contains("ONAY") || err.contains("APPROVAL"),
        "{err}"
    );
}
