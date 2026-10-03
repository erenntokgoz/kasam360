//! Veritabanı açılışı, şema uygulama ve migration yordamlar
//!
//! Dosya 500 satır sınırını aşmasın diye modüle bölündü:
//! tables_migration (masa kuruş/tenant yeniden kurumu), seeds (Argon2
//! tohumlama ve PIN migration'ları), faz12 (86'd ve raf ömrü sütunları) ve
//! tests ayrı dosyalardadır.

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Sqlite};
use std::str::FromStr;

mod faz12;
// Faz 13 migration'ı servis testleri tarafından da doğrudan çağrılır
// (salon şemasının hizmet testi içinde kurulabilmesi için), bu yüzden
// `pub(crate)`.
pub(crate) mod faz13;
mod seeds;
mod tables_migration;

#[cfg(test)]
mod faz12_tests;
#[cfg(test)]
mod faz13_tests;
#[cfg(test)]
mod tests;

pub type DbPool = Pool<Sqlite>;

// Alt modüllerdeki yordamlar init_db ve testler tarafından kullanılır.
pub(crate) use seeds::{
    migrate_platform_admin_pins_to_argon2, migrate_user_pins_to_argon2, seed_default_users,
};
pub(crate) use tables_migration::migrate_tables_current_total_to_integer;

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
    let _ = sqlx::raw_sql(
        "ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE orders ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE products ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE categories ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE tables ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE outbox ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE snapshots ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE order_items ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT';",
    )
    .execute(&pool)
    .await;
    // Faz 11: garson karnesi kalem bazlı kırılım okur. Mevcut kurulumlarda
    // `order_items` tablosu bu kolon olmadan oluşmuş olabilir; CREATE TABLE IF
    // NOT EXISTS var olan tabloyu değiştirmediği için ALTER gerekir.
    let _ = sqlx::raw_sql("ALTER TABLE order_items ADD COLUMN waiter_id TEXT;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_order_items_waiter ON order_items(tenant_id, waiter_id);",
    )
    .execute(&pool)
    .await;

    // P0: `staff_profiles.base_salary_cents` / `commission_percent` NOT NULL
    // idi. "Maaş henüz belirlenmedi" ile "maaş 0" aynı kutuya sıkıştığı için
    // müdürün profil kaydı patronun maaşını sessizce sıfırlıyordu. Kolon
    // nullable yapılır: bilinmeyen tutar `NULL` olur (AGENTS.md §3.4).
    // SQLite `DROP NOT NULL` desteklemediğinden tablo yeniden kurulur.
    let profil_not_null: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('staff_profiles')
          WHERE name = 'base_salary_cents' AND \"notnull\" = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(None);
    if profil_not_null.unwrap_or(0) > 0 {
        sqlx::raw_sql(
            "PRAGMA foreign_keys = OFF;
             BEGIN;
             CREATE TABLE staff_profiles_new (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
                user_id TEXT NOT NULL,
                full_name TEXT NOT NULL,
                base_salary_cents INTEGER,
                commission_percent INTEGER,
                birth_date TEXT,
                hire_date TEXT,
                phone TEXT,
                national_id TEXT,
                address TEXT,
                emergency_contact TEXT,
                notes TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tenant_id, user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
             );
             INSERT INTO staff_profiles_new
                SELECT id, tenant_id, user_id, full_name, base_salary_cents,
                       commission_percent, birth_date, hire_date, phone,
                       national_id, address, emergency_contact, notes,
                       created_at, updated_at
                  FROM staff_profiles;
             DROP TABLE staff_profiles;
             ALTER TABLE staff_profiles_new RENAME TO staff_profiles;
             COMMIT;
             PRAGMA foreign_keys = ON;",
        )
        .execute(&pool)
        .await?;
    }

    // DDL şemasını uygula (etki eşitsiz - tüm ifadeler CREATE TABLE IF NOT EXISTS kullanır)
    let schema = include_str!("../../migrations/schema.sql");
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
        );",
    )
    .execute(&pool)
    .await?;

    // Plans tablosuna eksik sütunları güvenle ekle (idempotent)
    let _ = sqlx::raw_sql("ALTER TABLE plans ADD COLUMN max_branches INTEGER NOT NULL DEFAULT 1;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE plans ADD COLUMN features TEXT;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE plans ADD COLUMN badge TEXT;")
        .execute(&pool)
        .await;

    // Users tablosuna kimlik doğrulama sütunlarını güvenle ekle (idempotent)
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

    // MASTER platform hesabı da düz metin `pin` taşıyordu; Argon2 sütunu önce
    // eklenir, yoksa migration'ın `SELECT ... pin_hash` ifadesi patlar.
    let _ = sqlx::raw_sql("ALTER TABLE platform_admins ADD COLUMN pin_hash TEXT;")
        .execute(&pool)
        .await;

    // Denetim defteri kategori ve hash sürümü sütunları. Sütunlar hash kanonik
    // formunun parçası değildir (hash_version = 1 dondurulmuştur), bu yüzden mevcut
    // satırların doğrulaması bozulmaz; eski satırlar SISTEM kategorisiyle işaretlenir.
    let _ = sqlx::raw_sql(
        "ALTER TABLE audit_ledger ADD COLUMN category TEXT NOT NULL DEFAULT 'SISTEM';",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE audit_ledger ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1;",
    )
    .execute(&pool)
    .await;

    // Faz 3 — anlık PIN onayı: `approvals` tablosu "kim onayladı" kaydı ve tek
    // kullanımlık jeton deposu haline geldi. CREATE TABLE IF NOT EXISTS eski
    // tanımı yükseltemediği için sütunlar burada idempotent eklenir.
    let _ = sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN approved_by_role TEXT;")
        .execute(&pool)
        .await;
    let _ =
        sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0;")
            .execute(&pool)
            .await;
    let _ = sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN token_hash TEXT;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN expires_at DATETIME;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE approvals ADD COLUMN consumed_at DATETIME;")
        .execute(&pool)
        .await;
    // Jeton tekliği ve tenant başına rapor sorguları için indeksler.
    let _ = sqlx::raw_sql("CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status ON approvals(tenant_id, status, created_at DESC);").execute(&pool).await;
    let _ = sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_approvals_resource ON approvals(tenant_id, resource_id);",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql("CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_token ON approvals(token_hash) WHERE token_hash IS NOT NULL;").execute(&pool).await;

    // Faz 4 — modifier gömme: `modifier_groups.category_id` kategori şablonunu
    // taşır. NULL = serbest grup. Eklenebilir çünkü mevcut satırlar NULL kalır;
    // hiçbir modifier verisi taşınmaz veya silinmez.
    let _ = sqlx::raw_sql("ALTER TABLE modifier_groups ADD COLUMN category_id TEXT;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("CREATE INDEX IF NOT EXISTS idx_modifier_groups_tenant_category ON modifier_groups(tenant_id, category_id);").execute(&pool).await;
    let _ = sqlx::raw_sql("CREATE INDEX IF NOT EXISTS idx_product_modifier_groups_product ON product_modifier_groups(product_id);").execute(&pool).await;

    // Tenants tablosuna şirket/vergi/iletişim sütunlarını güvenle ekle (idempotent)
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN contact_person TEXT;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN email TEXT;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN phone TEXT;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN tax_id TEXT;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN tax_office TEXT;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE tenants ADD COLUMN address TEXT;")
        .execute(&pool)
        .await;

    // PIN düz metin depolanmaz: eski `users.pin` sütunu Argon2'e taşınır ve
    // kaldırılır. Aynı işlemde tenant içi PIN benzersizliğini taşıyan tekil indeks
    // de düşer (hash'ler karşılaştırılamaz, indeks işe yaramazdı).
    migrate_user_pins_to_argon2(&pool).await?;
    migrate_platform_admin_pins_to_argon2(&pool).await?;
    let _ = sqlx::raw_sql("DROP INDEX IF EXISTS idx_users_pin;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql("DROP INDEX IF EXISTS idx_users_tenant_pin;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_users_tenant_active ON users(tenant_id, is_active);",
    )
    .execute(&pool)
    .await;

    // The table rebuild is deliberately after the base DDL. `CREATE TABLE IF NOT
    // EXISTS` cannot upgrade an old tables definition, so this is the authoritative
    // upgrade path for both cents and tenant ownership.
    migrate_tables_current_total_to_integer(&pool).await?;

    // Faz 12 — 86'd ve raf ömrü. `products` sütunları eklenebilir (mevcut
    // satırlar etkilenmez), ancak `inventory_batches.tenant_id` üzerindeki
    // `DEFAULT 'DEFAULT_TENANT'` sessiz havuz birleşmesi ürettiği için tablo
    // yeniden kurulur.
    faz12::migrate_products_for_86d(&pool).await?;
    faz12::migrate_inventory_batches_for_shelf_life(&pool).await?;
    faz12::migrate_stock_movements_for_products(&pool).await?;
    faz13::migrate_floor_plan_layout(&pool).await?;

    // -------------------------------------------------------------------------
    // Tohum koruması (Seed guard) 1: Masalar, ürünler ve kategoriler — sadece ilk çalıştırmada.
    // -------------------------------------------------------------------------
    let table_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tables")
        .fetch_one(&pool)
        .await?;

    if table_count == 0 {
        let seed = include_str!("../../migrations/seed.sql");
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

/// Minimal yapılandırılmış günlük (log) yardımcısı (eprintln yedeği — ekstra bağımlılık gerektirmez).
fn tracing_fallback_log(module: &str, msg: &str) {
    eprintln!("[INFO] {}: {}", module, msg);
}
