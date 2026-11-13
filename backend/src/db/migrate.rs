//! Sürümlü migration sistemi — numbered files + migration tracking table.
//!
//! Neden bu dosya: AGENTS.md §2'de "ID: Prefixed ULID, AUTOINCREMENT YASAK"
//! var; bununla ilgili olarak migration'lar da version tabanlı olmalı.
//! Mevcut `init_db()` içindeki `ALTER TABLE ... ADD COLUMN` blokları
//! idempotent ama version takibi yok — hangi migration'ların çalıştırıldığını
//! bilmiyoruz. Bu modül:
//! 1. Uygulamaya gömülü numbered `.sql` dosyalarını sırayla uygular.
//! 2. `_migrations` tablosunda version takibi yapar.
//! 3. Idempotent: çalıştırılmış migration'ları tekrar çalıştırmez.
//!
//! Kullanım: `init_db()` içinde `run_migrations(&pool).await?` olarak call edilir.

use sqlx::{Pool, Sqlite};

/// Migration tablosu — hangi version'ların uygulandığını takip eder.
pub const MIGRATIONS_TABLE: &str = "_migrations";

/// Migration'ları çalıştırır. Idempotent: calistirilmis bir migration tekrar calistirilmez.
///
/// # Hata
/// Migration dosyası okunamazsa veya SQL hatası verirse `Err` döner.
/// Sessiz geçiş YOK — hata yukarı taşınır.
pub async fn run_migrations(pool: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    // 1. Migration takip tablosunu oluştur (idempotent).
    sqlx::query(&format!(
        "CREATE TABLE IF NOT EXISTS {MIGRATIONS_TABLE} (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
        )"
    ))
    .execute(pool)
    .await?;

    // 2. Migration dosyalarını listele (0001_*.sql, 0002_*.sql, ...).
    let migration_files = list_migration_files();

    // 3. Her migration'ı sırayla uygula.
    for (version, name, sql) in &migration_files {
        let already: Option<i64> = sqlx::query_scalar(&format!(
            "SELECT version FROM {MIGRATIONS_TABLE} WHERE version = ?"
        ))
        .bind(version)
        .fetch_optional(pool)
        .await?;

        if already.is_some() {
            continue; // Idempotent: zaten uygulanmış.
        }

        // Kolonlar temel şemada zaten bulunabilir; her ifadeyi ayrı yürütmek
        // kısmi yükseltilmiş eski veritabanında eksik kalan kolonları korur.
        let mut tx = pool.begin().await?;
        let statements = sql
            .lines()
            .filter(|line| !line.trim_start().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        for statement in statements
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if let Err(error) = sqlx::raw_sql(statement).execute(&mut *tx).await {
                let message = error.to_string();
                if !message.contains("duplicate column name") && !message.contains("already exists")
                {
                    tx.rollback().await?;
                    tracing::error!(
                        "Migration başarısız: version={}, name={}, hata={}",
                        version,
                        name,
                        error
                    );
                    return Err(error);
                }
            }
        }
        sqlx::query(&format!(
            "INSERT INTO {MIGRATIONS_TABLE} (version, name) VALUES (?, ?)"
        ))
        .bind(version)
        .bind(name)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }

    Ok(())
}

/// Güncellemeler uygulamaya gömülür: kurulu cihazda `migrations` klasörü yoktur, klasörden
/// okunsaydı yükseltilen işletmenin şeması sessizce eski kalırdı.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "tax_rate_bp",
        include_str!("../../migrations/0001_tax_rate_bp.sql"),
    ),
    (
        2,
        "schema_enhancements",
        include_str!("../../migrations/0002_schema_enhancements.sql"),
    ),
    (
        3,
        "sync_inbox_sequence",
        include_str!("../../migrations/0003_sync_inbox_sequence.sql"),
    ),
    (
        4,
        "order_change_requests",
        include_str!("../../migrations/0004_order_change_requests.sql"),
    ),
    (
        5,
        "reservation_lead_and_tip_method",
        include_str!("../../migrations/0005_reservation_lead_and_tip_method.sql"),
    ),
    (
        6,
        "bill_requested",
        include_str!("../../migrations/0006_bill_requested.sql"),
    ),
    (
        7,
        "order_change_resolution",
        include_str!("../../migrations/0007_order_change_resolution.sql"),
    ),
    (
        8,
        "zone_ids",
        include_str!("../../migrations/0008_zone_ids.sql"),
    ),
    (
        9,
        "pay_period",
        include_str!("../../migrations/0009_pay_period.sql"),
    ),
    (
        10,
        "pin_length",
        include_str!("../../migrations/0010_pin_length.sql"),
    ),
    (
        11,
        "tariff_schedule",
        include_str!("../../migrations/0011_tariff_schedule.sql"),
    ),
    (
        12,
        "stations",
        include_str!("../../migrations/0012_stations.sql"),
    ),
    (
        13,
        "table_trail",
        include_str!("../../migrations/0013_table_trail.sql"),
    ),
    (
        14,
        "station_columns",
        include_str!("../../migrations/0014_station_columns.sql"),
    ),
    (
        15,
        "menu_extras",
        include_str!("../../migrations/0015_menu_extras.sql"),
    ),
    (
        16,
        "raw_and_usable_grams",
        include_str!("../../migrations/0016_raw_and_usable_grams.sql"),
    ),
    (
        17,
        "fixed_instead_of_commission",
        include_str!("../../migrations/0017_fixed_instead_of_commission.sql"),
    ),
    (
        18,
        "tip_recipients",
        include_str!("../../migrations/0018_tip_recipients.sql"),
    ),
    (
        19,
        "staff_pay_category",
        include_str!("../../migrations/0019_staff_pay_category.sql"),
    ),
    (
        20,
        "waste_void_allocations",
        include_str!("../../migrations/0020_waste_void_allocations.sql"),
    ),
    (
        21,
        "product_price_history",
        include_str!("../../migrations/0021_product_price_history.sql"),
    ),
    (
        22,
        "money_accounts",
        include_str!("../../migrations/0022_money_accounts.sql"),
    ),
];

/// Version numarasına göre sıralı `(version, name, sql_content)` listesi.
fn list_migration_files() -> Vec<(i64, String, String)> {
    MIGRATIONS
        .iter()
        .map(|(version, name, sql)| (*version, name.to_string(), sql.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_migration_files_test() {
        let files = list_migration_files();
        assert_eq!(files.len(), MIGRATIONS.len());
        for (version, name, sql) in &files {
            assert!(*version > 0, "version must be positive: {}", version);
            assert!(!name.is_empty(), "name must not be empty");
            assert!(!sql.is_empty(), "sql must not be empty: {}", name);
        }
    }
}
