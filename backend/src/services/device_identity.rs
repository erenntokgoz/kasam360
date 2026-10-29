//! Kurulumun hangi cihaz kaydına ait olduğu kalıcı olarak tutulur.

use sqlx::{Row, SqliteConnection};

/// Cihaz kaydına ilk bağlanma kalıcıdır; başka cihaz adına yeniden bağlanılmaz.
pub async fn bind_local_device(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    device_id: &str,
) -> Result<(), String> {
    if tenant_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("VALIDATION: kiracı ve cihaz kimliği zorunludur".to_string());
    }
    let result = sqlx::query(
        "INSERT INTO local_device_identity (slot, tenant_id, device_id)
         SELECT 1, tenant_id, id FROM devices
         WHERE id = ? AND tenant_id = ? AND status = 'ACTIVE'
         ON CONFLICT(slot) DO NOTHING",
    )
    .bind(device_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if result.rows_affected() == 1 {
        return Ok(());
    }

    let active: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM devices WHERE id = ? AND tenant_id = ? AND status = 'ACTIVE'",
    )
    .bind(device_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if active.is_none() {
        return Err("UNAUTHORIZED: cihaz aktif değil veya kiracıya ait değil".to_string());
    }
    let current = get_local_device(conn, tenant_id).await?;
    if current != (tenant_id.to_string(), device_id.to_string()) {
        return Err("CONFLICT: kurulum başka cihaza bağlı".to_string());
    }
    Ok(())
}

/// Yerel kimlik yoksa ağ işlemleri varsayılan cihaz seçmeden durur.
pub async fn get_local_device(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<(String, String), String> {
    let row = sqlx::query(
        "SELECT tenant_id, device_id FROM local_device_identity WHERE slot = 1 AND tenant_id = ?",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "UNCONFIGURED: yerel cihaz kimliği tanımlı değil".to_string())?;
    Ok((
        row.try_get("tenant_id").map_err(|e| e.to_string())?,
        row.try_get("device_id").map_err(|e| e.to_string())?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    #[tokio::test]
    async fn yerel_kimlik_yeniden_acilinca_korunur_ve_degistirilemez() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().in_memory(true))
            .await
            .expect("havuz");
        sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("sema");
        sqlx::query("INSERT INTO devices (id, tenant_id, name, device_type) VALUES ('dev_a', 'tnt_a', 'Kasa', 'POS'), ('dev_b', 'tnt_a', 'Yedek', 'POS')")
            .execute(&pool).await.expect("cihazlar");

        let mut first = pool.acquire().await.expect("ilk bağlantı");
        assert!(get_local_device(&mut first, "tnt_a").await.is_err());
        assert!(bind_local_device(&mut first, "tnt_a", "dev_unknown")
            .await
            .is_err());
        bind_local_device(&mut first, "tnt_a", "dev_a")
            .await
            .expect("ilk bağ");
        bind_local_device(&mut first, "tnt_a", "dev_a")
            .await
            .expect("tekrar bağ");
        drop(first);
        let mut reopened = pool.acquire().await.expect("yeniden bağlantı");
        assert_eq!(
            get_local_device(&mut reopened, "tnt_a")
                .await
                .expect("kimlik"),
            ("tnt_a".to_string(), "dev_a".to_string())
        );
        assert!(bind_local_device(&mut reopened, "tnt_a", "dev_b")
            .await
            .is_err());
        assert!(bind_local_device(&mut reopened, "tnt_b", "dev_a")
            .await
            .is_err());
        assert!(get_local_device(&mut reopened, "tnt_b").await.is_err());
    }
}
