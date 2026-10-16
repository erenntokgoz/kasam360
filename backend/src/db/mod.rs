//! Veritabanı açılışı, şema uygulama ve migration yordamları
//!
//! Modül yapısı:
//! tables_migration (masa kuruş/tenant yeniden kurumu), seeds (Argon2
//! tohumlama ve PIN migration'ları), inventory_migration (86'd ve raf ömrü sütunları),
//! floor_plan_migration (kroki yerleşimi), campaign_seeds (kampanya şablonları) ve
//! tests ayrı dosyalardadır.

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Sqlite};
use std::str::FromStr;

mod campaign_seeds;
pub(crate) mod floor_plan_migration;
mod inventory_migration;
mod migrate;
mod seeds;
mod tables_migration;

#[cfg(test)]
mod floor_plan_migration_tests;
#[cfg(test)]
mod inventory_migration_tests;
#[cfg(test)]
mod tests;

pub type DbPool = Pool<Sqlite>;

/// Merkez işletmenin (tek kiracılı kurulum) tenant kimliği.
///
/// Neden şemadan okunur: kiracı kimliği tek kaynaklıdır —
/// `migrations/seed.sql` içindeki merkez işletme satırıyla
/// aynıdır ve kaynak kodta sözlü olarak yaşamaz. Böylece
/// eski kurulumlarda bu kimlikle yazılmış satırlar yeni
/// bir tohum değeriyle asla karışmaz ve kiracı kimliği
/// şema ile senkron kalır.
pub(crate) async fn merkez_tenant_id(pool: &DbPool) -> Result<String, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT id FROM tenants WHERE name = 'Kasam360 Merkez İşletme'")
        .fetch_one(pool)
        .await
}

/// Kiracı çözülemediğinde veri dönüşümünde kullanılan rezerv
/// kimlik. Hiçbir işletmeye ait olmadığı için bu kimlikle
/// yazılmış satır hiçbir kiracı sorgusuyla görünmez —
/// sessizce ortak havuza düşmez (fail-closed, AGENTS.md §3.3).
const BILINMEYEN_KIRACI: &str = "tnt_unknown";

