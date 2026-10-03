use super::{tracing_fallback_log, DbPool};
use sqlx::{Acquire, Row};

/// Upgrades legacy `tables` definitions without losing tenant ownership.
///
/// SQLite cannot alter a column type, therefore a table rebuild is required. The
/// original migration rebuilt only six columns and silently discarded
/// `tenant_id`. This migration treats `tenant_id` as first-class data, copies it
/// when present, assigns the historical default only to schemas that predate
/// tenancy, and recreates explicit indexes/triggers from sqlite_master.
///
/// `tenant_id` hedef tanımında varsayılan **taşımaz**. Neden: `DEFAULT
/// 'DEFAULT_TENANT'` bir kolon tanımında kalmaya devam ederse, `tenant_id`
/// bind etmeyen bir `INSERT` sessizce ortak havuza düşer ve kiracı izolasyonu
/// sessizce delinir (AGENTS.md §3.3). Eski satırlar için `DEFAULT_TENANT`
/// yalnız **tek seferlik veri dönüşümünde** kullanılır; hedef şemada bir kolon
/// varsayılanı olarak yaşamaz.
pub(crate) async fn migrate_tables_current_total_to_integer(
    pool: &DbPool,
) -> Result<(), sqlx::Error> {
    const MIGRATION_VERSION: &str = "20260914_tables_tenant_safe_cents";
    const TIGHTEN_VERSION: &str = "20261003_tables_tenant_no_default";

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await?;

    let columns = sqlx::query("SELECT name, type, dflt_value FROM pragma_table_info('tables')")
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

    // `tenant_id` üzerinde bir kolon varsayılanı varsa şema kiracı izolasyonu
    // açısından gevşektir: bind edilmemiş bir INSERT sessizce `DEFAULT_TENANT`
    // olur. Bu da rebuild tetikleyicisidir.
    let tenant_has_default = columns.iter().any(|column| {
        column
            .try_get::<String, _>("name")
            .map(|value| value == "tenant_id")
            .unwrap_or(false)
            && column
                .try_get::<Option<String>, _>("dflt_value")
                .ok()
                .flatten()
                .is_some_and(|value| value.contains("DEFAULT_TENANT"))
    });

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
    let needs_rebuild = current_total_type.as_deref() == Some("REAL")
        || !has_column("tenant_id")
        || tenant_has_default;

    if !needs_rebuild {
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(MIGRATION_VERSION)
            .execute(pool)
            .await?;
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(TIGHTEN_VERSION)
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

        // Faz 13 kroki geometrisi yeniden kurulumda da korunur. Bu kolonlar
        // legacy şemada yoktur; varsa kopyalanır, yoksa hedef tanımda hiç
        // bulunmaz. Aksi halde bir kroki çizilmiş bir salon, tables rebuild'i
        // sonrası geometrisini sessizce kaybederdi (AGENTS.md §2: veri
        // kaybı yasak).
        let geometry: [(&str, &str); 5] = [
            ("x", "INTEGER NOT NULL DEFAULT 0"),
            ("y", "INTEGER NOT NULL DEFAULT 0"),
            ("rotation", "INTEGER NOT NULL DEFAULT 0"),
            ("seats", "INTEGER NOT NULL DEFAULT 4"),
            ("zone", "TEXT"),
        ];
        let kept: Vec<&(&str, &str)> =
            geometry.iter().filter(|(name, _)| has_column(name)).collect();
        // Neden `format!("{} {}", entry.0, entry.1)`: `geometry` her öğeyi
        // `(kolon_adi, tip_tanimi)` çifti olarak tutar; kolon tanımı ikisinin
        // birleşimidir. Yalnız `entry.1` yazılırsa tanım "x INTEGER ..." değil
        // "INTEGER ..." olur ve SQLite "duplicate column name: INTEGER" ile
        // patlar. Bu hata uzun süre görünmedi çünkü eski testler rebuild'i
        // hiç tetiklemiyordu (aşağıdaki `rebuildin_tetiklendigini_kanitla`
        // testlerinin yazılmasıyla ortaya çıktı).
        let geometry_ddl: String = kept
            .iter()
            .map(|entry| format!(",\n    {} {}", entry.0, entry.1))
            .collect();
        let geometry_names: String = if kept.is_empty() {
            String::new()
        } else {
            format!(
                ", {}",
                kept.iter().map(|entry| entry.0).collect::<Vec<_>>().join(", ")
            )
        };
        let geometry_select: String = if kept.is_empty() {
            String::new()
        } else {
            format!(
                ", {}",
                kept.iter().map(|entry| entry.0).collect::<Vec<_>>().join(", ")
            )
        };

        sqlx::query(&format!(
            "CREATE TABLE tables_new (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'AVAILABLE',
                opened_at DATETIME,
                waiter_id TEXT,
                current_total INTEGER NOT NULL DEFAULT 0{geometry_ddl}
            )"
        ))
        .execute(&mut *tx)
        .await?;

        // Tek seferlik veri dönüşümü: tenancy öncesi şemada `tenant_id`
        // kolonu yoktur veya NULL olabilir; mevcut satırlar kaybolmasın diye
        // burada tarihsel değer atanır. Bu ifade **hedef şemada değil**,
        // yalnız kopyada yaşar: sonraki her `INSERT` `tenant_id` bind
        // etmek zorundadır.
        let tenant_expression = if has_column("tenant_id") {
            "COALESCE(tenant_id, 'DEFAULT_TENANT')"
        } else {
            "'DEFAULT_TENANT'"
        };
        let copy_sql = format!(
            "INSERT INTO tables_new (id, tenant_id, name, status, opened_at, waiter_id, current_total{geometry_names})
             SELECT id, {tenant_expression}, name, status, opened_at, waiter_id,
                    CAST(ROUND(current_total) AS INTEGER){geometry_select}
             FROM tables"
        );
        sqlx::query(&copy_sql).execute(&mut *tx).await?;
        sqlx::query("DROP TABLE tables").execute(&mut *tx).await?;
        sqlx::query("ALTER TABLE tables_new RENAME TO tables")
            .execute(&mut *tx)
            .await
            ?;
        for sql in &object_sql {
            sqlx::query(sql).execute(&mut *tx).await?;
        }
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_tables_tenant_id ON tables(tenant_id)")
            .execute(&mut *tx)
            .await
            ?;
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(MIGRATION_VERSION)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
            .bind(TIGHTEN_VERSION)
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
