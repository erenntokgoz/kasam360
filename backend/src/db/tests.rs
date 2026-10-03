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

    migrate_tables_current_total_to_integer(&pool)
        .await
        .unwrap();
    // A second initialization must be a no-op.
    migrate_tables_current_total_to_integer(&pool)
        .await
        .unwrap();

    let rows: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT id, tenant_id, current_total FROM tables ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        rows,
        vec![
            ("table-a".into(), "tenant-a".into(), 1050),
            ("table-b".into(), "tenant-b".into(), 2001),
        ]
    );
    let tenant_a_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM tables WHERE tenant_id = 'tenant-a'")
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
    let pin_columns: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'pin'")
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

    let hashes: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT id, pin_hash FROM users ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    for (id, hash) in &hashes {
        let hash = hash.as_deref().unwrap_or_else(|| panic!("{} hash yok", id));
        assert!(
            crate::user_credentials::is_argon2_hash(hash),
            "{}: {}",
            id,
            hash
        );
    } // Kullanıcının bildiği eski PIN hâlâ giriş yaptırıyor.
    let owner_hash = hashes
        .iter()
        .find(|(id, _)| id == "usr_owner")
        .unwrap()
        .1
        .as_deref()
        .unwrap();
    assert!(crate::auth::verify_credential("2222", owner_hash));
    assert!(!crate::auth::verify_credential("9999", owner_hash));
    let cashier_hash = hashes
        .iter()
        .find(|(id, _)| id == "usr_cashier")
        .unwrap()
        .1
        .as_deref()
        .unwrap();
    assert!(crate::auth::verify_credential("4444", cashier_hash));

    // 3. Hiçbir yerde düz metin kalmadı: tüm metin sütunlarında arama.
    for (column, value) in [("name", "Patron"), ("login_identifier", "owner@test")] {
        let hits: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM users WHERE {} LIKE '%2222%' OR {} LIKE '%4444%'",
            column, column
        ))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            hits, 0,
            "{} sütununda düz metin PIN kaldı: {}",
            column, value
        );
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

    let stored: String = sqlx::query_scalar("SELECT pin_hash FROM users WHERE id = 'usr_owner'")
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
