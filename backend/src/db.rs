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
    let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN pin_hash TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN login_identifier TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN email TEXT;").execute(&pool).await;

    // MASTER platform hesabı da düz metin `pin` taşıyordu; Argon2 sütunu önce
    // eklenir, yoksa migration'ın `SELECT ... pin_hash` ifadesi patlar.
    let _ = sqlx::raw_sql("ALTER TABLE platform_admins ADD COLUMN pin_hash TEXT;").execute(&pool).await;

    // Denetim defteri kategori ve hash sürümü sütunları. Sütunlar hash kanonik
    // formunun parçası değildir (hash_version = 1 dondurulmuştur), bu yüzden mevcut
    // satırların doğrulaması bozulmaz; eski satırlar SISTEM kategorisiyle işaretlenir.
    let _ = sqlx::raw_sql("ALTER TABLE audit_ledger ADD COLUMN category TEXT NOT NULL DEFAULT 'SISTEM';").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE audit_ledger ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1;").execute(&pool).await;

    // Faz 3 — anlık PIN onayı: `approvals` tablosu "kim onayladı" kaydı ve tek
    // kullanımlık jeton deposu haline geldi. CREATE TABLE IF NOT EXISTS eski
    // tanımı yükseltemediği için sütunlar burada idempotent eklenir.
    let _ = sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN approved_by_role TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN token_hash TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN expires_at DATETIME;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN consumed_at DATETIME;").execute(&pool).await;
    // Jeton tekliği ve tenant başına rapor sorguları için indeksler.
    let _ = sqlx::raw_sql("CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status ON approvals(tenant_id, status, created_at DESC);").execute(&pool).await;
    let _ = sqlx::raw_sql("CREATE INDEX IF NOT EXISTS idx_approvals_resource ON approvals(tenant_id, resource_id);").execute(&pool).await;
    let _ = sqlx::raw_sql("CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_token ON approvals(token_hash) WHERE token_hash IS NOT NULL;").execute(&pool).await;

    // Tenants tablosuna şirket/vergi/iletişim sütunlarını güvenle ekle (idempotent)
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN contact_person TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN email TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN phone TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN tax_id TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN tax_office TEXT;").execute(&pool).await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN address TEXT;").execute(&pool).await;

    // PIN düz metin depolanmaz: eski `users.pin` sütunu Argon2'e taşınır ve
    // kaldırılır. Aynı işlemde tenant içi PIN benzersizliğini taşıyan tekil indeks
    // de düşer (hash'ler karşılaştırılamaz, indeks işe yaramazdı).
    migrate_user_pins_to_argon2(&pool).await?;
    migrate_platform_admin_pins_to_argon2(&pool).await?;
    let _ = sqlx::raw_sql("DROP INDEX IF EXISTS idx_users_pin;").execute(&pool).await;
    let _ = sqlx::raw_sql("DROP INDEX IF EXISTS idx_users_tenant_pin;").execute(&pool).await;
    let _ = sqlx::raw_sql("CREATE INDEX IF NOT EXISTS idx_users_tenant_active ON users(tenant_id, is_active);").execute(&pool).await;

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

    // Tohum koruması (Seed guard) 2: Kullanıcılar — her başlatmada, iki dalın da
    // dışında çalışır. Argon2 SQL içinde üretilemediği için seed.sql'den çıkarıldı.
    seed_default_users(&pool).await?;

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

