//! Adisyon tahsilat komutları.
//!
//! Tam ve parçalı ödeme aynı hesaptan geçer (`order_settlement`). Komut yalnız
//! kilitleri alır, kiracıyı çözer ve sonucu istemci sözleşmesine çevirir.

use super::types::{resolve_payment_tenant, PaymentPayloadDto, PaymentResultDto};
use crate::commands::receipt_commands::require_tenant_scope;
use crate::db::DbPool;
use crate::repositories::payment_repository::PaymentRepository;
use crate::services::order_settlement::{self, OrderBalance};
use serde::Serialize;

/// Tahsilat kilitlerini alır ve adisyonu işler.
pub(super) async fn settle(
    payload: PaymentPayloadDto,
    actor_role: String,
    pool: &DbPool,
    state: &crate::AppState,
) -> Result<PaymentResultDto, String> {
    // Parçalı ödeme de tahsilattır: tek kural, tek rol listesi.
    crate::rbac::require_any(
        &actor_role,
        &[crate::rbac::Role::Owner, crate::rbac::Role::Cashier],
    )?;

    // Kilit sırası her yerde aynıdır: önce payment_mutex, sonra audit_mutex.
    let _lock = state.payment_mutex.lock().await;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = resolve_payment_tenant(&mut tx, &payload).await?;
    let settlement = order_settlement::settle_order_payment(
        &mut tx,
        &audit_lock,
        &payload,
        &tenant_id,
        &actor_role,
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;

    let fiscal_receipt_no = format!(
        "FISC-{}",
        payload.transaction_id.chars().take(10).collect::<String>()
    );
    let message = match settlement.veresiye.as_ref() {
        Some(debt) => format!(
            "Veresiye: {} cari borca işlendi. Mali Fiş: {}",
            debt.directory_name, fiscal_receipt_no
        ),
        None => format!("Tahsilat tamamlandı. Mali Fiş: {fiscal_receipt_no}"),
    };

    Ok(PaymentResultDto {
        success: true,
        transaction_id: payload.transaction_id,
        fiscal_receipt_no: Some(fiscal_receipt_no),
        timestamp: settlement.now_iso,
        message,
        cogs_total: Some(settlement.total_cogs_cents),
        remaining_cents: Some(settlement.remaining_cents),
        order_closed: Some(settlement.order_closed),
    })
}

#[tauri::command]
pub async fn process_split_payment(
    payload: PaymentPayloadDto,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<PaymentResultDto, String> {
    state.lan_sync.require_local_write()?;
    crate::services::setup::require_complete(&pool).await?;
    settle(payload, actor_role, &pool, &state).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentStatusDto {
    pub processed: bool,
    pub balance: OrderBalance,
}

/// Sonucu belirsiz tahsilatın kaderi. İstemci ikinci kez göndermeden önce sorar.
#[tauri::command]
pub async fn get_payment_status(
    transaction_id: String,
    order_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<PaymentStatusDto, String> {
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    Ok(PaymentStatusDto {
        processed: PaymentRepository::check_idempotency(&mut conn, &transaction_id, &tenant)
            .await?,
        balance: order_settlement::order_balance(&mut conn, &tenant, &order_id).await?,
    })
}
