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
use crate::rbac::{self, Role};
use crate::services::cari::{
    self, ApproveDocumentInput, AwaitingDocument, CariOp, ReceiveLine, ReceivePurchaseInput,
    SETTLEMENT_TERM,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsableGrams {
    pub product_id: String,
    pub usable_grams_per_unit: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivePurchasePayload {
    pub operation_id: String,
    pub tenant_id: Option<String>,
    pub actor_id: String,
    pub purchase_order_id: String,
    /// `TERM` vadeli, diğerleri peşin ödeme kanalı.
    pub settlement: String,
    pub due_date: Option<String>,
    pub document_no: Option<String>,
    #[serde(default)]
    pub usable_grams: Vec<UsableGrams>,
}

/// Vadesi girilmeyen vadeli alımda tedarikçinin ödeme vadesi kullanılır.
fn default_due_date(created_at: chrono::DateTime<chrono::Utc>, term_days: i64) -> Option<String> {
    (term_days > 0).then(|| {
        (created_at.with_timezone(&chrono::Local) + chrono::Duration::days(term_days))
            .format("%Y-%m-%d")
            .to_string()
    })
}

/// Mal kabulünü stok ve cari hareketiyle birlikte yürütür.
pub(crate) async fn submit_receipt(
    pool: &DbPool,
    state: &crate::AppState,
    actor_role: Option<String>,
    payload: ReceivePurchasePayload,
) -> Result<Value, String> {
    rbac::require_any_present(actor_role.as_deref(), &[Role::Owner])?;
    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;
    let created_at = chrono::Utc::now();

    let (lines, term_days, shift_id) = {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let items = sqlx::query(
            "SELECT id, product_id FROM purchase_order_items
              WHERE tenant_id = ? AND purchase_order_id = ? ORDER BY id ASC",
        )
        .bind(&tid)
        .bind(&payload.purchase_order_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        let mut lines = Vec::with_capacity(items.len());
        for item in &items {
            let product_id: String = item.try_get("product_id").map_err(|e| e.to_string())?;
            lines.push(ReceiveLine {
                item_id: item.try_get("id").map_err(|e| e.to_string())?,
                batch_id: generate_id("bat"),
                movement_id: generate_id("smv"),
                usable_grams_per_unit: payload
                    .usable_grams
                    .iter()
                    .find(|entry| entry.product_id == product_id)
                    .map(|entry| entry.usable_grams_per_unit),
            });
        }
        let mut product_ids = Vec::with_capacity(items.len());
        for item in &items {
            product_ids.push(
                item.try_get::<String, _>("product_id")
                    .map_err(|e| e.to_string())?,
            );
        }
        if payload
            .usable_grams
            .iter()
            .any(|entry| !product_ids.contains(&entry.product_id))
        {
            return Err("VALIDATION: gram girilen ürün siparişte yok".into());
        }
        let term_days: i64 = sqlx::query_scalar(
            "SELECT s.payment_term_days FROM purchase_orders po
               JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
              WHERE po.id = ? AND po.tenant_id = ?",
        )
        .bind(&payload.purchase_order_id)
        .bind(&tid)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "NOT_FOUND: sipariş bulunamadı".to_string())?;
        // Vardiya ödeme anının gerçeğidir; işlemle birlikte mühürlenir.
        let shift_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM shifts WHERE tenant_id = ? AND status = 'OPEN'
              ORDER BY opened_at DESC LIMIT 1",
        )
        .bind(&tid)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        (lines, term_days, shift_id)
    };

    let is_term = payload.settlement == SETTLEMENT_TERM;
    let due_date = if is_term {
        payload
            .due_date
            .clone()
            .filter(|date| !date.trim().is_empty())
            .or_else(|| default_due_date(created_at, term_days))
    } else {
        payload
            .due_date
            .clone()
            .filter(|date| !date.trim().is_empty())
    };
    let intent = json!({
        "purchaseOrderId": payload.purchase_order_id,
        "settlement": payload.settlement,
        "dueDate": due_date,
        "documentNo": payload.document_no,
        "usableGrams": payload.usable_grams.iter().map(|entry| json!({
            "productId": entry.product_id,
            "usableGramsPerUnit": entry.usable_grams_per_unit,
        })).collect::<Vec<_>>(),
    });
    let op = CariOp::ReceivePurchase(ReceivePurchaseInput {
        purchase_order_id: payload.purchase_order_id,
        settlement: payload.settlement.clone(),
        due_date,
        document_no: payload.document_no,
        lines,
        document_id: generate_id("doc"),
        debt_id: generate_id("dbt"),
        new_directory_id: generate_id("dir"),
        payment_id: generate_id("pmt"),
        cash_movement_id: (payload.settlement == "CASH").then(|| generate_id("csh")),
        shift_id,
        actor_id: payload.actor_id.clone(),
        created_at: created_at.to_rfc3339(),
    });
    submit(
        pool,
        state,
        &tid,
        &payload.operation_id,
        Some(payload.actor_id),
        actor_role,
        intent,
        op,
    )
    .await
}

/// Mal kabulü: parti, stok hareketi ve tedarikçi borcu (peşinse ödemesi) tek işlemdir.
#[tauri::command]
pub async fn receive_purchase(
    actor_role: Option<String>,
    payload: ReceivePurchasePayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Value, String> {
    submit_receipt(&pool, &state, actor_role, payload).await
}
