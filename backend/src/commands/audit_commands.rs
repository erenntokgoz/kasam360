//! Denetim kaydı (audit_ledger) okuma komutu
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;


/// Denetim kaydının istemciye giden hali.
///
/// `current_hash` **bilerek yoktur**: ham SHA-256 değeri ne API'den ne arayüzden
/// çıkar (AGENTS.md §3.2). Arayüzün göstereceği tek şey `sealed` mührüdür.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AuditLogDto {
    pub id: String,
    pub sequence: i64,
    pub timestamp: String,
    pub actor_id: String,
    pub actor_role: String,
    pub category: String,
    pub action: String,
    pub resource_id: String,
    pub payload: serde_json::Value,
    pub sealed: bool,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct AuditLogFilterDto {
    #[serde(rename = "actorId", default)]
    pub actor_id: Option<String>,
    pub category: Option<String>,
    #[serde(rename = "startDate", default)]
    pub start_date: Option<String>,
    #[serde(rename = "endDate", default)]
    pub end_date: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[tauri::command]
pub async fn get_audit_logs(
    caller_role: String,
    tenant_id: String,
    filter: Option<AuditLogFilterDto>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<AuditLogDto>, String> {
    // Bu komut önceden hiç rol kapısı taşımıyordu; garson ve mutfak da tüm
    // tenant'ların denetim kayıtlarını okuyabiliyordu.
    crate::rbac::require_audit_read(&caller_role)?;

    let filter = filter.unwrap_or_default();

    if let Some(category) = filter.category.as_deref() {
        if !crate::services::audit_service::category::is_valid(category) {
            return Err(format!("UNKNOWN_AUDIT_CATEGORY: '{}'", category));
        }
    }

    // LIMIT her zaman bağlı değişkenle gelir; istekten gelen sayı makul bir
    // tavanla sınırlanır.
    const MAX_LIMIT: i64 = 500;
    let limit = filter.limit.unwrap_or(100).clamp(1, MAX_LIMIT);
    let offset = filter.offset.unwrap_or(0).max(0);

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Sorgu `QueryBuilder` ile kurulur: değerler her zaman bağlı değişkenle gider,
    // hiçbir filtre değeri SQL metnine gömülmez.
    let mut builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload \
         FROM audit_ledger WHERE tenant_id = ",
    );
    builder.push_bind(tenant_id);

    if let Some(actor_id) = filter.actor_id.as_deref() {
        builder.push(" AND actor_id = ");
        builder.push_bind(actor_id.to_string());
    }
    if let Some(category) = filter.category.as_deref() {
        builder.push(" AND category = ");
        builder.push_bind(category.to_string());
    }
    if let Some(start_date) = filter.start_date.as_deref() {
        builder.push(" AND timestamp >= ");
        builder.push_bind(start_date.to_string());
    }
    if let Some(end_date) = filter.end_date.as_deref() {
        builder.push(" AND timestamp <= ");
        builder.push_bind(end_date.to_string());
    }
    if let Some(search) = filter.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        builder.push(" AND (action LIKE ");
        builder.push_bind(format!("%{}%", search));
        builder.push(" OR resource_id LIKE ");
        builder.push_bind(format!("%{}%", search));
        builder.push(" OR actor_id LIKE ");
        builder.push_bind(format!("%{}%", search));
        builder.push(")");
    }

    builder.push(" ORDER BY sequence DESC LIMIT ");
    builder.push_bind(limit);
    builder.push(" OFFSET ");
    builder.push_bind(offset);

    let rows = builder
        .build()
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut logs = Vec::with_capacity(rows.len());
    for r in rows {
        logs.push(AuditLogDto {
            id: r.try_get("id").unwrap_or_default(),
            sequence: r.try_get("sequence").unwrap_or(0),
            timestamp: r.try_get("timestamp").unwrap_or_default(),
            actor_id: r.try_get("actor_id").unwrap_or_default(),
            actor_role: r.try_get("actor_role").unwrap_or_default(),
            category: r.try_get("category").unwrap_or_default(),
            action: r.try_get("action").unwrap_or_default(),
            resource_id: r.try_get("resource_id").unwrap_or_default(),
            payload: r
                .try_get::<String, _>("payload")
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                .unwrap_or(serde_json::Value::Null),
            sealed: true,
        });
    }

    Ok(logs)
}
