//! Fiyat geçmişi: değişim kaydı, aynı fiyatın iz bırakmaması ve kiracı yalıtımı.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    pool
}

const WIDE: (&str, &str) = ("2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z");

#[tokio::test]
async fn fiyat_degisimi_eski_yeni_ve_kisiyle_kaydedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    record_change(
        &mut conn,
        "tnt_a",
        "prd_1",
        "Çay",
        2500,
        3000,
        "usr_o",
        "OWNER",
        SOURCE_MENU_EDIT,
    )
    .await
    .expect("kayıt");
    let rows = list(&mut conn, "tnt_a", WIDE.0, WIDE.1, None)
        .await
        .expect("liste");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].old_price_cents, 2500);
    assert_eq!(rows[0].new_price_cents, 3000);
    assert_eq!(rows[0].actor_id, "usr_o");
    assert_eq!(rows[0].source, SOURCE_MENU_EDIT);
    assert!(rows[0].id.starts_with("pph_"));
}

#[tokio::test]
async fn ayni_fiyat_iz_birakmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    record_change(
        &mut conn,
        "tnt_a",
        "prd_1",
        "Çay",
        2500,
        2500,
        "usr_o",
        "OWNER",
        SOURCE_MENU_EDIT,
    )
    .await
    .expect("kayıt");
    let rows = list(&mut conn, "tnt_a", WIDE.0, WIDE.1, None)
        .await
        .expect("liste");
    assert!(rows.is_empty());
}

#[tokio::test]
async fn baska_kiracinin_fiyat_gecmisi_gorunmez_ve_urun_suzgeci_calisir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    for (tenant, product, old, new) in [
        ("tnt_a", "prd_1", 100, 200),
        ("tnt_a", "prd_2", 300, 400),
        ("tnt_b", "prd_1", 500, 600),
    ] {
        record_change(
            &mut conn,
            tenant,
            product,
            product,
            old,
            new,
            "usr_o",
            "OWNER",
            SOURCE_BULK_UPDATE,
        )
        .await
        .expect("kayıt");
    }
    let hepsi = list(&mut conn, "tnt_a", WIDE.0, WIDE.1, None)
        .await
        .expect("liste");
    assert_eq!(hepsi.len(), 2);
    let tek = list(&mut conn, "tnt_a", WIDE.0, WIDE.1, Some("prd_1"))
        .await
        .expect("liste");
    assert_eq!(tek.len(), 1);
    assert_eq!(tek[0].new_price_cents, 200);
    let gecmis = list(
        &mut conn,
        "tnt_a",
        "2000-01-01T00:00:00Z",
        "2001-01-01T00:00:00Z",
        None,
    )
    .await
    .expect("liste");
    assert!(gecmis.is_empty());
}
