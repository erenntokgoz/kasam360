//! Test sanal POS komutları. Çekim yalnız test modu açıkken çalışır ve para çekmez.

use serde::Deserialize;
use tauri::State;

use crate::commands::command_helpers::require_tenant_id;
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::lan_sync::WritePool;
use crate::services::pos_gateway::{
    self, ChargeRequest, ChargeResult, PaymentLogRow, TestProvider, TestScenario,
};

const COLLECTORS: [Role; 3] = [Role::Owner, Role::Manager, Role::Cashier];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestPosChargeInput {
    pub transaction_id: String,
    pub order_id: String,
    pub amount_cents: i64,
    pub scenario: TestScenario,
}

#[tauri::command]
pub async fn get_test_pos_mode(
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<bool, String> {
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    pos_gateway::test_mode_enabled(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn set_test_pos_mode(
    actor_role: String,
    tenant_id: Option<String>,
    enabled: bool,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.begin_write().await?;
    pos_gateway::set_test_mode(&mut conn, &tenant_id, enabled).await?;
    conn.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn test_pos_charge(
    actor_role: String,
    actor_id: String,
    tenant_id: Option<String>,
    input: TestPosChargeInput,
    pool: State<'_, DbPool>,
) -> Result<ChargeResult, String> {
    rbac::require_any(&actor_role, &COLLECTORS)?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.begin_write().await?;
    if !pos_gateway::test_mode_enabled(&mut conn, &tenant_id).await? {
        return Err("NOT_FOUND: test POS bu işletmede açık değil".into());
    }
    let result = pos_gateway::charge(
        &mut conn,
        &tenant_id,
        ChargeRequest {
            transaction_id: &input.transaction_id,
            order_id: &input.order_id,
            amount_cents: input.amount_cents,
            actor_id: &actor_id,
        },
        &TestProvider {
            scenario: input.scenario,
        },
    )
    .await?;
    conn.commit().await?;
    Ok(result)
}

#[tauri::command]
pub async fn test_pos_void(
    actor_role: String,
    tenant_id: Option<String>,
    transaction_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &COLLECTORS)?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.begin_write().await?;
    pos_gateway::void_charge(&mut conn, &tenant_id, &transaction_id).await?;
    conn.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn get_pos_payment_log(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<PaymentLogRow>, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    pos_gateway::list_log(&mut conn, &tenant_id).await
}
