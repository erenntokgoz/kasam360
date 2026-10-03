use super::{tracing_fallback_log, DbPool};
use sqlx::{Acquire, Row};

/// Upgrades legacy `tables` definitions without losing tenant ownership.
///
/// SQLite cannot alter a column type, therefore a table rebuild is required. The
/// original migration rebuilt only six columns and silently discarded
/// `tenant_id`. This migration treats `tenant_id` as first-class data, copies it
/// when present, assigns the historical default only to schemas that predate
/// tenancy, and recreates explicit indexes/triggers from sqlite_master.
pub(crate) async fn migrate_tables_current_total_to_integer(
    pool: &DbPool,
) -> Result<(), sqlx::Error> {
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
    for required in [
        "id",
        "name",
        "status",
        "opened_at",
        "waiter_id",
        "current_total",
    ] {
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

    tracing_fallback_log(
        "db::migration",
        "tables tenant-safe cents rebuild: starting",
    );

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

    let foreign_key_errors: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&mut *connection)
            .await?;
    if foreign_key_errors != 0 {
        return Err(sqlx::Error::Protocol(
            "tables migration produced foreign key violations".to_string(),
        ));
    }

    tracing_fallback_log(
        "db::migration",
        "tables tenant-safe cents rebuild: complete",
    );
    Ok(())
}
