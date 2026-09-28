use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Acquire, Pool, Row, Sqlite};
use std::str::FromStr;

pub type DbPool = Pool<Sqlite>;

pub async fn init_db(database_url: &str) -> Result<DbPool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_millis(5000));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // Eski veritabanlarında tenant_id eksikse schema.sql indekslerinden önce güvenle ekle (idempotent)
    let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE orders ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE products ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE categories ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tables ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE outbox ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE snapshots ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE order_items ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';").execute(&pool).await;

    // DDL şemasını uygula (etki eşitsiz - tüm ifadeler CREATE TABLE IF NOT EXISTS kullanır)
    let schema = include_str!("../migrations/schema.sql");
    sqlx::raw_sql(schema).execute(&pool).await?;

    // Eğer yoksa order_items tablosunu oluştur
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS order_items (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price_cents INTEGER NOT NULL,
            tax_rate REAL NOT NULL,
            subtotal_cents INTEGER NOT NULL,
            tax_amount_cents INTEGER NOT NULL,
            total_cents INTEGER NOT NULL,
            station TEXT,
            modifiers TEXT,
            notes TEXT,
            status TEXT DEFAULT 'PENDING',
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id)
        );"
    ).execute(&pool).await?;

    // Plans tablosuna eksik sütunları güvenle ekle (idempotent)
    let _ = sqlx::raw_sql("ALTER TABLE plans ADD COLUMN max_branches INTEGER NOT NULL DEFAULT 1;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE plans ADD COLUMN features TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE plans ADD COLUMN badge TEXT;").execute(&pool).await;

    // Users tablosuna kimlik doğrulama sütunlarını güvenle ekle (idempotent)
    let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN credential_hash TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN login_identifier TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN email TEXT;").execute(&pool).await;

    // Tenants tablosuna şirket/vergi/iletişim sütunlarını güvenle ekle (idempotent)
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN contact_person TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN email TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN phone TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN tax_id TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN tax_office TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN address TEXT;").execute(&pool).await;

    // PIN benzersizliğini global seviyeden tenant bazına indir (idempotent)
    let _ = sqlx::raw_sql("DROP INDEX IF EXISTS idx_users_pin;").execute(&pool).await;
    let _ = sqlx::raw_sql("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_pin ON users(tenant_id, pin);").execute(&pool).await;

    // The table rebuild is deliberately after the base DDL. `CREATE TABLE IF NOT
    // EXISTS` cannot upgrade an old tables definition, so this is the authoritative
    // upgrade path for both cents and tenant ownership.
    migrate_tables_current_total_to_integer(&pool).await?;

    // -------------------------------------------------------------------------
    // Tohum koruması (Seed guard) 1: Masalar, ürünler ve kategoriler — sadece ilk çalıştırmada.
    // -------------------------------------------------------------------------
    let table_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tables")
        .fetch_one(&pool)
        .await?;

    if table_count == 0 {
        let seed = include_str!("../migrations/seed.sql");
        sqlx::raw_sql(seed).execute(&pool).await?;
    } else {
        // -------------------------------------------------------------------------
        // Tohum koruması (Seed guard) 2: Kullanıcılar — INSERT OR IGNORE aracılığıyla her başlatmada etki eşitsiz.
        // Bu, eksikse 6 sabit rolün var olmasını sağlar.
        // -------------------------------------------------------------------------
        sqlx::raw_sql(
            "INSERT OR IGNORE INTO users (id, pin, role, name) VALUES
                ('usr_master',  '1111', 'MASTER',  'Master Admin'),
                ('usr_owner',   '2222', 'OWNER',   'Owner (Patron)'),
                ('usr_manager', '3333', 'MANAGER', 'Manager (Müdür)'),
                ('usr_cashier', '4444', 'CASHIER', 'Cashier (Kasiyer)'),
                ('usr_waiter',  '5555', 'WAITER',  'Waiter (Garson)'),
                ('usr_cook',    '6666', 'KITCHEN', 'Kitchen (Aşçı)');",
        )
        .execute(&pool)
        .await?;
        tracing_fallback_log("db::seed", "Kullanıcılar mevcut veritabanına tohumlandı/doğrulandı");

        // -------------------------------------------------------------------------
        // Tohum koruması (Seed guard) 3: Cari rehber kayıtları (Directories) — eksikse ekle
        // -------------------------------------------------------------------------
        sqlx::raw_sql(
            "INSERT OR IGNORE INTO directories (id, tenant_id, name, type, phone, credit_limit_cents) VALUES
                ('dir_001', 'DEFAULT_TENANT', 'Öz Gıda Toptan A.Ş.', 'SUPPLIER', '0212 555 1010', 5000000),
                ('dir_002', 'DEFAULT_TENANT', 'Ahmet Yılmaz (Masa 4 Veresiye)', 'CUSTOMER', '0532 111 2233', 100000),
                ('dir_003', 'DEFAULT_TENANT', 'Mehmet Usta (Aşçıbaşı)', 'STAFF', '0544 333 4455', 200000),
                ('dir_004', 'DEFAULT_TENANT', 'Dükkan Sahibi (Mülk Sahibi)', 'FIXED_EXPENSE', '0533 777 8899', 0),
                ('dir_005', 'DEFAULT_TENANT', 'Eren Bey (Patron Şahsi)', 'OWNER_PERSONAL', '0530 000 0001', 0);",
        )
        .execute(&pool)
        .await?;
        tracing_fallback_log("db::seed", "Cari rehber kayıtları tohumlandı/doğrulandı");
    }

    Ok(pool)
}

