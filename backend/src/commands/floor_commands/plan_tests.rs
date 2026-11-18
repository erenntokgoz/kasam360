//! Salon planı sorgusu: kişi sayısı kalem sayısıyla çarpılmamalıdır.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

const TENANT: &str = "tnt_a";

async fn pool() -> sqlx::SqlitePool {
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
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents)
            VALUES ('prd_1', 'tnt_a', 'cat_1', 'Çay', 1000);
         INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_1', 'tnt_a', 'Masa 1');
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents, guest_count)
            VALUES ('ord_1', 'tnt_a', 'tbl_1', 'IN_PROGRESS', 3000, 4);
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price_cents,
                                  tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status)
            VALUES ('itm_1', 'tnt_a', 'ord_1', 'prd_1', 1, 1000, 1000, 1000, 100, 1100, 'Pending'),
                   ('itm_2', 'tnt_a', 'ord_1', 'prd_1', 1, 1000, 1000, 1000, 100, 1100, 'Pending'),
                   ('itm_3', 'tnt_a', 'ord_1', 'prd_1', 1, 1000, 1000, 1000, 100, 1100, 'Pending'),
                   ('itm_4', 'tnt_a', 'ord_1', 'prd_1', 1, 1000, 1000, 1000, 100, 1100, 'Pending');",
    )
    .execute(&pool)
    .await
    .expect("kayıt");
    pool
}

#[tokio::test]
async fn masa_kisi_sayisi_kalem_sayisiyla_carpilmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let plan = load_floor_plan(&mut conn, TENANT.to_string())
        .await
        .expect("plan");
    let table = plan.iter().find(|t| t.id == "tbl_1").expect("masa");
    assert_eq!(table.guest_count, Some(4));
}
