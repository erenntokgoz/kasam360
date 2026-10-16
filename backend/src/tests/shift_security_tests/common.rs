//! Vardiya güvenlik testleri için ortak yardımcı yordamlar.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

pub const SCHEMA: &str = include_str!("../../../migrations/schema.sql");

pub async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let p = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("in-memory db");
    sqlx::raw_sql(SCHEMA)
        .execute(&p)
        .await
        .expect("şema uygulanmalı");
    p
}

pub async fn add_user(p: &sqlx::SqlitePool, tenant: &str, id: &str, name: &str, role: &str) {
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, is_active) VALUES (?1, ?2, ?3, ?4, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(role)
    .bind(name)
    .execute(p)
    .await
    .expect("kullanıcı eklenmeli");
}

pub async fn add_table(p: &sqlx::SqlitePool, tenant: &str, id: &str, waiter: Option<&str>) {
    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, waiter_id)
         VALUES (?1, ?2, ?3, 'AVAILABLE', ?4)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .bind(waiter)
    .execute(p)
    .await
    .expect("masa eklenmeli");
}

pub async fn add_shift(p: &sqlx::SqlitePool, tenant: &str, id: &str, cashier: &str, expected: i64) {
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
         VALUES (?1, ?2, ?3, 'OPEN', '2026-03-10T08:00:00Z', ?4)",
    )
    .bind(id)
    .bind(tenant)
    .bind(cashier)
    .bind(expected)
    .execute(p)
    .await
    .expect("vardiya eklenmeli");
}

pub async fn active_shift_sql(
    p: &sqlx::SqlitePool,
    tenant: &str,
    cashier: &str,
) -> Result<Option<String>, String> {
    let row = sqlx::query(
        "SELECT id FROM shifts WHERE tenant_id = ? AND cashier_id = ? AND status = 'OPEN'",
    )
    .bind(tenant)
    .bind(cashier)
    .fetch_optional(p)
    .await
    .map_err(|e| e.to_string())?;
    row.map(|r| r.try_get::<String, _>("id").map_err(|e| e.to_string()))
        .transpose()
}

pub async fn open_shifts_sql(p: &sqlx::SqlitePool, tenant: &str) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT s.id, s.tenant_id, s.cashier_id, u.name AS cashier_name, s.opened_at,
                s.expected_amount_cents
           FROM shifts s
           LEFT JOIN users u ON u.id = s.cashier_id AND u.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND s.status = 'OPEN'
          ORDER BY s.opened_at ASC",
    )
    .bind(tenant)
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(r.try_get::<String, _>("id").map_err(|e| e.to_string())?);
    }
    Ok(out)
}