/// Upgrades legacy `tables` definitions without losing tenant ownership.
///
/// SQLite cannot alter a column type, therefore a table rebuild is required. The
/// original migration rebuilt only six columns and silently discarded
/// `tenant_id`. This migration treats `tenant_id` as first-class data, copies it
/// when present, assigns the historical default only to schemas that predate
/// tenancy, and recreates explicit indexes/triggers from sqlite_master.
async fn migrate_tables_current_total_to_integer(pool: &DbPool) -> Result<(), sqlx::Error> {
    const MIGRATION_VERSION: &str = "20260914_tables_tenant_safe_cents";

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await?;

    let columns = sqlx::query("SELECT name, type FROM pragma_table_info('tables')")
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
    let current_total_type = columns
        .iter()
        .find(|column| {
            column
                .try_get::<String, _>("name")
                .map(|value| value == "current_total")
                .unwrap_or(false)
        })
        .and_then(|column| column.try_get::<String, _>("type").ok());

    // A missing tenant_id is also an upgrade condition: an INTEGER-only legacy
    // schema would otherwise survive initialization but fail all tenant-scoped
    // queries. Refuse to rebuild malformed tables rather than drop unknown data.
    for required in ["id", "name", "status", "opened_at", "waiter_id", "current_total"] {
        if !has_column(required) {
            return Err(sqlx::Error::Protocol(format!(
                "cannot migrate tables: required column `{required}` is missing"
            )));
        }
    }
    let needs_rebuild = current_total_type.as_deref() == Some("REAL") || !has_column("tenant_id");

    if !needs_rebuild {
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(MIGRATION_VERSION)
            .execute(pool)
            .await?;
        return Ok(());
    }

    tracing_fallback_log("db::migration", "tables tenant-safe cents rebuild: starting");

    let object_sql: Vec<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master
         WHERE tbl_name = 'tables' AND type IN ('index', 'trigger') AND sql IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;

    // PRAGMA foreign_keys is connection-scoped and cannot be changed inside a
    // transaction. Hold one connection for the complete 12-step rebuild.
    let mut connection = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *connection)
        .await?;
    let result = async {
        let mut tx = connection.begin().await?;
        sqlx::query(
            "CREATE TABLE tables_new (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'AVAILABLE',
                opened_at DATETIME,
                waiter_id TEXT,
                current_total INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(&mut *tx)
        .await?;

        let tenant_expression = if has_column("tenant_id") {
            "COALESCE(tenant_id, 'DEFAULT_TENANT')"
        } else {
            "'DEFAULT_TENANT'"
        };
        let copy_sql = format!(
            "INSERT INTO tables_new (id, tenant_id, name, status, opened_at, waiter_id, current_total)
             SELECT id, {tenant_expression}, name, status, opened_at, waiter_id,
                    CAST(ROUND(current_total) AS INTEGER)
             FROM tables"
        );
        sqlx::query(&copy_sql).execute(&mut *tx).await?;
        sqlx::query("DROP TABLE tables").execute(&mut *tx).await?;
        sqlx::query("ALTER TABLE tables_new RENAME TO tables")
            .execute(&mut *tx)
            .await?;
        for sql in &object_sql {
            sqlx::query(sql).execute(&mut *tx).await?;
        }
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_tables_tenant_id ON tables(tenant_id)")
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(MIGRATION_VERSION)
            .execute(&mut *tx)
            .await?;
        tx.commit().await
    }
    .await;

    // Restore enforcement even if the transaction failed; any error is returned
    // after restoration so a failed upgrade never leaves this connection lax.
    let restore_result = sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *connection)
        .await;
    result?;
    restore_result?;

    let foreign_key_errors: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
        .fetch_one(&mut *connection)
        .await?;
    if foreign_key_errors != 0 {
        return Err(sqlx::Error::Protocol(
            "tables migration produced foreign key violations".to_string(),
        ));
    }

    tracing_fallback_log("db::migration", "tables tenant-safe cents rebuild: complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn tables_rebuild_preserves_each_tenant_and_foreign_keys() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE tenants (id TEXT PRIMARY KEY);
             INSERT INTO tenants VALUES ('tenant-a'), ('tenant-b');
             CREATE TABLE tables (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'AVAILABLE',
                opened_at DATETIME,
                waiter_id TEXT,
                current_total REAL NOT NULL DEFAULT 0
             );
             CREATE INDEX idx_legacy_tables_status ON tables(status);
             CREATE TABLE orders (
                id TEXT PRIMARY KEY,
                table_id TEXT NOT NULL REFERENCES tables(id) ON DELETE RESTRICT
             );
             INSERT INTO tables VALUES
                ('table-a', 'tenant-a', 'A1', 'OCCUPIED', NULL, NULL, 1050.4),
                ('table-b', 'tenant-b', 'B1', 'RESERVED', NULL, NULL, 2000.5);
             INSERT INTO orders VALUES ('order-a', 'table-a'), ('order-b', 'table-b');",
        )
        .execute(&pool)
        .await
        .unwrap();

        migrate_tables_current_total_to_integer(&pool).await.unwrap();
        // A second initialization must be a no-op.
        migrate_tables_current_total_to_integer(&pool).await.unwrap();

        let rows: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT id, tenant_id, current_total FROM tables ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows, vec![
            ("table-a".into(), "tenant-a".into(), 1050),
            ("table-b".into(), "tenant-b".into(), 2001),
        ]);
        let tenant_a_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tables WHERE tenant_id = 'tenant-a'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(tenant_a_count, 1);
        let orphan_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(orphan_count, 0);
        let column_type: String = sqlx::query_scalar(
            "SELECT type FROM pragma_table_info('tables') WHERE name = 'current_total'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(column_type, "INTEGER");
    }
}

/// Minimal yapılandırılmış günlük (log) yardımcısı (eprintln yedeği — ekstra bağımlılık gerektirmez).
fn tracing_fallback_log(module: &str, msg: &str) {
    eprintln!("[INFO] {}: {}", module, msg);
}
