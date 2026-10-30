//! Eski ürünlerde stok birimini yalnız tekil reçete birimi biliniyorsa taşır.

use super::DbPool;

pub(super) async fn migrate_stock_units(pool: &DbPool) -> Result<(), sqlx::Error> {
    const VERSION: &str = "20261030_product_stock_unit";
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('products') WHERE name = 'stock_unit'",
    )
    .fetch_one(pool)
    .await?;
    if exists == 0 {
        sqlx::query("ALTER TABLE products ADD COLUMN stock_unit TEXT NOT NULL DEFAULT 'adet'")
            .execute(pool)
            .await?;
    }
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await?;
    let applied: Option<String> =
        sqlx::query_scalar("SELECT version FROM schema_migrations WHERE version = ?")
            .bind(VERSION)
            .fetch_optional(pool)
            .await?;
    if applied.is_some() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    // Eski partilerde birim yazmıyordu. Aynı malzeme yalnız tek reçete
    // birimiyle kullanılmışsa mevcut alış miktarı için bu birim benimsenir.
    sqlx::query(
        "UPDATE products SET stock_unit = (
            SELECT MIN(LOWER(TRIM(ri.unit))) FROM recipe_items ri
            WHERE ri.tenant_id = products.tenant_id
              AND ri.component_product_id = products.id
         )
         WHERE EXISTS (
            SELECT 1 FROM recipe_items ri
            WHERE ri.tenant_id = products.tenant_id
              AND ri.component_product_id = products.id
            GROUP BY ri.tenant_id, ri.component_product_id
            HAVING COUNT(DISTINCT LOWER(TRIM(ri.unit))) = 1
         )",
    )
    .execute(&mut *tx)
    .await?;
    // Birden çok farklı reçete birimi varsa eski partinin birimi çıkarılamaz.
    // Kullanıcı açıkça düzeltmeden stok maliyeti hesaplanmamalı.
    sqlx::query(
        "UPDATE products SET stock_unit = 'belirsiz'
         WHERE EXISTS (
            SELECT 1 FROM recipe_items ri
            WHERE ri.tenant_id = products.tenant_id
              AND ri.component_product_id = products.id
            GROUP BY ri.tenant_id, ri.component_product_id
            HAVING COUNT(DISTINCT LOWER(TRIM(ri.unit))) > 1
         )",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO schema_migrations (version) VALUES (?)")
        .bind(VERSION)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}
