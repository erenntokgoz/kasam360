//! Cari rehber komutları (firma/müşteri kartları)
//!
//! Bu dosya ledger_commands.rs 500 satır tavanını aştığı için bölündü.
//!
//! Güvenlik kapıları (Faz 9): rol kapısı, fail-closed kiracı çözümü,
//! `debts` alt sorgusunda kiracı filtresi, para okumalarında hata yükseltme,
//! her yazma işleminde `audit_ledger` kaydı.

use crate::commands::command_helpers::audit_actor;
use crate::db::DbPool;
use crate::id_generator::generate_id;
use crate::ledger_commands::guard::{require_ledger_read, require_ledger_tenant, require_ledger_write};
use crate::services::audit_service::{self, AuditContext, AuditService};
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DirectoryDto {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub directory_type: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "taxNo")]
    pub tax_no: Option<String>,
    #[serde(rename = "taxOffice")]
    pub tax_office: Option<String>,
    pub address: Option<String>,
    #[serde(rename = "creditLimitCents")]
    pub credit_limit_cents: i64,
    pub notes: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "balanceCents")]
    pub balance_cents: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CreateDirectoryPayload {
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub directory_type: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "taxNo")]
    pub tax_no: Option<String>,
    #[serde(rename = "taxOffice")]
    pub tax_office: Option<String>,
    pub address: Option<String>,
    #[serde(rename = "creditLimitCents")]
    pub credit_limit_cents: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UpdateDirectoryPayload {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "taxNo")]
    pub tax_no: Option<String>,
    #[serde(rename = "taxOffice")]
    pub tax_office: Option<String>,
    pub address: Option<String>,
    #[serde(rename = "creditLimitCents")]
    pub credit_limit_cents: Option<i64>,
    pub notes: Option<String>,
}

/// Bakiye alt sorgusu — her iki çağrıda da `debts` satırı karta ait kiracının
/// olmalıdır.
///
/// Neden: `deb.directory_id = d.id` tek başına yetmez. Aynı `directory_id`
/// başka bir kiracının `debts` tablosunda geçiyorsa (kimlik çakışması, hatalı
/// import) alt sorgu o borcu da toplar; yani başka işletmenin borcu bu
/// işletmenin cari kartında görünür. `deb.tenant_id = d.tenant_id` olmadan
/// bakiye kiracılar arası sızar.
const BALANCE_SUBQUERY: &str = "COALESCE((
                     SELECT SUM(
                         CASE WHEN deb.type = 'GIVEN' THEN deb.remaining_amount_cents
                              WHEN deb.type = 'TAKEN' THEN -deb.remaining_amount_cents
                              ELSE 0 END
                     ) FROM debts deb
                     WHERE deb.directory_id = d.id
                       AND deb.tenant_id = d.tenant_id
                       AND deb.status != 'PAID'
                 ), 0)";

/// `get_directories` çıktısındaki tek satırı DTO'ya çevirir.
///
/// Neden ayrı fonksiyon: liste ve "güncellenen kartı geri oku" yolu aynı kolon
/// setini okuyor. Para alanlarında (`credit_limit_cents`, `balance_cents`)
/// hata `?` ile yükseltilir; AGENTS.md §3.4 gereği `unwrap_or(0)` yasak.
fn row_to_directory(r: &sqlx::sqlite::SqliteRow) -> Result<DirectoryDto, String> {
    Ok(DirectoryDto {
        id: r.try_get("id").map_err(|e| e.to_string())?,
        tenant_id: r.try_get("tenant_id").map_err(|e| e.to_string())?,
        name: r.try_get("name").map_err(|e| e.to_string())?,
        directory_type: r.try_get("type").map_err(|e| e.to_string())?,
        phone: r.try_get("phone").map_err(|e| e.to_string())?,
        email: r.try_get("email").map_err(|e| e.to_string())?,
        tax_no: r.try_get("tax_no").map_err(|e| e.to_string())?,
        tax_office: r.try_get("tax_office").map_err(|e| e.to_string())?,
        address: r.try_get("address").map_err(|e| e.to_string())?,
        credit_limit_cents: r
            .try_get::<Option<i64>, _>("credit_limit_cents")
            .map_err(|e| e.to_string())?
            .unwrap_or(0),
        notes: r.try_get("notes").map_err(|e| e.to_string())?,
        created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
        balance_cents: r.try_get("balance_cents").map_err(|e| e.to_string())?,
    })
}

