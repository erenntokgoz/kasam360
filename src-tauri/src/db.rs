use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Sqlite};
use std::str::FromStr;

pub type DbPool = Pool<Sqlite>;

pub async fn init_db(database_url: &str) -> Result<DbPool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

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

    // -------------------------------------------------------------------------
    // Çalışma zamanı geçişi (Runtime migration): tables.current_total REAL → INTEGER (kuruş)
    //
    // SQLite ALTER COLUMN desteklemez, bu nedenle önerilen 12 adımlı
    // tablo yeniden oluşturma (table-rebuild) desenini kullanıyoruz. Geçiş,
    // pragma_table_info incelenerek korunur, böylece tamamen etki eşitsizdir (idempotent):
    // eski bir veritabanında bir kez çalışır ve sonraki tüm başlatmalarda hiçbir şey yapmaz.
    // Finansal veriler asla REAL olarak saklanmamalıdır (Kural #17).
    // -------------------------------------------------------------------------
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
    }

    Ok(pool)
}

/// Mevcut veritabanlarında `tables.current_total` değerini `REAL` türünden `INTEGER` türüne yükseltir.
///
/// Ertelenmiş (deferred) bir işlem (transaction) içinde SQLite'ın 12 adımlı tablo yeniden oluşturma desenini kullanır.
/// Etki eşitsiz (Idempotent): sütun türü zaten `INTEGER` ise (veya `REAL` dışında herhangi bir şeyse),
/// bu işlev veritabanına dokunmadan hemen geri döner.
async fn migrate_tables_current_total_to_integer(pool: &DbPool) -> Result<(), sqlx::Error> {
    // pragma_table_info aracılığıyla bildirilen sütun türünü kontrol et.
    let col_type: Option<String> = sqlx::query_scalar(
        "SELECT type FROM pragma_table_info('tables') WHERE name = 'current_total'",
    )
    .fetch_optional(pool)
    .await?;

    // Sadece sütun hala REAL olarak bildirilmişse geçiş yap.
    if col_type.as_deref() != Some("REAL") {
        return Ok(());
    }

    tracing_fallback_log("db::migration", "tables.current_total REAL → INTEGER: starting");

    // Yeniden oluşturma sırasında yabancı anahtar (foreign key) zorlamasını geçici olarak devre dışı bırak.
    sqlx::raw_sql(
        "PRAGMA foreign_keys = OFF;
         BEGIN;
         -- Adım 1: INTEGER current_total ile yeni tabloyu oluştur
         CREATE TABLE tables_new (
             id           TEXT    PRIMARY KEY,
             name         TEXT    NOT NULL,
             status       TEXT    NOT NULL DEFAULT 'AVAILABLE',
             opened_at    DATETIME,
             waiter_id    TEXT,
             current_total INTEGER NOT NULL DEFAULT 0
         );
         -- Adım 2: Mevcut satırları kopyala, REAL olan kuruş değerini INTEGER'a çevir
         INSERT INTO tables_new
             SELECT id, name, status, opened_at, waiter_id,
                    CAST(ROUND(current_total) AS INTEGER)
             FROM tables;
         -- Adım 3: Eski tabloyu sil ve yeni tablonun adını değiştir
         DROP TABLE tables;
         ALTER TABLE tables_new RENAME TO tables;
         -- Adım 4: Masalar üzerinde var olan indeksleri yeniden oluştur (PK dışında yok)
         COMMIT;
         PRAGMA foreign_keys = ON;",
    )
    .execute(pool)
    .await?;

    tracing_fallback_log("db::migration", "tables.current_total REAL → INTEGER: complete");
    Ok(())
}

/// Minimal yapılandırılmış günlük (log) yardımcısı (eprintln yedeği — ekstra bağımlılık gerektirmez).
fn tracing_fallback_log(module: &str, msg: &str) {
    eprintln!("[INFO] {}: {}", module, msg);
}
