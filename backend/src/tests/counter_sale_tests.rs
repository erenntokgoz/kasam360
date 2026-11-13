//! Hızlı (tezgâh) satış: rol kapısı, masasız kayıt ve stoğun yalnız bir kez düşmesi.

use crate::commands::payment_commands::CartItemDto;
use crate::commands::pos_commands::{
    counter_sale_gate, execute_submit_order, SubmitOrderPayloadDto, COUNTER_TABLE,
};

async fn remaining(conn: &mut sqlx::SqliteConnection) -> f64 {
    sqlx::query_scalar("SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_1'")
        .fetch_one(conn)
        .await
        .expect("stok")
}

#[test]
fn tezgah_satisi_kasiyer_mudur_sahibe_acik_garson_mutfaga_kapali() {
    for role in ["OWNER", "MANAGER", "CASHIER"] {
        assert!(
            counter_sale_gate(COUNTER_TABLE, Some(role)).is_ok(),
            "{role}"
        );
    }
    for role in ["WAITER", "KITCHEN", "MASTER", "x"] {
        assert!(
            counter_sale_gate(COUNTER_TABLE, Some(role)).is_err(),
            "{role}"
        );
    }
    assert!(counter_sale_gate(COUNTER_TABLE, None).is_err());
    // Masa siparişinin kapısı bu fonksiyon değildir; garson masaya sipariş girmeye devam eder.
    assert!(counter_sale_gate("tbl_1", Some("WAITER")).is_ok());
}

#[tokio::test]
async fn tezgah_siparisi_masasiz_kaydolur_stok_bir_kez_duser() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    let mut conn = pool.acquire().await.expect("bağlantı");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'G');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents, tax_rate_bp)
            VALUES ('prd_1', 'tnt_a', 'cat_1', 'Simit', 1000, 1000);
         INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity,
                                        remaining_quantity, unit_cost_cents, received_at)
            VALUES ('bat_1', 'tnt_a', 'prd_1', 10, 10, 200, '2026-01-01');",
    )
    .execute(&mut *conn)
    .await
    .expect("veri");

    let (order_id, total) = execute_submit_order(
        &mut conn,
        "tnt_a",
        &SubmitOrderPayloadDto {
            table_id: COUNTER_TABLE.into(),
            items: vec![CartItemDto {
                id: "itm_1".into(),
                product: serde_json::json!({ "id": "prd_1" }),
                quantity: 3,
                ..Default::default()
            }],
            ..Default::default()
        },
        Some("usr_kasa"),
    )
    .await
    .expect("tezgâh siparişi");
    assert_eq!(total, 3000);

    // Sipariş görünmez tezgâh noktasına bağlıdır, salon masasına değil.
    let table: String = sqlx::query_scalar("SELECT table_id FROM orders WHERE id = ?")
        .bind(&order_id)
        .fetch_one(&mut *conn)
        .await
        .expect("masa");
    assert_eq!(table, "tbl_counter_tnt_a");
    let other_points: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM tables WHERE tenant_id = 'tnt_b'")
            .fetch_one(&mut *conn)
            .await
            .expect("sayım");
    assert_eq!(other_points, 0);

    assert_eq!(remaining(&mut conn).await, 7.0);

    // Kapanıştaki mutabakat stoğu yeniden düşmez.
    crate::services::order_stock::settle_order_lines(
        &mut conn,
        "tnt_a",
        &order_id,
        "2026-11-13T10:00:00+00:00",
    )
    .await
    .expect("kapanış");
    assert_eq!(remaining(&mut conn).await, 7.0);
}
