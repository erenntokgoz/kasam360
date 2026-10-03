use super::{tracing_fallback_log, DbPool};
use sqlx::{Acquire, Row};

/// Faz 12 · `stock_movements` tablosunu ürün bazlı düzeltmelere açar.
///
/// Neden tablo yeniden kurma gerekiyor: `inventory_item_id NOT NULL` idi ve yalnız
/// eski `inventory_items` tablosunu (REAL tabanlı, ayrı sistem) işaret ediyordu.
/// Kör sayım farkı bir **ürüne** yazılır; `NULL` yazmak ihlaldiği için ya hareket
/// hiç kaydedilmezdi (denetim kaybı) ya da ürün `inventory_items` içinde uydurulurdu
/// (çift stok). Sütun nullable yapılır ve `product_id` eklenir.
///
/// Veri kaybı olmaz; tüm satırlar kopyalanır.
pub async fn migrate_stock_movements_for_products(pool: &DbPool) -> Result<(), sqlx::Error> {
    const MIGRATION_VERSION: &str = "20261003_stock_movements_product_scope";

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await?;

    let applied: Option<String> =
        sqlx::query_scalar("SELECT version FROM schema_migrations WHERE version = ?")
            .bind(MIGRATION_VERSION)
            .fetch_optional(pool)
            .await?;
    if applied.is_some() {
        return Ok(());
    }

    let columns = sqlx::query("SELECT name, \"notnull\" FROM pragma_table_info('stock_movements')")
        .fetch_all(pool)
        .await?;
    if columns.is_empty() {
        return Ok(());
    }

    let has_column = |name: &str| {
        columns.iter().any(|column| {
            column
                .try_get::<String, _>("name")
                .map(|value| value == name)
                .unwrap_or(false)
        })
    };
    if !has_column("inventory_item_id") || !has_column("quantity") {
        return Err(sqlx::Error::Protocol(
            "cannot migrate stock_movements: required column is missing".to_string(),
        ));
    }
    if has_column("product_id") {
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(MIGRATION_VERSION)
            .execute(pool)
            .await?;
        return Ok(());
    }

    tracing_fallback_log(
        "db::migration",
        "stock_movements product scope rebuild: starting",
    );

    let object_sql: Vec<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master
          WHERE tbl_name = 'stock_movements' AND type IN ('index', 'trigger')
            AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(pool)
    .await?;

    let item_expression = if has_column("inventory_item_id") {
        "inventory_item_id"
    } else {
        "NULL"
    };

    let mut connection = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *connection)
        .await?;
    let result = async {
        let mut tx = connection.begin().await?;
        sqlx::query(
            "CREATE TABLE stock_movements_new (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                -- Nullable: hareket ya eski `inventory_items` kaydına ya da
                -- `products` kaydına bağlıdır. Kör sayım düzeltmesi ürüne yazılır.
                inventory_item_id TEXT,
                product_id TEXT,
                movement_type TEXT NOT NULL
                    CHECK(movement_type IN ('IN', 'OUT', 'WASTE', 'ADJUST')),
                quantity REAL NOT NULL,
                actor_id TEXT NOT NULL,
                reason TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
        )
        .execute(&mut *tx)
        .await?;

        let copy_sql = format!(
            "INSERT INTO stock_movements_new
                 (id, tenant_id, inventory_item_id, product_id, movement_type,
                  quantity, actor_id, reason, created_at)
             SELECT id, tenant_id, {item_expression}, NULL, movement_type,
                    quantity, actor_id, reason, created_at
               FROM stock_movements"
        );
        sqlx::query(&copy_sql).execute(&mut *tx).await?;
        sqlx::query("DROP TABLE stock_movements")
            .execute(&mut *tx)
            .await?;
        sqlx::query("ALTER TABLE stock_movements_new RENAME TO stock_movements")
            .execute(&mut *tx)
            .await?;
        for sql in &object_sql {
            sqlx::query(sql).execute(&mut *tx).await?;
        }
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_product
                ON stock_movements(tenant_id, product_id, created_at DESC)",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(MIGRATION_VERSION)
            .execute(&mut *tx)
            .await?;
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
        "stock_movements product scope rebuild: complete",
    );
    Ok(())
}

