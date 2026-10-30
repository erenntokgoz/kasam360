//! Yeni kurulumda yalnız çalışmak için gereken işletme ve kategori açılır.

use super::DbPool;
use crate::id_generator::generate_id;

const CENTRAL_NAME: &str = "Kasam360 Merkez İşletme";

pub(super) async fn seed_tenant(pool: &DbPool) -> Result<(), sqlx::Error> {
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM tenants WHERE name = ?")
        .bind(CENTRAL_NAME)
        .fetch_optional(pool)
        .await?;
    if existing.is_some() {
        return Ok(());
    }
    let tenant_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tenants")
        .fetch_one(pool)
        .await?;
    if tenant_count > 0 {
        return Err(sqlx::Error::Protocol(
            "merkez işletme bulunamadı; mevcut kiracı verisi otomatik taşınamaz".into(),
        ));
    }
    sqlx::query("INSERT INTO tenants (id, name, status) VALUES (?, ?, 'ACTIVE')")
        .bind(generate_id("tnt"))
        .bind(CENTRAL_NAME)
        .execute(pool)
        .await?;
    Ok(())
}

pub(super) async fn seed_category(pool: &DbPool) -> Result<(), sqlx::Error> {
    let tenant_id = super::merkez_tenant_id(pool).await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE tenant_id = ?")
        .bind(&tenant_id)
        .fetch_one(pool)
        .await?;
    if count == 0 {
        sqlx::query(
            "INSERT INTO categories (id, tenant_id, name, display_order, default_station)
             VALUES (?, ?, 'Genel', 0, 'MUTFAK')",
        )
        .bind(generate_id("cat"))
        .bind(&tenant_id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn temiz_kurulum_isletme_ve_kategori_acar() {
        let pool = super::super::init_db("sqlite::memory:")
            .await
            .expect("temiz veritabanı açılmalı");
        let tenant_id = super::super::merkez_tenant_id(&pool)
            .await
            .expect("merkez işletme bulunmalı");
        assert!(tenant_id.starts_with("tnt_"));
        let categories: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM categories WHERE tenant_id = ? AND name = 'Genel'",
        )
        .bind(&tenant_id)
        .fetch_one(&pool)
        .await
        .expect("kategori okunmalı");
        assert_eq!(categories, 1);
    }
}