/// İşletmeye ait cari kartları ve bakiye durumlarını listeler.
#[tauri::command]
pub async fn get_directories(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    directory_type: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DirectoryDto>, String> {
    require_ledger_read(actor_role.as_deref())?;

    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT d.id, d.tenant_id, d.name, d.type, d.phone, d.email, d.tax_no, d.tax_office,
                d.address, d.credit_limit_cents, d.notes, d.created_at,
                {} as balance_cents
         FROM directories d
         WHERE d.tenant_id = ?{} 
         ORDER BY d.name ASC",
        BALANCE_SUBQUERY,
        if directory_type.is_some() { " AND d.type = ?" } else { "" }
    );

    let mut query = sqlx::query(&sql).bind(&tid);
    if let Some(ref dtype) = directory_type {
        query = query.bind(dtype);
    }

    let rows = query.fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(rows.len());
    for r in rows {
        result.push(row_to_directory(&r)?);
    }

    Ok(result)
}

/// Yeni bir cari rehber kartı oluşturur.
#[tauri::command]
pub async fn create_directory(
    actor_role: Option<String>,
    actor_id: Option<String>,
    payload: CreateDirectoryPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DirectoryDto, String> {
    require_ledger_write(actor_role.as_deref())?;

    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;
    let id = generate_id("dir");
    let limit = payload.credit_limit_cents.unwrap_or(0);

    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, phone, email, tax_no, tax_office, address, credit_limit_cents, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    )
    .bind(&id)
    .bind(&tid)
    .bind(&payload.name)
    .bind(&payload.directory_type)
    .bind(&payload.phone)
    .bind(&payload.email)
    .bind(&payload.tax_no)
    .bind(&payload.tax_office)
    .bind(&payload.address)
    .bind(limit)
    .bind(&payload.notes)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Cari kart oluşturulamadı: {}", e))?;

    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let ctx = AuditContext::new(
        tid.clone(),
        actor_id,
        actor_role,
        audit_service::category::FINANS,
        "directory:created",
        id.clone(),
        serde_json::json!({
            "directoryId": id,
            "name": payload.name,
            "type": payload.directory_type,
            "creditLimitCents": limit,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(DirectoryDto {
        id,
        tenant_id: tid,
        name: payload.name,
        directory_type: payload.directory_type,
        phone: payload.phone,
        email: payload.email,
        tax_no: payload.tax_no,
        tax_office: payload.tax_office,
        address: payload.address,
        credit_limit_cents: limit,
        notes: payload.notes,
        created_at: chrono::Utc::now().to_rfc3339(),
        balance_cents: 0,
    })
}

/// Mevcut bir cari rehber kartını günceller.
#[tauri::command]
pub async fn update_directory(
    actor_role: Option<String>,
    actor_id: Option<String>,
    payload: UpdateDirectoryPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DirectoryDto, String> {
    require_ledger_write(actor_role.as_deref())?;

    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;
    let limit = payload.credit_limit_cents.unwrap_or(0);

    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let updated = sqlx::query(
        "UPDATE directories
         SET name = ?, phone = ?, email = ?, tax_no = ?, tax_office = ?, address = ?, credit_limit_cents = ?, notes = ?
         WHERE id = ? AND tenant_id = ?"
    )
    .bind(&payload.name)
    .bind(&payload.phone)
    .bind(&payload.email)
    .bind(&payload.tax_no)
    .bind(&payload.tax_office)
    .bind(&payload.address)
    .bind(limit)
    .bind(&payload.notes)
    .bind(&payload.id)
    .bind(&tid)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Cari kart güncellenemedi: {}", e))?;

    // Neden bu kontrol şart: `tenant_id` filtresi yazmayı başka kiracının
    // kartına kaydırır, ama etkilenen satır 0 ise komut yine de `Ok` dönerdi.
    // Çağıran "güncelledim" sanıp gerçek kartın eski kalmasını görmezdi.
    if updated.rows_affected() == 0 {
        return Err("Cari kart bulunamadı (kiracı eşleşmedi).".to_string());
    }

    let r = sqlx::query(&format!(
        "SELECT d.id, d.tenant_id, d.name, d.type, d.phone, d.email, d.tax_no, d.tax_office,
                d.address, d.credit_limit_cents, d.notes, d.created_at,
                {} as balance_cents
         FROM directories d
         WHERE d.id = ? AND d.tenant_id = ?",
        BALANCE_SUBQUERY
    ))
    .bind(&payload.id)
    .bind(&tid)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Güncellenen cari kart okunamadı: {}", e))?;

    let dto = row_to_directory(&r)?;

    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let ctx = AuditContext::new(
        tid.clone(),
        actor_id,
        actor_role,
        audit_service::category::FINANS,
        "directory:updated",
        payload.id.clone(),
        serde_json::json!({
            "directoryId": payload.id,
            "name": dto.name,
            "creditLimitCents": dto.credit_limit_cents,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(dto)
}