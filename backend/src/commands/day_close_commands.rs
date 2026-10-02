//! Gün sonu komutları (günlük özet, gün kapatma)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use crate::commands::command_helpers::audit_actor;


#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DailySummaryDto {
    pub total_revenue_cents: i64,
    pub total_orders: i64,
    pub payment_methods: std::collections::HashMap<String, i64>,
}

#[tauri::command]
pub async fn get_daily_summary(
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<DailySummaryDto, String> {
    crate::rbac::require_any(&actor_role, &[crate::rbac::Role::Owner, crate::rbac::Role::Manager, crate::rbac::Role::Cashier])?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Ciro ve ödeme yöntemi dağılımı tenant'a göre daraltılır: defter tek bir
    // zincirde tutulduğu için filtresiz sorgu tüm işletmelerin cirosunu toplardı.
    let row = sqlx::query("SELECT COALESCE(sum(total_cents), 0) as total, COUNT(*) as count FROM orders WHERE tenant_id = ? AND status IN ('PAID', 'CLOSED') AND created_at >= date('now', 'start of day')")
        .bind(&tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let total_revenue_cents: i64 = row.try_get("total").unwrap_or(0);
    let total_orders: i64 = row.try_get("count").unwrap_or(0);

    let methods_rows = sqlx::query(
        "SELECT json_extract(payload, '$.method') as method, COALESCE(sum(json_extract(payload, '$.totalAmount')), 0) as amount 
         FROM audit_ledger 
         WHERE tenant_id = ? AND action='payment:settled_fifo' AND created_at >= date('now', 'start of day')
         GROUP BY json_extract(payload, '$.method')"
    )
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut payment_methods = std::collections::HashMap::new();
    for r in methods_rows {
        if let Ok(method) = r.try_get::<String, _>("method") {
            // totalAmount in audit_ledger payload is stored as integer cents — read directly.
            let amount_cents: i64 = r.try_get("amount").unwrap_or(0);
            payment_methods.insert(method, amount_cents);
        }
    }

    Ok(DailySummaryDto {
        total_revenue_cents,
        total_orders,
        payment_methods,
    })
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloseDayResultDto {
    pub success: bool,
    pub message: String,
    pub closed_shifts_count: i64,
    pub total_revenue_cents: i64,
    pub total_orders: i64,
    pub closed_at: String,
}

#[tauri::command]
pub async fn close_day(
    actor_role: Option<String>,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    #[allow(non_snake_case)]
    tenantId: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CloseDayResultDto, String> {
    let effective_tenant = tenant_id.or(tenantId).unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let now_str = chrono::Utc::now().to_rfc3339();

    // 1. Yalnızca bu işletmeye ait açık vardiyaları kapat ve dürüst mutabakat farkını mühürle
    let open_shifts = sqlx::query("SELECT id, expected_amount_cents, actual_amount_cents FROM shifts WHERE status = 'OPEN' AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT')")
        .bind(&effective_tenant)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let closed_shifts_count = open_shifts.len() as i64;
    for shift in open_shifts {
        let sid: String = shift.try_get("id").unwrap_or_default();
        let expected: i32 = shift.try_get("expected_amount_cents").unwrap_or(0);
        let actual_opt: Option<i32> = shift.try_get("actual_amount_cents").ok();

        let (actual, diff) = if let Some(act) = actual_opt {
            (act, act - expected)
        } else {
            (expected, 0)
        };

        sqlx::query("UPDATE shifts SET status = 'CLOSED', closed_at = datetime('now'), actual_amount_cents = ?, difference_cents = ? WHERE id = ? AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT')")
            .bind(actual)
            .bind(diff)
            .bind(&sid)
            .bind(&effective_tenant)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 2. Bu işletmeye ait günlük ciroyu çek
    let row = sqlx::query("SELECT COALESCE(sum(total_cents), 0) as total, COUNT(*) as count FROM orders WHERE status IN ('PAID', 'CLOSED') AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT') AND created_at >= date('now', 'start of day')")
        .bind(&effective_tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let total_revenue_cents: i64 = row.try_get("total").unwrap_or(0);
    let total_orders: i64 = row.try_get("count").unwrap_or(0);

    // 3. Denetim defteri kaydını ekle.
    //
    // Bu kayıt artık `?` ile zorunlu: gün sonu kapanışı deftere girmeden
    // commit edilmez. Önceden hata sessizce yutuluyordu.
    let (user_id, role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "tenantId": &effective_tenant,
        "closedShiftsCount": closed_shifts_count,
        "totalRevenueCents": total_revenue_cents,
        "totalOrders": total_orders,
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        effective_tenant,
        user_id,
        role,
        crate::services::audit_service::category::FINANS,
        "day:closed",
        "DAILY_CLOSING".to_string(),
        payload,
        now_str.clone(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(CloseDayResultDto {
        success: true,
        message: format!("Gün sonu başarıyla kapatıldı. {} adet açık vardiya sonlandırıldı.", closed_shifts_count),
        closed_shifts_count,
        total_revenue_cents,
        total_orders,
        closed_at: now_str,
    })
}