// Alt modüllerdeki yordamlar init_db ve testler tarafından kullanılır.
pub(crate) use campaign_seeds::seed_campaign_templates;
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

    // Master vault tablosu platform seviyesindedir (kiracı
    // verisi taşımaz) ve komutlardan önce hazır durmalıdır.
    {
        let mut conn = pool.acquire().await?;
        crate::services::master_vault::ensure_table(&mut conn).await?;
    }

    // Eski kurulumlarda tenant_id eksikse schema.sql indekslerinden
    // önce güvenle ekle (idempotent). Geri doldurma değeri merkez
    // işletmenin kiracı kimliğidir ve `tenants` tablosundan
    // okunur — kaynak kodta sözlü olarak yaşamaz. Kiracı
    // çözülemezse (kurulum bozuğu) sütun eklenmez: kiracısız
    // bir varsayım, tüm eski satırları kimliği belirsiz bir
    // ortak havuzuna düşürür ve bu sessiz kabul edilmez
    // (fail-closed, AGENTS.md §3.3).
    let merkez = merkez_tenant_id(&pool).await.ok();
    if let Some(merkez) = merkez {
        for tablo in [
            "users",
            "orders",
            "products",
            "categories",
            "tables",
            "events",
            "outbox",
            "snapshots",
            "order_items",
        ] {
            let _ = sqlx::raw_sql(&format!(
                "ALTER TABLE {tablo} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '{merkez}';",
            ))
            .execute(&pool)
            .await;
        }
    }
    // Garson karnesi kalem bazlı kırılım okur. Mevcut kurulumlarda
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

    // Yeni saha kolonları (Alman usulü parçalı ödeme, ikram, servis sırası, kuver ve istasyon).
    let _ = sqlx::raw_sql(
        "ALTER TABLE order_items ADD COLUMN paid_quantity INTEGER NOT NULL DEFAULT 0;",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql("ALTER TABLE order_items ADD COLUMN is_comp INTEGER NOT NULL DEFAULT 0;")
        .execute(&pool)
        .await;
    let _ = sqlx::raw_sql(
        "ALTER TABLE order_items ADD COLUMN course_number INTEGER NOT NULL DEFAULT 1;",
    )
    .execute(&pool)
    .await;
    let _ = sqlx::raw_sql("ALTER TABLE orders ADD COLUMN guest_count INTEGER NOT NULL DEFAULT 1;")
        .execute(&pool)
        .await;
    let _ =
        sqlx::raw_sql("ALTER TABLE categories ADD COLUMN default_station TEXT DEFAULT 'Sıcak';")
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
                 tenant_id TEXT NOT NULL,
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

    // Sürümlü migration'lar (0001_*.sql, 0002_*.sql, ...). Idempotent:
    // `_migrations` tablosunda version takibi yapar, calistirilmis
    // migration'ları tekrar calistirmez.
    migrate::run_migrations(&pool).await?;

    // Eğer yoksa order_items tablosunu oluştur
    // `tenant_id` üzerinde varsayılan YOK: bind edilmemiş
    // bir yazı hata verir, ortak havuzuna düşmez
    // (AGENTS.md §3.3; tables_migration ile aynı kural).
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS order_items (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            paid_quantity INTEGER NOT NULL DEFAULT 0,
            is_comp INTEGER NOT NULL DEFAULT 0,
            course_number INTEGER NOT NULL DEFAULT 1,
            unit_price_cents INTEGER NOT NULL,
            tax_rate_bp INTEGER NOT NULL,
            subtotal_cents INTEGER NOT NULL,
            tax_amount_cents INTEGER NOT NULL,
            total_cents INTEGER NOT NULL,
            station TEXT,
            modifiers TEXT,
            notes TEXT,
            status TEXT DEFAULT 'PENDING',
            waiter_id TEXT,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id)
        );",
    )
    .execute(&pool)
    .await?;

    // Şema zenginleştirmeleri ve indeksler 0002_schema_enhancements.sql üzerinden
    // sürümlü olarak çalıştırılır; her açılışta gereksiz ALTER TABLE çalıştırılmaz.

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

    // Tablo yeniden kurumu bilinçli olarak temel DDL sonrasındadır. `CREATE TABLE IF NOT
    // EXISTS` eski bir tablo tanımını yükseltemeyeceğinden, hem kuruş cinsine geçiş
    // hem de kiracı mülkiyeti için yetkili yükseltme yoludur.
    migrate_tables_current_total_to_integer(&pool).await?;

    // Envanter göçü — 86'd ve raf ömrü. `products` sütunları eklenebilir (mevcut
    // satırlar etkilenmez), ancak `inventory_batches.tenant_id` üzerindeki
    // kolon varsayılanı sessiz havuz birleşmesi ürettiği için tablo
    // yeniden kurulur.
    inventory_migration::migrate_products_for_86d(&pool).await?;
    inventory_migration::migrate_inventory_batches_for_shelf_life(&pool).await?;
    inventory_migration::migrate_stock_movements_for_products(&pool).await?;
    floor_plan_migration::migrate_floor_plan_layout(&pool).await?;
    // Yasal takvim ve kampanya şablonları. Şema `schema.sql` içinde
    // kurulur; burada yalnız on sistem şablonu tohumlanır (idempotent).
    seed_campaign_templates(&pool).await?;

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
        // Kiracı kimliği merkez işletmeden okunur (tek kaynak).
        // Kiracı çözülemezse (kurulum bozuğu) tohumlanmaz:
        // yanlış kiracıya yazmak, eksik kalmaktan kötüdür
        // (fail-closed, AGENTS.md §3.3).
        if let Ok(merkez) = merkez_tenant_id(&pool).await {
            sqlx::raw_sql(&format!(
                "INSERT OR IGNORE INTO directories (id, tenant_id, name, type, phone, credit_limit_cents) VALUES
                    ('dir_001', '{merkez}', 'Öz Gıda Toptan A.Ş.', 'SUPPLIER', '0212 555 1010', 5000000),
                    ('dir_002', '{merkez}', 'Ahmet Yılmaz (Masa 4 Veresiye)', 'CUSTOMER', '0532 111 2233', 100000),
                    ('dir_003', '{merkez}', 'Mehmet Usta (Aşçıbaşı)', 'STAFF', '0544 333 4455', 200000),
                    ('dir_004', '{merkez}', 'Dükkan Sahibi (Mülk Sahibi)', 'FIXED_EXPENSE', '0533 777 8899', 0),
                    ('dir_005', '{merkez}', 'Eren Bey (Patron Şahsi)', 'OWNER_PERSONAL', '0530 000 0001', 0);",
            ))
            .execute(&pool)
            .await?;
            tracing_fallback_log("db::seed", "Cari rehber kayıtları tohumlandı/doğrulandı");
        }
    }
    // Tohum koruması (Seed guard) 2: Kullanıcılar — her başlatmada, iki dalın da
    // dışında çalışır. Argon2 SQL içinde üretilemediği için seed.sql'den çıkarıldı.
    seed_default_users(&pool).await?;

    Ok(pool)
}

/// Yapılandırılmış günlük (log) yardımcısı.
fn tracing_fallback_log(module: &str, msg: &str) {
    tracing::info!("{}: {}", module, msg);
}
