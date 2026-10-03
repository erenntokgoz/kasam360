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

    let total_revenue_cents: i64 = row.try_get("total").map_err(|e| e.to_string())?;
    let total_orders: i64 = row.try_get("count").map_err(|e| e.to_string())?;

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
    approval_token: Option<String>,
    #[allow(non_snake_case)]
    approvalToken: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CloseDayResultDto, String> {
    let effective_tenant = tenant_id.or(tenantId).unwrap_or_else(|| "DEFAULT_TENANT".to_string());

    // Gün sonu kasayı devreder: vardiyalar kapanır, mutabakat farkı mühürlenir.
    // Önceden **hiç rol denetimi yoktu** — garson dahil herkes günü
    // kapatabiliyordu. Kasa devri yönetim işlemidir.
    let (user_id, role) = audit_actor(actor_id, actor_role.clone());
    crate::rbac::require_any(
        &role,
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
    )?;

    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let jeton = approval_token.or(approvalToken);

    let now_str = chrono::Utc::now().to_rfc3339();

    // 1. Yalnızca bu işletmeye ait açık vardiyaları kapat ve dürüst mutabakat farkını mühürle.
    //
    // `OR tenant_id = 'DEFAULT_TENANT'` **kaldırıldı**: ifade herhangi bir
    // kiracı çağırdığında DEFAULT_TENANT'ın vardiyalarını da kapatıyordu, yani
    // bir işletmenin gün sonu komutu başka bir işletmenin kasasını devrederdi.
    let open_shifts = sqlx::query(
        "SELECT id, expected_amount_cents, actual_amount_cents
         FROM shifts WHERE status = 'OPEN' AND tenant_id = ?",
    )
    .bind(&effective_tenant)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Günlük ciro, eşiğin karşılaştırılacağı tutardır (D3).
    let gunluk_satir = sqlx::query(
        "SELECT COALESCE(sum(total_cents), 0) as total, COUNT(*) as count
         FROM orders WHERE status IN ('PAID', 'CLOSED') AND tenant_id = ?
           AND created_at >= date('now', 'start of day')",
    )
    .bind(&effective_tenant)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Para okumaları `unwrap_or(0)` olamaz (AGENTS.md §3.4).
    let total_revenue_cents: i64 = gunluk_satir.try_get("total").map_err(|e| e.to_string())?;
    let total_orders: i64 = gunluk_satir.try_get("count").map_err(|e| e.to_string())?;

    // Eşik aşımı onay gerektirir (D3). Gün sonu eşiği günün cirosudur: yüksek
    // ciro günü kapatma yetkisi müdürde olmalıdır.
    let esik = crate::services::security360::threshold::esik_oku(&mut tx, &effective_tenant).await?;
    if crate::services::security360::money_gate::gun_sonu_onay_gerekli_mi(total_revenue_cents, esik) {
        let token = crate::services::security360::money_gate::onay_jetonunu_zorunlu_kil(
            jeton.as_deref(),
        )?;

        let request = crate::approval_service::ApprovalRequest {
            tenant_id: effective_tenant.clone(),
            operation: crate::approval_service::operation::CLOSE_DAY.to_string(),
            resource_id: "DAILY_CLOSING".to_string(),
            actor_id: user_id.clone(),
            actor_role: role.clone(),
            amount_cents: total_revenue_cents,
            approved_percent_hint: 0,
            terminal_id: "terminal_day_close".to_string(),
        };
        let approver = crate::approval_service::consume_token(&mut tx, token, &request).await?;

        let ctx = crate::services::audit_service::AuditContext::new(
            effective_tenant.clone(),
            approver.approver_id.clone(),
            approver.approver_role.as_str().to_string(),
            crate::services::audit_service::category::GUVENLIK,
            "approval:consumed",
            "DAILY_CLOSING".to_string(),
            serde_json::json!({
                "operation": crate::approval_service::operation::CLOSE_DAY,
                "amountCents": total_revenue_cents,
                "thresholdCents": esik,
                "actorId": request.actor_id,
                "approverId": approver.approver_id,
                "approverRole": approver.approver_role.as_str(),
            }),
            chrono::Utc::now().to_rfc3339(),
        )?;
        crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;
    }

    let closed_shifts_count = open_shifts.len() as i64;
    for shift in open_shifts {
        let sid: String = shift.try_get("id").map_err(|e| e.to_string())?;
        let expected: i64 = shift
            .try_get("expected_amount_cents")
            .map_err(|e| e.to_string())?;
        let actual_opt: Option<i64> = shift.try_get("actual_amount_cents").ok();

        // Sayım girilmemişse fark **bilinmiyor**, sıfır değil. Kapatma yine
        // yapılır (vardiya sonsuza dek açık kalamaz) ama fark `NULL` yazılır;
        // sıfır yazmak "kasayı saydım, tutuyor" izlenimi verirdi.
        let (actual, diff) = crate::services::security360::money_gate::kapanis_farki(
            expected,
            actual_opt,
        );

        sqlx::query(
            "UPDATE shifts SET status = 'CLOSED', closed_at = datetime('now'),
             actual_amount_cents = ?, difference_cents = ? WHERE id = ? AND tenant_id = ?",
        )
        .bind(actual)
        .bind(diff)
        .bind(&sid)
        .bind(&effective_tenant)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    // 3. Denetim defteri kaydını ekle.
    //
    // Bu kayıt artık `?` ile zorunlu: gün sonu kapanışı deftere girmeden
    // commit edilmez. Önceden hata sessizce yutuluyordu.
    // `user_id`/`role` yukarıda üretildi; tekrar üretilmez.
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
