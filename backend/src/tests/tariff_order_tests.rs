//! Tarife yalnız bundan sonra eklenen kalemi etkiler; tükendi ve satış dışı ayrı reddedilir.

use crate::commands::payment_commands::CartItemDto;
use crate::commands::pos_commands::{execute_submit_order, SubmitOrderPayloadDto};

async fn setup_test_db() -> crate::db::DbPool {
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

#[tokio::test]
async fn tarife_acik_siparisin_eklenmis_kalemini_degistirmez() {
    use crate::services::inventory360::pricing::{save_tariff, set_active_tariff, TariffInput};
    let pool = setup_test_db().await;
    let mut conn = pool.acquire().await.expect("conn");
    let tenant = "t_tarife";
    sqlx::raw_sql(
        "INSERT INTO categories (id, tenant_id, name, default_station) VALUES ('cat_1', 't_tarife', 'İçecek', 'Bar');
         INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES ('tbl_1', 't_tarife', 'Masa 1', 'AVAILABLE', 0);
         INSERT INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active, is_86)
            VALUES ('prd_cay', 't_tarife', 'Çay', 1000, 1000, 'cat_1', 1, 0),
                   ('prd_kapali', 't_tarife', 'Eski Ürün', 1000, 1000, 'cat_1', 0, 0),
                   ('prd_bitti', 't_tarife', 'Sahlep', 1000, 1000, 'cat_1', 1, 1);",
    )
    .execute(&mut *conn)
    .await
    .expect("veri");
    let line = |id: &str, product: &str| CartItemDto {
        id: id.into(),
        product: serde_json::json!({ "id": product }),
        quantity: 1,
        ..Default::default()
    };
    let first = execute_submit_order(
        &mut conn,
        tenant,
        &SubmitOrderPayloadDto {
            order_id: "".into(),
            table_id: "tbl_1".into(),
            items: vec![line("i_1", "prd_cay")],
            ..Default::default()
        },
        Some("usr_garson"),
    )
    .await
    .expect("ilk kalem");

    let tariff = save_tariff(
        &mut conn,
        tenant,
        "usr_patron",
        TariffInput {
            id: None,
            name: "Canlı müzik".into(),
            kind: "OZEL".into(),
            percent: 50,
            product_ids: None,
            schedule: None,
        },
    )
    .await
    .expect("tarife");
    set_active_tariff(&mut conn, tenant, "usr_patron", Some(&tariff))
        .await
        .expect("tarife açılır");

    execute_submit_order(
        &mut conn,
        tenant,
        &SubmitOrderPayloadDto {
            order_id: first.0.clone(),
            table_id: "tbl_1".into(),
            items: vec![line("i_2", "prd_cay")],
            ..Default::default()
        },
        Some("usr_garson"),
    )
    .await
    .expect("tarifeli kalem");

    let prices: Vec<i64> = sqlx::query_scalar(
        "SELECT unit_price_cents FROM order_items WHERE tenant_id = ? AND order_id = ?
          ORDER BY rowid ASC",
    )
    .bind(tenant)
    .bind(&first.0)
    .fetch_all(&mut *conn)
    .await
    .expect("kalemler");
    assert_eq!(prices, vec![1000, 1500]);

    let off_sale = execute_submit_order(
        &mut conn,
        tenant,
        &SubmitOrderPayloadDto {
            order_id: first.0.clone(),
            table_id: "tbl_1".into(),
            items: vec![line("i_3", "prd_kapali")],
            ..Default::default()
        },
        Some("usr_garson"),
    )
    .await;
    assert!(off_sale.unwrap_err().contains("PRODUCT_INACTIVE"));
    let sold_out = execute_submit_order(
        &mut conn,
        tenant,
        &SubmitOrderPayloadDto {
            order_id: first.0,
            table_id: "tbl_1".into(),
            items: vec![line("i_4", "prd_bitti")],
            ..Default::default()
        },
        Some("usr_garson"),
    )
    .await;
    assert!(sold_out.unwrap_err().contains("PRODUCT_86D"));
}
