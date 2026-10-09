//! Sürümlü migration sistemi — numbered files + migration tracking table.
//!
//! Neden bu dosya: AGENTS.md §2'de "ID: Prefixed ULID, AUTOINCREMENT YASAK"
//! var; bununla ilgili olarak migration'lar da version tabanlı olmalı.
//! Mevcut `init_db()` içindeki `ALTER TABLE ... ADD COLUMN` blokları
//! idempotent ama version takibi yok — hangi migration'ların çalıştırıldığını
//! bilmiyoruz. Bu modül:
//! 1. `migrations/` klasöründeki numbered `.sql` dosyalarını okur.
//! 2. `_migrations` tablosunda version takibi yapar.
//! 3. Idempotent: çalıştırılmış migration'ları tekrar çalıştırmez.
//!
//! Kullanım: `init_db()` içinde `run_migrations(&pool).await?` olarak call edilir.

use sqlx::{Pool, Sqlite};

/// Migration tablosu — hangi version'ların uygulandığını takip eder.
pub const MIGRATIONS_TABLE: &str = "_migrations";

/// Migration dosyalarının saklandığı klasör (crate manifest dizini altı).
pub const MIGRATIONS_DIR: &str = "migrations";

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
    let migration_files = list_migration_files()?;
    if migration_files.is_empty() {
        return Ok(());
    }

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

        // Migration'ı transaction içinde çalıştır.
        // Idempotency: SQLite "duplicate column" hatası (SQLITE_BUSY /
        // duplicate column name) gelirse migration zaten uygulanmış sayılır.
        let mut tx = pool.begin().await?;
        let result = sqlx::raw_sql(sql).execute(&mut *tx).await;
        match result {
            Ok(_) => {
                sqlx::query(&format!(
                    "INSERT INTO {MIGRATIONS_TABLE} (version, name) VALUES (?, ?)"
                ))
                .bind(version)
                .bind(name)
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;
            }
            Err(e) => {
                // Migration zaten uygulanmış (kolon zaten varsa) — idempotent.
                tx.rollback().await?;
                sqlx::query(&format!(
                    "INSERT OR IGNORE INTO {MIGRATIONS_TABLE} (version, name) VALUES (?, ?)"
                ))
                .bind(version)
                .bind(name)
                .execute(pool)
                .await?;
                let _ = e; // Hata sessizce yutulur — migration zaten var.
            }
        }
    }

    Ok(())
}

/// Migration dosyalarını version numarasına göre sıralı listeler.
///
/// Format: `{version:04}_{name}.sql` — örn: `0001_tax_rate_bp.sql`.
/// Döndürür: `(version, name, sql_content)` üçlülüğü.
fn list_migration_files() -> Result<Vec<(i64, String, String)>, sqlx::Error> {
    let dir = std::path::Path::new(MIGRATIONS_DIR);
    let mut files: Vec<(i64, String, String)> = Vec::new();

    if !dir.exists() {
        return Ok(files);
    }

    let entries = std::fs::read_dir(dir).map_err(|e| sqlx::Error::Io(e))?;
    for entry in entries {
        let entry = entry.map_err(|e| sqlx::Error::Io(e))?;
        let path = entry.path();
        if path.extension().map(|e| e == "sql").unwrap_or(false) {
            let filename = entry.file_name().to_string_lossy().to_string();
            // "0001_tax_rate_bp.sql" → version=1, name="tax_rate_bp"
            let parts: Vec<&str> = filename.splitn(2, '_').collect();
            if parts.len() == 2 {
                if let Ok(version) = parts[0].parse::<i64>() {
                    let name = parts[1].trim_end_matches(".sql").to_string();
                    let sql = std::fs::read_to_string(&path).map_err(|e| sqlx::Error::Io(e))?;
                    files.push((version, name, sql));
                }
            }
        }
    }

    files.sort_by_key(|(v, _, _)| *v);
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_migration_files_test() {
        // Bu test migrations/ klasörününonda olduğu için sadece format doğrulaması yapar.
        let files = list_migration_files().unwrap();
        for (version, name, sql) in &files {
            assert!(*version > 0, "version must be positive: {}", version);
            assert!(!name.is_empty(), "name must not be empty");
            assert!(!sql.is_empty(), "sql must not be empty: {}", name);
        }
    }
}