/// Faz 12 · 86'd sütunlarını `products` tablosuna ekler.
///
/// Neden ayrı kolon: `products.is_active` "ürün satışa sunulmuyor" demektir
/// (sezon dışı, kalıcı olarak menüden kaldırılmış). 86'd ise "stok bitti,
/// bugün için menüden kalktı" durumudur ve stoğu gelince geri açılır. Tek
/// bayrakta tutulsaydı mutfak, ürün geldiğinde hangi ayarı geri çevireceğini
/// bilemezdi.
pub(crate) async fn migrate_products_for_86d(pool: &DbPool) -> Result<(), sqlx::Error> {
    let _ = sqlx::raw_sql("ALTER TABLE products ADD COLUMN is_86 INTEGER NOT NULL DEFAULT 0;")
        .execute(pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE products ADD COLUMN stockout_reason TEXT;")
        .execute(pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE products ADD COLUMN stockout_at TEXT;")
        .execute(pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE products ADD COLUMN stockout_by TEXT;")
        .execute(pool)
        .await;
    let _ = sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_products_tenant_86 ON products(tenant_id, is_86);",
    )
    .execute(pool)
    .await;
    Ok(())
}

/// Faz 12 · `inventory_batches` tablosunu raf ömrü ve teslim izlenebilirliği
/// için yeniden kurar.
///
/// Neden tablo yeniden kurma gerekiyor: SQLite bir kolonun `NOT NULL` ya da
/// `DEFAULT` niteliğini düşüremez. `inventory_batches.tenant_id` kolonunda
/// `DEFAULT 'DEFAULT_TENANT'` duruyordu; bu, `tenant_id` bind edilmeden yazılan
/// her partiyi sessizce ortak havuza indiriyordu (AGENTS.md §3.3). Varsayılan
/// kaldırılınca eksik `tenant_id` artık veritabanı hatası verir.
///
/// Veri kaybı olmaz: `tenant_id` NULL olan eski satırlar tarihsel olarak ortak
/// havuzda olduğu için `DEFAULT_TENANT` değeriyle korunur.
pub(crate) async fn migrate_inventory_batches_for_shelf_life(
    pool: &DbPool,
) -> Result<(), sqlx::Error> {
    const MIGRATION_VERSION: &str = "20261003_inventory_batches_shelf_life_no_tenant_default";

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await?;

    let applied: Option<String> =
        sqlx::query_scalar("SELECT version FROM schema_migrations WHERE version = ?")
            .bind(MIGRATION_VERSION)
            .fetch_optional(pool)
            .await?;
    if applied.is_some() {
        return Ok(());
    }

    let columns = sqlx::query("SELECT name FROM pragma_table_info('inventory_batches')")
        .fetch_all(pool)
        .await?;
    if columns.is_empty() {
        return Ok(());
    }

    let has_column = |name: &str| {
        columns.iter().any(|column| {
            column
                .try_get::<String, _>("name")
                .map(|value| value == name)
                .unwrap_or(false)
        })
    };
    for required in ["id", "tenant_id", "initial_quantity", "remaining_quantity"] {
        if !has_column(required) {
            return Err(sqlx::Error::Protocol(format!(
                "cannot migrate inventory_batches: required column `{required}` is missing"
            )));
        }
    }

    // Yeniden inşa yalnız iki koşulda gerekir: raf ömrü sütunu yoksa (yeni
    // alan) veya tenant varsayılanı hâlâ duruyorsa (sessiz havuz birleşmesi).
    let needs_rebuild = !has_column("expiry_date")
        || !has_column("received_by")
        || sqlx::query_scalar::<_, String>(
            "SELECT dflt_value FROM pragma_table_info('inventory_batches')
              WHERE name = 'tenant_id' AND dflt_value IS NOT NULL",
        )
        .fetch_optional(pool)
        .await?
        .is_some();

    if !needs_rebuild {
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(MIGRATION_VERSION)
            .execute(pool)
            .await?;
        return Ok(());
    }

    tracing_fallback_log(
        "db::migration",
        "inventory_batches shelf-life rebuild: starting",
    );

    let object_sql: Vec<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master
         WHERE tbl_name = 'inventory_batches' AND type IN ('index', 'trigger')
           AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(pool)
    .await?;

    let expiry_expression = if has_column("expiry_date") {
        "expiry_date"
    } else {
        "NULL"
    };
    let received_by_expression = if has_column("received_by") {
        "received_by"
    } else {
        "NULL"
    };

    // PRAGMA foreign_keys bağlantı kapsamlıdır ve transaction içinde
    // değiştirilemez; 12 adımlı yeniden inşa için tek bağlantı tutulur.
    let mut connection = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *connection)
        .await?;
    let result = async {
        let mut tx = connection.begin().await?;
        sqlx::query(
            "CREATE TABLE inventory_batches_new (
                id TEXT PRIMARY KEY,
                -- Varsayılan YOK: tenant_id bind edilmeden yazılan parti hata
                -- vermelidir, ortak havuza düşmemelidir (AGENTS.md §3.3).
                tenant_id TEXT NOT NULL,
                inventory_item_id TEXT,
                product_id TEXT,
                batch_code TEXT,
                received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                -- Raf ömrü (Spec §2.12): son kullanma tarihi partinin kendisinde
                -- durur, çünkü aynı ürünün partileri farklı günlerde dolabilir.
                expiry_date TEXT,
                received_by TEXT,
                initial_quantity REAL NOT NULL,
                remaining_quantity REAL NOT NULL,
                unit_cost_cents INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
        )
        .execute(&mut *tx)
        .await?;

        let copy_sql = format!(
            "INSERT INTO inventory_batches_new
                 (id, tenant_id, inventory_item_id, product_id, batch_code,
                  received_at, expiry_date, received_by, initial_quantity,
                  remaining_quantity, unit_cost_cents, created_at)
             SELECT id, COALESCE(tenant_id, 'DEFAULT_TENANT'), inventory_item_id,
                    product_id, batch_code, received_at, {expiry_expression},
                    {received_by_expression}, initial_quantity, remaining_quantity,
                    unit_cost_cents, created_at
               FROM inventory_batches"
        );
        sqlx::query(&copy_sql).execute(&mut *tx).await?;
        sqlx::query("DROP TABLE inventory_batches")
            .execute(&mut *tx)
            .await?;
        sqlx::query("ALTER TABLE inventory_batches_new RENAME TO inventory_batches")
            .execute(&mut *tx)
            .await?;
        for sql in &object_sql {
            sqlx::query(sql).execute(&mut *tx).await?;
        }
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_inv_batches_tenant ON inventory_batches(tenant_id, received_at ASC)")
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(MIGRATION_VERSION)
            .execute(&mut *tx)
            .await?;
        tx.commit().await
    }
    .await;

    // Kısmen başarısız bir yükseltme bu bağlantıyı gevşek bırakmasın: önce
    // zorlamayı geri aç, sonra hataları yukarı taşı.
    let restore_result = sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *connection)
        .await;
    result?;
    restore_result?;

    let foreign_key_errors: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&mut *connection)
            .await?;
    if foreign_key_errors != 0 {
        return Err(sqlx::Error::Protocol(
            "inventory_batches migration produced foreign key violations".to_string(),
        ));
    }

    tracing_fallback_log(
        "db::migration",
        "inventory_batches shelf-life rebuild: complete",
    );
    Ok(())
}
