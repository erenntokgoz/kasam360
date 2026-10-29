//! Gelen işlemler uygulama öncesinde kalıcı ve tekil olarak tutulur.

use sqlx::{Row, SqliteConnection};

/// Aynı işlem tekrar gelirse yalnızca birebir aynı içeriğe izin verir.
pub async fn store_received(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    operation_id: &str,
    source_device_id: &str,
    payload: &str,
) -> Result<bool, String> {
    if tenant_id.trim().is_empty()
        || operation_id.trim().is_empty()
        || source_device_id.trim().is_empty()
    {
        return Err("VALIDATION: işlem ve kapsam kimlikleri zorunludur".to_string());
    }
    serde_json::from_str::<serde_json::Value>(payload).map_err(|e| e.to_string())?;

    let result = sqlx::query(
        "INSERT INTO sync_inbox (operation_id, tenant_id, source_device_id, payload)
         SELECT ?, ?, id, ? FROM devices
         WHERE id = ? AND tenant_id = ? AND status = 'ACTIVE'
         ON CONFLICT(operation_id) DO NOTHING",
    )
    .bind(operation_id)
    .bind(tenant_id)
    .bind(payload)
    .bind(source_device_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if result.rows_affected() == 1 {
        return Ok(true);
    }

    let active: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM devices WHERE id = ? AND tenant_id = ? AND status = 'ACTIVE'",
    )
    .bind(source_device_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if active.is_none() {
        return Err("UNAUTHORIZED: cihaz aktif değil veya kiracıya ait değil".to_string());
    }

    let existing = sqlx::query(
        "SELECT source_device_id, payload FROM sync_inbox
         WHERE operation_id = ? AND tenant_id = ?",
    )
    .bind(operation_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "CONFLICT: işlem kimliği başka kiracıya ait".to_string())?;
    let existing_device: String = existing
        .try_get("source_device_id")
        .map_err(|e| e.to_string())?;
    let existing_payload: String = existing.try_get("payload").map_err(|e| e.to_string())?;
    if existing_device != source_device_id || existing_payload != payload {
        return Err("CONFLICT: aynı işlem kimliği farklı içerikle geldi".to_string());
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    #[tokio::test]
    async fn tekrar_gelen_islem_ikinci_kez_kaydedilmez() {
        let options = SqliteConnectOptions::new().in_memory(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("havuz");
        sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("sema");
        let mut conn = pool.acquire().await.expect("baglanti");
        sqlx::query("INSERT INTO devices (id, tenant_id, name, device_type) VALUES ('dev_1', 'tnt_a', 'Kasa', 'POS')")
            .execute(&mut *conn)
            .await
            .expect("cihaz");

        assert!(
            store_received(&mut conn, "tnt_a", "op_1", "dev_1", "{\"n\":1}")
                .await
                .expect("ilk kayit")
        );
        assert!(
            !store_received(&mut conn, "tnt_a", "op_1", "dev_1", "{\"n\":1}")
                .await
                .expect("ayni islem")
        );
        assert!(
            store_received(&mut conn, "tnt_a", "op_1", "dev_1", "{\"n\":2}")
                .await
                .is_err()
        );
        assert!(
            store_received(&mut conn, "tnt_b", "op_1", "dev_1", "{\"n\":1}")
                .await
                .is_err()
        );
        let status: String = sqlx::query_scalar(
            "SELECT status FROM sync_inbox WHERE tenant_id = ? AND operation_id = ?",
        )
        .bind("tnt_a")
        .bind("op_1")
        .fetch_one(&mut *conn)
        .await
        .expect("durum");
        assert_eq!(status, "PENDING");
    }

    #[tokio::test]
    async fn yalniz_aktif_ve_ayni_kiracinin_cihazi_kabul_edilir() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().in_memory(true))
            .await
            .expect("havuz");
        sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("sema");
        let mut conn = pool.acquire().await.expect("baglanti");
        sqlx::query("INSERT INTO devices (id, tenant_id, name, device_type, status) VALUES ('dev_1', 'tnt_a', 'Kasa', 'POS', 'ACTIVE'), ('dev_2', 'tnt_a', 'Depo', 'POS', 'INACTIVE')")
            .execute(&mut *conn)
            .await
            .expect("cihazlar");

        assert!(
            store_received(&mut conn, "tnt_a", "op_unknown", "dev_x", "{}")
                .await
                .is_err()
        );
        assert!(
            store_received(&mut conn, "tnt_a", "op_passive", "dev_2", "{}")
                .await
                .is_err()
        );
        assert!(
            store_received(&mut conn, "tnt_b", "op_foreign", "dev_1", "{}")
                .await
                .is_err()
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_inbox WHERE tenant_id = ?")
            .bind("tnt_a")
            .fetch_one(&mut *conn)
            .await
            .expect("sayi");
        assert_eq!(count, 0);
    }
}
