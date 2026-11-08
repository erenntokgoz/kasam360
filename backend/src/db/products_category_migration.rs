//! `products.category_id` kolonunu boş bırakılabilir yapar.
//!
//! Neden tablo yeniden kurma gerekiyor: hammadde (stok kalemi) menüde yer almaz
//! ve kategorisi yoktur. Kolon `NOT NULL` kaldıkça her stok kalemi bir menü
//! kategorisine bağlanmak zorundaydı; stok ekranından açılan kategoriler menü
//! kategori listesine karışıyordu. SQLite `DROP NOT NULL` desteklemez.
//!
//! Veri kaybı olmaz: tüm satırlar ve kolonlar aynı sırayla kopyalanır, mevcut
//! kategori bağları korunur. Tablonun indeksleri ve tetikleyicileri yeniden kurulur.

use super::{tracing_fallback_log, DbPool};
use sqlx::Acquire;

const NOT_NULL_COLUMN: &str = "category_id TEXT NOT NULL";
const NULLABLE_COLUMN: &str = "category_id TEXT";

pub(crate) async fn migrate_products_nullable_category(pool: &DbPool) -> Result<(), sqlx::Error> {
    let not_null: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('products')
          WHERE name = 'category_id' AND \"notnull\" = 1",
    )
    .fetch_one(pool)
    .await?;
    if not_null == 0 {
        return Ok(());
    }

    let table_sql: String = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'products'",
    )
    .fetch_one(pool)
    .await?;
    // Tanım beklenen biçimde değilse tablo tahminle yeniden yazılmaz: yanlış
    // kurulan şema veriyi bozar. Kolon kısıtlı kalır, hammadde kaydı hata verir.
    let (Some(body_start), true) = (table_sql.find('('), table_sql.contains(NOT_NULL_COLUMN))
    else {
        tracing::warn!("products.category_id NOT NULL tanımı tanınmadı; yeniden kurulum atlandı");
        return Ok(());
    };
    let create_sql = format!(
        "CREATE TABLE products_new {}",
        table_sql[body_start..].replacen(NOT_NULL_COLUMN, NULLABLE_COLUMN, 1)
    );

    let object_sql: Vec<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master
          WHERE tbl_name = 'products' AND type IN ('index', 'trigger')
            AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(pool)
    .await?;

    tracing_fallback_log(
        "db::migration",
        "products nullable category rebuild: starting",
    );

    let mut connection = pool.acquire().await?;
    // PRAGMA foreign_keys bağlantı kapsamlıdır ve işlem içinde değiştirilemez.
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *connection)
        .await?;
    let result = async {
        let mut tx = connection.begin().await?;
        sqlx::query(&create_sql).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO products_new SELECT * FROM products")
            .execute(&mut *tx)
            .await?;
        sqlx::query("DROP TABLE products").execute(&mut *tx).await?;
        sqlx::query("ALTER TABLE products_new RENAME TO products")
            .execute(&mut *tx)
            .await?;
        for sql in &object_sql {
            sqlx::query(sql).execute(&mut *tx).await?;
        }
        tx.commit().await
    }
    .await;
    let restore_result = sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *connection)
        .await;
    result?;
    restore_result?;

    tracing_fallback_log(
        "db::migration",
        "products nullable category rebuild: complete",
    );
    Ok(())
}
