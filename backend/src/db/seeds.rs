use super::{tracing_fallback_log, DbPool};
use sqlx::{Acquire, Row};

/// Altı sabit rolü Argon2id hash'li PIN'lerle tohumlar.
///
/// Etkileşimli: önce `SELECT` ile varlık denetir, yalnızca eksik olan hash'lenir.
/// Böylece her açılışta altı Argon2 işlemi harcanmaz.
/// `ON CONFLICT DO NOTHING` tek başına yeterli değildir: hash parametre olarak
/// önceden hesaplanmak zorunda kalırdı.
pub(crate) async fn seed_default_users(pool: &DbPool) -> Result<(), sqlx::Error> {
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

        let hash = crate::user_credentials::hash_pin(pin).map_err(sqlx::Error::Protocol)?;
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
pub(crate) async fn migrate_user_pins_to_argon2(pool: &DbPool) -> Result<(), sqlx::Error> {
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
    sqlx::raw_sql("DROP TABLE users;").execute(&mut *tx).await?;
    sqlx::raw_sql("ALTER TABLE users_migrated RENAME TO users;")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    // VACUUM ve WAL kırpma aynı bağlantıyı ister; havuz tek bağlantılıysa
    // `conn` tutulduğu sürece bu çağrılar bağlantı zaman aşımına takılır.
    drop(conn);

    // Adım 4: eski düz metnin dosyada kalmasını engelle.
    let _ = sqlx::raw_sql("PRAGMA wal_checkpoint(TRUNCATE);")
        .execute(pool)
        .await;
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
pub(crate) async fn migrate_platform_admin_pins_to_argon2(
    pool: &DbPool,
) -> Result<(), sqlx::Error> {
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
    let _ = sqlx::raw_sql("PRAGMA wal_checkpoint(TRUNCATE);")
        .execute(pool)
        .await;
    let _ = sqlx::raw_sql("VACUUM;").execute(pool).await;

    tracing_fallback_log(
        "db::migration",
        &format!(
            "platform_admins.pin -> Argon2: {} satır dönüştürüldü",
            converted
        ),
    );
    Ok(())
}
