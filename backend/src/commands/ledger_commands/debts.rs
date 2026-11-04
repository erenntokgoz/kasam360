//! Borç / alacak komutları (veresiye, toptancı borcu)
//!
//! Bu dosya ledger_commands.rs 500 satır tavanını aştığı için bölündü.
//!
//! Güvenlik kapıları: rol kapısı, fail-closed kiracı çözümü,
//! para okumalarında hata yükseltme, her yazma işleminde `audit_ledger` kaydı.

use crate::db::DbPool;
use crate::id_generator::generate_id;
use crate::ledger_commands::guard::{
    require_ledger_read, require_ledger_tenant, require_ledger_write,
};
use crate::ledger_commands::operations::submit;
use crate::services::cari::{CariOp, OpenDebtInput, RecordPaymentInput};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DebtDto {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "directoryId")]
    pub directory_id: String,
    #[serde(rename = "directoryName")]
    pub directory_name: Option<String>,
    #[serde(rename = "type")]
    pub debt_type: String, // 'GIVEN' (Alacak) veya 'TAKEN' (Borç)
    #[serde(rename = "totalAmountCents")]
    pub total_amount_cents: i64,
    #[serde(rename = "remainingAmountCents")]
    pub remaining_amount_cents: i64,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    pub status: String,
    #[serde(rename = "isCash")]
    pub is_cash: bool,
    #[serde(rename = "orderId")]
    pub order_id: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// Vadesi geçmiş ve kapanmamış; okuma anında hesaplanır, kayda yazılmaz.
    #[serde(rename = "isOverdue")]
    pub is_overdue: bool,
    /// Ödeme sayısı. Ödeme isteği bu sürümü geri gönderir.
    pub version: i64,
    #[serde(rename = "documentNo")]
    pub document_no: Option<String>,
    #[serde(rename = "purchaseOrderId")]
    pub purchase_order_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CreateDebtPayload {
    /// Yeniden denemede aynı kalan istemci işlem anahtarı.
    #[serde(rename = "operationId")]
    pub operation_id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    #[serde(rename = "directoryId")]
    pub directory_id: String,
    #[serde(rename = "type")]
    pub debt_type: String,
    #[serde(rename = "totalAmountCents")]
    pub total_amount_cents: i64,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    #[serde(rename = "isCash")]
    pub is_cash: Option<bool>,
    #[serde(rename = "orderId")]
    pub order_id: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "actorId")]
    pub actor_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PayDebtPayload {
    /// Yeniden denemede aynı kalan istemci işlem anahtarı.
    #[serde(rename = "operationId")]
    pub operation_id: String,
    /// Ekranın gördüğü borç sürümü.
    #[serde(rename = "expectedVersion")]
    pub expected_version: i64,
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    #[serde(rename = "debtId")]
    pub debt_id: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    #[serde(rename = "paymentMethod")]
    pub payment_method: String, // 'CASH', 'CREDIT_CARD', 'BANK_TRANSFER'
    #[serde(rename = "actorId")]
    pub actor_id: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DebtPaymentResultDto {
    #[serde(rename = "paymentId")]
    pub payment_id: String,
    #[serde(rename = "debtId")]
    pub debt_id: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    #[serde(rename = "remainingAmountCents")]
    pub remaining_amount_cents: i64,
    pub status: String,
    #[serde(rename = "cashMovementId")]
    pub cash_movement_id: Option<String>,
}

/// Borç listesi ve tekil okuma aynı kolonları okur.
const DEBT_SELECT: &str =
    "SELECT deb.id, deb.tenant_id, deb.directory_id, d.name as directory_name,
            deb.type, deb.total_amount_cents, deb.remaining_amount_cents, deb.due_date,
            deb.status, deb.is_cash, deb.order_id, deb.description, deb.created_at,
            sd.document_no, sd.purchase_order_id,
            (SELECT COUNT(*) FROM debt_payments dp
             WHERE dp.debt_id = deb.id AND dp.tenant_id = deb.tenant_id) as version,
            (deb.status != 'PAID' AND deb.due_date IS NOT NULL
             AND date(deb.due_date) < date('now', 'localtime')) as is_overdue
     FROM debts deb
     LEFT JOIN directories d ON deb.directory_id = d.id AND d.tenant_id = deb.tenant_id
     LEFT JOIN supplier_documents sd ON sd.debt_id = deb.id AND sd.tenant_id = deb.tenant_id
     WHERE deb.tenant_id = ?";

/// Borç satırını DTO'ya çevirir; para alanı okunamazsa hata yükselir, sıfırlanmaz.
fn row_to_debt(r: &sqlx::sqlite::SqliteRow) -> Result<DebtDto, String> {
    let is_cash_int: i64 = r.try_get("is_cash").map_err(|e| e.to_string())?;
    let is_overdue_int: i64 = r.try_get("is_overdue").map_err(|e| e.to_string())?;
    Ok(DebtDto {
        id: r.try_get("id").map_err(|e| e.to_string())?,
        tenant_id: r.try_get("tenant_id").map_err(|e| e.to_string())?,
        directory_id: r.try_get("directory_id").map_err(|e| e.to_string())?,
        directory_name: r.try_get("directory_name").map_err(|e| e.to_string())?,
        debt_type: r.try_get("type").map_err(|e| e.to_string())?,
        total_amount_cents: r.try_get("total_amount_cents").map_err(|e| e.to_string())?,
        remaining_amount_cents: r
            .try_get("remaining_amount_cents")
            .map_err(|e| e.to_string())?,
        due_date: r.try_get("due_date").map_err(|e| e.to_string())?,
        status: r.try_get("status").map_err(|e| e.to_string())?,
        is_cash: is_cash_int == 1,
        order_id: r.try_get("order_id").map_err(|e| e.to_string())?,
        description: r.try_get("description").map_err(|e| e.to_string())?,
        created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
        is_overdue: is_overdue_int == 1,
        version: r.try_get("version").map_err(|e| e.to_string())?,
        document_no: r.try_get("document_no").map_err(|e| e.to_string())?,
        purchase_order_id: r.try_get("purchase_order_id").map_err(|e| e.to_string())?,
    })
}

/// Borç veya alacak kayıtlarını listeler.
#[tauri::command]
pub async fn get_debts(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    status: Option<String>,
    debt_type: Option<String>,
    directory_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DebtDto>, String> {
    require_ledger_read(actor_role.as_deref())?;

    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let mut query_str = String::from(DEBT_SELECT);
    if status.is_some() {
        query_str.push_str(" AND deb.status = ?");
    }
    if debt_type.is_some() {
        query_str.push_str(" AND deb.type = ?");
    }
    if directory_id.is_some() {
        query_str.push_str(" AND deb.directory_id = ?");
    }
    query_str.push_str(" ORDER BY deb.created_at DESC, deb.id DESC");

    let mut query = sqlx::query(&query_str).bind(&tid);
    if let Some(ref st) = status {
        query = query.bind(st);
    }
    if let Some(ref dt) = debt_type {
        query = query.bind(dt);
    }
    if let Some(ref dir) = directory_id {
        query = query.bind(dir);
    }

    let rows = query
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(rows.len());
    for r in rows {
        result.push(row_to_debt(&r)?);
    }

    Ok(result)
}

/// Yeni borç veya alacak kaydı oluşturur.
#[tauri::command]
pub async fn create_debt(
    actor_role: Option<String>,
    actor_id: Option<String>,
    payload: CreateDebtPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DebtDto, String> {
    require_ledger_write(actor_role.as_deref())?;
    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;

    let intent = json!({
        "directoryId": payload.directory_id,
        "type": payload.debt_type,
        "amountCents": payload.total_amount_cents,
        "dueDate": payload.due_date,
        "isCash": payload.is_cash.unwrap_or(false),
        "orderId": payload.order_id,
        "description": payload.description,
    });
    let debt_id = generate_id("dbt");
    let op = CariOp::OpenDebt(OpenDebtInput {
        debt_id,
        directory_id: payload.directory_id,
        debt_type: payload.debt_type,
        amount_cents: payload.total_amount_cents,
        due_date: payload.due_date,
        is_cash: payload.is_cash.unwrap_or(false),
        order_id: payload.order_id,
        description: payload.description,
        created_at: chrono::Utc::now().to_rfc3339(),
    });
    let actor = actor_id.or(payload.actor_id);
    let outcome = submit(
        &pool,
        &state,
        &tid,
        &payload.operation_id,
        actor,
        actor_role,
        intent,
        op,
    )
    .await?;
    let debt_id = outcome["debtId"]
        .as_str()
        .ok_or_else(|| "INTERNAL: borç sonucu eksik".to_string())?;

    let row = sqlx::query(&format!("{DEBT_SELECT} AND deb.id = ?"))
        .bind(&tid)
        .bind(debt_id)
        .fetch_one(&*pool)
        .await
        .map_err(|e| format!("Açılan borç okunamadı: {e}"))?;
    row_to_debt(&row)
}

/// Ödeme görmemiş cari kaydı düzeltir.
#[tauri::command]
pub async fn update_debt(
    actor_role: Option<String>,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    operation_id: String,
    input: crate::services::cari::EditDebtInput,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    require_ledger_write(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let intent = json!({ "debtId": input.debt_id, "amountCents": input.amount_cents });
    let op = CariOp::EditDebt(input);
    submit(
        &pool,
        &state,
        &tid,
        &operation_id,
        actor_id,
        actor_role,
        intent,
        op,
    )
    .await?;
    Ok(())
}

/// Ödeme görmemiş cari kaydı siler.
#[tauri::command]
pub async fn delete_debt(
    actor_role: Option<String>,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    operation_id: String,
    debt_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    require_ledger_write(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let intent = json!({ "debtId": debt_id });
    let op = CariOp::DeleteDebt { debt_id };
    submit(
        &pool,
        &state,
        &tid,
        &operation_id,
        actor_id,
        actor_role,
        intent,
        op,
    )
    .await?;
    Ok(())
}

/// Borç veya alacak için tahsilat/tediye kaydeder. Nakitte kasa hareketi yazar.
#[tauri::command]
pub async fn pay_debt(
    actor_role: Option<String>,
    payload: PayDebtPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DebtPaymentResultDto, String> {
    require_ledger_write(actor_role.as_deref())?;
    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;

    // Vardiya sorgusu ödeme anının gerçeğidir; işlemle birlikte mühürlenir.
    let shift_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM shifts WHERE tenant_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1",
    )
    .bind(&tid)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    let is_cash = payload.payment_method == "CASH";

    let intent = json!({
        "debtId": payload.debt_id,
        "amountCents": payload.amount_cents,
        "paymentMethod": payload.payment_method,
        "expectedVersion": payload.expected_version,
        "notes": payload.notes,
    });
    let op = CariOp::RecordPayment(RecordPaymentInput {
        payment_id: generate_id("pmt"),
        debt_id: payload.debt_id,
        amount_cents: payload.amount_cents,
        payment_method: payload.payment_method,
        actor_id: payload.actor_id.clone(),
        notes: payload.notes,
        expected_version: payload.expected_version,
        cash_movement_id: is_cash.then(|| generate_id("csh")),
        shift_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    });
    let outcome = submit(
        &pool,
        &state,
        &tid,
        &payload.operation_id,
        Some(payload.actor_id),
        actor_role,
        intent,
        op,
    )
    .await?;
    serde_json::from_value(outcome).map_err(|e| format!("Ödeme sonucu okunamadı: {e}"))
}
