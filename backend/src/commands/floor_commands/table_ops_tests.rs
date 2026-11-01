use super::*;
use sqlx::sqlite::SqlitePoolOptions;

#[tokio::test]
async fn hesap_istegi_acik_adisyona_yazilir_kapali_adisyona_yazilmaz() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_a', 'tnt_a', 'Masa 1');
         INSERT INTO orders (id, tenant_id, table_id, status) VALUES
            ('ord_acik', 'tnt_a', 'tbl_a', 'OPEN'),
            ('ord_kapali', 'tnt_a', 'tbl_a', 'PAID');",
    )
    .execute(&pool)
    .await
    .expect("tohum");
    let mut conn = pool.acquire().await.expect("bağlantı");

    write_bill_request(&mut conn, "tnt_a", "tbl_a", Some("2026-11-01T12:00:00Z"))
        .await
        .expect("yazılır");
    let marked: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE bill_requested_at IS NOT NULL AND id = 'ord_acik'",
    )
    .fetch_one(&mut *conn)
    .await
    .expect("sayım");
    assert_eq!(marked, 1);
    let closed: Option<String> =
        sqlx::query_scalar("SELECT bill_requested_at FROM orders WHERE id = 'ord_kapali'")
            .fetch_one(&mut *conn)
            .await
            .expect("kapalı");
    assert!(closed.is_none());

    assert!(write_bill_request(&mut conn, "tnt_b", "tbl_a", None)
        .await
        .is_err());
    write_bill_request(&mut conn, "tnt_a", "tbl_a", None)
        .await
        .expect("kaldırılır");
}
