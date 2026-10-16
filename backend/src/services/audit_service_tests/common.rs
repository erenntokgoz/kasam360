//! Denetim defteri testleri için ortak yardımcı yordamlar.

use crate::services::audit_service::*;
use sqlx::sqlite::SqlitePoolOptions;
use std::str::FromStr;

pub const LEDGER_SCHEMA: &str = include_str!("../../../migrations/schema.sql");

pub async fn ledger_pool() -> sqlx::SqlitePool {
    let options = sqlx::sqlite::SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(LEDGER_SCHEMA)
        .execute(&pool)
        .await
        .expect("denetim şeması uygulanır");
    pool
}

pub fn context(sequence_hint: i64) -> AuditContext {
    AuditContext::new(
        "tenant_a".to_string(),
        format!("usr_{}", sequence_hint),
        "Owner".to_string(),
        category::SIPARIS_MASA,
        "order:submitted",
        format!("ord_{}", sequence_hint),
        serde_json::json!({ "totalCents": 1000 * sequence_hint }),
        format!("2026-10-0{}T10:00:00+00:00", sequence_hint),
    )
    .expect("geçerli kategori")
}