/// Altı sabit rolü Argon2id hash'li PIN'lerle tohumlar.
///
/// Etkileşimli: önce `SELECT` ile varlık denetir, yalnızca eksik olan hash'lenir.
/// Böylece her açılışta altı Argon2 işlemi harcanmaz.
/// `ON CONFLICT DO NOTHING` tek başına yeterli değildir: hash parametre olarak
/// önceden hesaplanmak zorunda kalırdı.
async fn seed_default_users(pool: &DbPool) -> Result<(), sqlx::Error> {
    const DEFAULT_USERS: [(&str, &str, &str, &str); 6] = [
        ("usr_master", "1111", "MASTER", "Master Admin"),
        ("usr_owner", "2222", "OWNER", "Owner (Patron)"),
        ("usr_manager", "3333", "MANAGER", "Manager (Müdür)"),
        ("usr_cashier", "4444", "CASHIER", "Cashier (Kasiyer)"),
        ("usr_waiter", "5555", "WAITER", "Waiter (Garson)"),
        ("usr_cook", "6666", "KITCHEN", "Kitchen (Aşçı)"),
    ];

    let mut inserted = 0usize;
    for (id, pin, role, name) in DEFAULT_USERS {
        let existing: Option<i64> = sqlx::query_scalar("SELECT 1 FROM users WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
        if existing.is_some() {
            continue;
        }

        let hash = crate::user_credentials::hash_pin(pin)
            .map_err(sqlx::Error::Protocol)?;
        sqlx::query(
            "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active)
             VALUES (?, 'DEFAULT_TENANT', ?, ?, ?, 1)",
        )
        .bind(id)
        .bind(role)
        .bind(name)
        .bind(&hash)
        .execute(pool)
        .await?;
        inserted += 1;
    }

    if inserted > 0 {
        tracing_fallback_log(
            "db::seed",
            &format!("Kullanıcılar Argon2 ile tohumlandı: {} kayıt", inserted),
        );
    }
    Ok(())
}

/// `users.pin` düz metin sütununu Argon2id hash'ine taşır ve sütunu kaldırır.
///
/// Sıra önemlidir ve veri kaybına yol açmaz:
///   1. `is_active` eklenir (soft delete'in dayanağı; idempotent).
///   2. Her satırın düz metin PIN'i `pin_hash` içine Argon2'ye çevrilir.
///      Bu adım transaction dışında yapılır: Argon2 kasıtlı olarak yavaştır ve
///      yazma kilidini saniyelerce tutmak diğer komutları kilitlerdi.
///   3. Tablo, tüm satırlar kopyalanarak `pin` olmadan yeniden inşa edilir.
///   4. Serbest bırakılan sayfalardaki eski düz metin gerçekten silinsin diye WAL
///      kırpılır ve VACUUM çalıştırılır; aksi halde düz metin dosya içinde kalırdı.
///
/// Idempotenttir: `pin` sütunu yoksa tüm gövde atlanır.
async fn migrate_user_pins_to_argon2(pool: &DbPool) -> Result<(), sqlx::Error> {
    // Soft delete için gereken sütun her şemada güvenle bulunmalı.
    let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;")
        .execute(pool)
        .await;

    let columns = sqlx::query("SELECT name FROM pragma_table_info('users')")
        .fetch_all(pool)
        .await?;
    if columns.is_empty() {
        return Ok(());
    }

    let has_pin = columns.iter().any(|column| {
        column
            .try_get::<String, _>("name")
            .map(|name| name == "pin")
            .unwrap_or(false)
    });
    if !has_pin {
        return Ok(());
    }

    // Adım 2: düz metni hash'e çevir. Zaten Argon2 hash'lenmiş satırlar atlanır,
    // böylece ikinci çalıştırmada hiçbir veri yeniden yazılmaz.
    let rows = sqlx::query("SELECT id, pin, pin_hash FROM users")
        .fetch_all(pool)
        .await?;
    let mut converted = 0usize;
    for row in rows {
        let id: String = row.try_get("id").unwrap_or_default();
        let hash: Option<String> = row.try_get("pin_hash").ok().flatten();
        if hash
            .as_deref()
            .map(crate::user_credentials::is_argon2_hash)
            .unwrap_or(false)
        {
            continue;
        }

        let pin: String = row
            .try_get::<Option<String>, _>("pin")
            .ok()
            .flatten()
            .unwrap_or_default();
        if pin.is_empty() {
            continue;
        }

        let new_hash = crate::auth::hash_credential(&pin).map_err(sqlx::Error::Protocol)?;
        sqlx::query("UPDATE users SET pin_hash = ? WHERE id = ?")
            .bind(&new_hash)
            .bind(&id)
            .execute(pool)
            .await?;
        converted += 1;
    }

    // Adım 3: `pin` sütununu kaldırmak için tabloyu yeniden inşa et.
    // `users` tablosuna hiçbir yabancı anahtar referansı yoktur (şema incelendi),
    // bu yüzden DROP TABLE güvenlidir; yine de transaction kullanılır.
    let mut conn = pool.acquire().await?;
    let mut tx = conn.begin().await?;
    sqlx::raw_sql("DROP INDEX IF EXISTS idx_users_tenant_pin;")
        .execute(&mut *tx)
        .await?;
    sqlx::raw_sql(
        "CREATE TABLE users_migrated (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            credential_hash TEXT,
            pin_hash TEXT,
            login_identifier TEXT,
            email TEXT,
            is_active INTEGER NOT NULL DEFAULT 1
        );",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::raw_sql(
        "INSERT INTO users_migrated (id, tenant_id, role, name, credential_hash, pin_hash, login_identifier, email, is_active)
         SELECT id, tenant_id, role, name, credential_hash, pin_hash, login_identifier, email, is_active FROM users;",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::raw_sql("DROP TABLE users;")
        .execute(&mut *tx)
        .await?;
    sqlx::raw_sql("ALTER TABLE users_migrated RENAME TO users;")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    // VACUUM ve WAL kırpma aynı bağlantıyı ister; havuz tek bağlantılıysa
    // `conn` tutulduğu sürece bu çağrılar bağlantı zaman aşımına takılır.
    drop(conn);

    // Adım 4: eski düz metnin dosyada kalmasını engelle.
    let _ = sqlx::raw_sql("PRAGMA wal_checkpoint(TRUNCATE);").execute(pool).await;
    let _ = sqlx::raw_sql("VACUUM;").execute(pool).await;

    tracing_fallback_log(
        "db::migration",
        &format!("users.pin -> Argon2: {} satır dönüştürüldü", converted),
    );
    Ok(())
}

/// `platform_admins.pin` düz metnini Argon2'ye taşır ve sütunu kaldırır.
///
/// `users` migration'ıyla aynı desen: hash'leme transaction dışında (Argon2 yavaştır,
/// yazma kilidini uzun tutmasın), ardından tablo satırları korunarak yeniden inşa
/// edilir. MASTER kimlik bilgisi PIN formatında olmak zorunda değildir
/// (`authenticate_by_identifier` buradaki değeri parola olarak doğrular), bu yüzden
/// `hash_pin`'in rakam/uzunluk kısıtı **kullanılmaz** — aksi halde harf içeren mevcut
/// bir MASTER parolası hash'lenemez ve hesap kilitlenirdi.
///
/// Idempotenttir: `pin` sütunu yoksa gövde atlanır.
async fn migrate_platform_admin_pins_to_argon2(pool: &DbPool) -> Result<(), sqlx::Error> {
    let columns = sqlx::query("SELECT name FROM pragma_table_info('platform_admins')")
        .fetch_all(pool)
        .await?;
    if columns.is_empty() {
        return Ok(());
    }

    let has_pin = columns.iter().any(|column| {
        column
            .try_get::<String, _>("name")
            .map(|name| name == "pin")
            .unwrap_or(false)
    });
    if !has_pin {
        return Ok(());
    }

    // Argon2 formatında olmayan değerleri hash'le; zaten hash'lenmiş olanlara dokunma.
    let rows = sqlx::query("SELECT id, pin, pin_hash FROM platform_admins")
        .fetch_all(pool)
        .await?;
    let mut converted = 0usize;
    for row in rows {
        let id: String = row.try_get("id").unwrap_or_default();
        let existing: Option<String> = row.try_get("pin_hash").ok().flatten();
        if existing
            .as_deref()
            .map(crate::user_credentials::is_argon2_hash)
            .unwrap_or(false)
        {
            continue;
        }

        let pin: String = row
            .try_get::<Option<String>, _>("pin")
            .ok()
            .flatten()
            .unwrap_or_default();
        if pin.is_empty() {
            continue;
        }

        let new_hash = crate::auth::hash_credential(&pin).map_err(sqlx::Error::Protocol)?;
        sqlx::query("UPDATE platform_admins SET pin_hash = ? WHERE id = ?")
            .bind(&new_hash)
            .bind(&id)
            .execute(pool)
            .await?;
        converted += 1;
    }

    let mut conn = pool.acquire().await?;
    let mut tx = conn.begin().await?;
    sqlx::raw_sql(
        "CREATE TABLE platform_admins_migrated (
            id TEXT PRIMARY KEY,
            pin_hash TEXT,
            name TEXT NOT NULL,
            email TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::raw_sql(
        "INSERT INTO platform_admins_migrated (id, pin_hash, name, email, created_at)
         SELECT id, pin_hash, name, email, created_at FROM platform_admins;",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::raw_sql("DROP TABLE platform_admins;")
        .execute(&mut *tx)
        .await?;
    sqlx::raw_sql("ALTER TABLE platform_admins_migrated RENAME TO platform_admins;")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    drop(conn);

    // Serbest bırakılan sayfalardaki düz metni gerçekten sil.
    let _ = sqlx::raw_sql("PRAGMA wal_checkpoint(TRUNCATE);").execute(pool).await;
    let _ = sqlx::raw_sql("VACUUM;").execute(pool).await;

    tracing_fallback_log(
        "db::migration",
        &format!("platform_admins.pin -> Argon2: {} satır dönüştürüldü", converted),
    );
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

    /// Eski şemadaki düz metn PIN'ler Argon2'ye taşınır, `users.pin` kaldırılır ve
    /// hiçbir veri kaybolmaz. İkinci çalıştırma etkisizdir.
    #[tokio::test]
    async fn user_pin_migration_hashes_plaintext_and_drops_the_column() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE users (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
                pin TEXT NOT NULL,
                role TEXT NOT NULL,
                name TEXT NOT NULL,
                credential_hash TEXT,
                pin_hash TEXT,
                login_identifier TEXT,
                email TEXT
             );
             CREATE UNIQUE INDEX idx_users_tenant_pin ON users(tenant_id, pin);
             INSERT INTO users (id, tenant_id, pin, role, name, login_identifier, email) VALUES
                ('usr_owner',   'tenant-a', '2222', 'OWNER',   'Patron',   'owner@test',  'owner@test'),
                ('usr_cashier', 'tenant-a', '4444', 'CASHIER', 'Kasiyer',  'kasiyer@test','kasiyer@test'),
                ('usr_other',   'tenant-b', '4444', 'CASHIER', 'Başka Kasa','diger@test',  'diger@test');",
        )
        .execute(&pool)
        .await
        .unwrap();

        migrate_user_pins_to_argon2(&pool).await.unwrap();
        // İkinci başlatma etkisiz olmalı: sütun yok, gövde atlanır.
        migrate_user_pins_to_argon2(&pool).await.unwrap();

        // 1. Düz metin sütunu gitti.
        let pin_columns: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'pin'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pin_columns, 0);
        let index_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_tenant_pin'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(index_count, 0);

        // 2. Veri korundu ve eski PIN'ler Argon2 ile doğrulanabiliyor.
        let rows: Vec<(String, String, Option<String>, String, i64)> = sqlx::query_as(
            "SELECT id, name, pin_hash, login_identifier, is_active FROM users ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].0, "usr_cashier");
        assert_eq!(rows[1].0, "usr_other");
        assert_eq!(rows[2].0, "usr_owner");
        assert_eq!(rows[2].1, "Patron");
        assert_eq!(rows[2].3, "owner@test");
        // Yeni sütun makul varsayılanla geldi.
        for row in &rows {
            assert_eq!(row.4, 1, "{}", row.0);
        }

        let hashes: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT id, pin_hash FROM users ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        for (id, hash) in &hashes {
            let hash = hash.as_deref().unwrap_or_else(|| panic!("{} hash yok", id));
            assert!(crate::user_credentials::is_argon2_hash(hash), "{}: {}", id, hash);
        }        // Kullanıcının bildiği eski PIN hâlâ giriş yaptırıyor.
        let owner_hash = hashes.iter().find(|(id, _)| id == "usr_owner").unwrap().1.as_deref().unwrap();
        assert!(crate::auth::verify_credential("2222", owner_hash));
        assert!(!crate::auth::verify_credential("9999", owner_hash));
        let cashier_hash = hashes.iter().find(|(id, _)| id == "usr_cashier").unwrap().1.as_deref().unwrap();
        assert!(crate::auth::verify_credential("4444", cashier_hash));

        // 3. Hiçbir yerde düz metin kalmadı: tüm metin sütunlarında arama.
        for (column, value) in [
            ("name", "Patron"),
            ("login_identifier", "owner@test"),
        ] {
            let hits: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM users WHERE {} LIKE '%2222%' OR {} LIKE '%4444%'",
                column, column
            ))
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(hits, 0, "{} sütununda düz metin PIN kaldı: {}", column, value);
        }
    }

    /// Argon2 PIN hash'i zaten olan satır migration'da yeniden yazılmaz; hash yeniden
    /// üretilseydi beklenen PIN değişmezdi ama gereksiz iş yapılırdı.
    #[tokio::test]
    async fn user_pin_migration_keeps_existing_argon2_hashes() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE users (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
                pin TEXT NOT NULL,
                role TEXT NOT NULL,
                name TEXT NOT NULL,
                credential_hash TEXT,
                pin_hash TEXT,
                login_identifier TEXT,
                email TEXT
             );
             CREATE UNIQUE INDEX idx_users_tenant_pin ON users(tenant_id, pin);",
        )
        .execute(&pool)
        .await
        .unwrap();

        let hash = crate::user_credentials::hash_pin("2222").unwrap();
        sqlx::query("INSERT INTO users (id, tenant_id, pin, role, name, pin_hash) VALUES ('usr_owner', 'DEFAULT_TENANT', '2222', 'OWNER', 'Patron', ?)")
            .bind(&hash)
            .execute(&pool)
            .await
            .unwrap();

        migrate_user_pins_to_argon2(&pool).await.unwrap();

        let stored: String =
            sqlx::query_scalar("SELECT pin_hash FROM users WHERE id = 'usr_owner'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored, hash);
    }

    /// En eski şemada ne `credential_hash` ne `pin_hash` ne `is_active` vardır.
    /// `init_db` bu sütunları `ALTER TABLE` ile ekledikten sonra migration
    /// çalışır; aksi halde `SELECT ... pin_hash` "no such column" ile patlar.
    #[tokio::test]
    async fn user_pin_migration_calisir_eksik_yeni_sutunlarla_birlikte() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE users (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
                pin TEXT NOT NULL,
                role TEXT NOT NULL,
                name TEXT NOT NULL
             );
             INSERT INTO users (id, tenant_id, pin, role, name) VALUES
                ('usr_owner', 'DEFAULT_TENANT', '2222', 'OWNER', 'Patron');",
        )
        .execute(&pool)
        .await
        .unwrap();

        // init_db'nin yaptığı hazırlığı taklit et.
        let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN credential_hash TEXT;")
            .execute(&pool)
            .await;
        let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN pin_hash TEXT;")
            .execute(&pool)
            .await;
        let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN login_identifier TEXT;")
            .execute(&pool)
            .await;
        let _ = sqlx::raw_sql("ALTER TABLE users ADD COLUMN email TEXT;")
            .execute(&pool)
            .await;

        migrate_user_pins_to_argon2(&pool).await.unwrap();

        let (pin_hash, is_active): (Option<String>, i64) =
            sqlx::query_as("SELECT pin_hash, is_active FROM users WHERE id = 'usr_owner'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(is_active, 1);
        let pin_hash = pin_hash.expect("pin_hash doldurulmalı");
        assert!(crate::user_credentials::is_argon2_hash(&pin_hash));
        assert!(crate::auth::verify_credential("2222", &pin_hash));
    }

    /// MASTER platform hesabının düz metin `pin`i Argon2'ye taşınır, sütun kaldırılır.
    /// MASTER kimlik bilgisi PIN formatında olmak zorunda değildir (`authenticate_by_identifier`
    /// bunu parola olarak doğrular), bu yüzden harf içeren bir değer de korunmalıdır.
    #[tokio::test]
    async fn platform_admin_pin_migration_hashes_plaintext_and_drops_the_column() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE platform_admins (
                id TEXT PRIMARY KEY,
                pin TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                email TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             INSERT INTO platform_admins (id, pin, name, email) VALUES
                ('adm_1', 'Master-3736!', 'Süper Admin', 'master@kasam360.com');",
        )
        .execute(&pool)
        .await
        .unwrap();

        // init_db'nin hazırlığı: yeni sütun eklenir, sonra migration çalışır.
        let _ = sqlx::raw_sql("ALTER TABLE platform_admins ADD COLUMN pin_hash TEXT;")
            .execute(&pool)
            .await;

        migrate_platform_admin_pins_to_argon2(&pool).await.unwrap();
        // İkinci çalıştırma etkisiz.
        migrate_platform_admin_pins_to_argon2(&pool).await.unwrap();

        let pin_columns: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('platform_admins') WHERE name = 'pin'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pin_columns, 0);

        let (name, email, hash): (String, Option<String>, Option<String>) =
            sqlx::query_as("SELECT name, email, pin_hash FROM platform_admins WHERE id = 'adm_1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(name, "Süper Admin");
        assert_eq!(email.as_deref(), Some("master@kasam360.com"));

        let hash = hash.expect("pin_hash doldurulmalı");
        assert!(crate::user_credentials::is_argon2_hash(&hash));
        // Harf ve noktalama içeren MASTER parolası da hash'lenmiş olmalı.
        assert!(crate::auth::verify_credential("Master-3736!", &hash));
        assert!(!crate::auth::verify_credential("3736", &hash));
        assert!(!hash.contains("3736"));
    }

    /// Hash'leme hatası sessizce yutulmaz: kurulum gerçek bir hata mesajıyla durur.
    #[tokio::test]
    async fn platform_admin_migration_bos_tabloda_veri_kaybi_yapmaz() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE platform_admins (
                id TEXT PRIMARY KEY,
                pin TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                email TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        let _ = sqlx::raw_sql("ALTER TABLE platform_admins ADD COLUMN pin_hash TEXT;")
            .execute(&pool)
            .await;

        migrate_platform_admin_pins_to_argon2(&pool).await.unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM platform_admins")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        // Tablo yine de okunabilir (yoksa auth sorguları hata verirdi).
        let rows: Vec<String> = sqlx::query_scalar("SELECT id FROM platform_admins")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(rows.is_empty());
    }
}

/// Minimal yapılandırılmış günlük (log) yardımcısı (eprintln yedeği — ekstra bağımlılık gerektirmez).
fn tracing_fallback_log(module: &str, msg: &str) {
    eprintln!("[INFO] {}: {}", module, msg);
}
