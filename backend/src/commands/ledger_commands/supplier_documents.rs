//! Tedarikçi belgesi komutları.
//!
//! Mal kabulü stok ekranına aittir; burası yalnız kabul edilmiş siparişin
//! belgesini onaylar ve tedarikçi borcunu doğurur.

use crate::db::DbPool;
use crate::id_generator::generate_id;
use crate::ledger_commands::guard::{
    require_ledger_read, require_ledger_tenant, require_ledger_write,
};
use crate::ledger_commands::operations::submit;
use crate::services::cari::{self, ApproveDocumentInput, AwaitingDocument, CariOp};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveSupplierDocumentPayload {
    pub operation_id: String,
    pub tenant_id: Option<String>,
    pub purchase_order_id: String,
    pub document_no: String,
    pub document_total_cents: i64,
    pub due_date: Option<String>,
    pub difference_reason: Option<String>,
    pub actor_id: String,
}

/// "Belge bekleniyor" durumundaki mal kabulleri.
#[tauri::command]
pub async fn get_awaiting_supplier_documents(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<AwaitingDocument>, String> {
    require_ledger_read(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    cari::awaiting_documents(&mut conn, &tid).await
}

/// Belgeyi kontrol edilmiş tutarla onaylar ve tedarikçi borcunu açar.
#[tauri::command]
pub async fn approve_supplier_document(
    actor_role: Option<String>,
    payload: ApproveSupplierDocumentPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Value, String> {
    require_ledger_write(actor_role.as_deref())?;
    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;

    let intent = json!({
        "purchaseOrderId": payload.purchase_order_id,
        "documentNo": payload.document_no,
        "documentTotalCents": payload.document_total_cents,
        "dueDate": payload.due_date,
        "differenceReason": payload.difference_reason,
    });
    let op = CariOp::ApproveDocument(ApproveDocumentInput {
        document_id: generate_id("doc"),
        debt_id: generate_id("dbt"),
        new_directory_id: generate_id("dir"),
        purchase_order_id: payload.purchase_order_id,
        document_no: payload.document_no,
        document_total_cents: payload.document_total_cents,
        due_date: payload.due_date,
        difference_reason: payload.difference_reason,
        actor_id: payload.actor_id.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
    });
    submit(
        &pool,
        &state,
        &tid,
        &payload.operation_id,
        Some(payload.actor_id),
        actor_role,
        intent,
        op,
    )
    .await
}
