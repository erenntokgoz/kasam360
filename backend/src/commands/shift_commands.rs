//! Vardiya komutları (aç, kapat, aktif, tarihçe)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::commands::command_helpers::audit_actor;
use crate::commands::receipt_commands::require_tenant_scope;
use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDto {
    pub id: String,
    pub tenant_id: String,
    pub cashier_id: String,
    pub status: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub expected_amount_cents: i64,
    pub actual_amount_cents: Option<i64>,
    pub difference_cents: Option<i64>,
}

#[tauri::command]
pub async fn open_shift(
    cashier_id: String,
    expected_amount_cents: i64,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ShiftDto, String> {
    // Neden yetki eklendi (AGENTS.md §6): komut `actor_role`'ü yalnız denetim
    // kaydına yazıyordu, kontrol etmiyordu. Böylece mutfak ve garson rolü de
    // kasa vardiyası açıp beklenen bakiyeyi belirleyebiliyordu.
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    )?;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // Kiracı zorunludur: eksik gelen kiracı varsayılan kiracıya
    // düşerse vardiya kimliğine sahip olmayan bir defter
    // yazılır (AGENTS.md §3.3).
    let tenant_id = crate::commands::command_helpers::require_tenant_id(tenant_id.as_deref())?;

    // Açık vardiya var mı kontrol et
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM shifts WHERE cashier_id = ? AND status = 'OPEN' AND tenant_id = ?",
    )
    .bind(&cashier_id)
    .bind(&tenant_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if count > 0 {
        return Err("Vardiya zaten açık (Shift already open)".into());
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents) VALUES (?, ?, ?, 'OPEN', datetime('now'), ?)")
        .bind(&id)
        .bind(&tenant_id)
        .bind(&cashier_id)
        .bind(expected_amount_cents)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (_, actor_role) = audit_actor(None, actor_role);
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        cashier_id.clone(),
        actor_role,
        crate::services::audit_service::category::FINANS,
        "shift:opened",
        id.clone(),
        serde_json::json!({
            "shiftId": id,
            "expectedAmountCents": expected_amount_cents,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(ShiftDto {
        id,
        tenant_id,
        cashier_id,
        status: "OPEN".into(),
        opened_at: chrono::Utc::now().to_rfc3339(),
        closed_at: None,
        expected_amount_cents,
        actual_amount_cents: None,
        difference_cents: None,
    })
}

#[tauri::command]
pub async fn close_shift(
    cashier_id: String,
    actual_amount_cents: i64,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ShiftDto, String> {
    // Neden yetki eklendi (AGENTS.md §6): `actor_role` kontrol edilmiyordu.
    // Vardiya kapatma `actual_amount_cents` ile kasa farkı üretir; bunu
    // kasiyer dışındaki bir rol yapabiliyorsa muhasebe kaydı güvenilmez olur.
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    )?;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // Kiracı zorunludur: eksik gelen kiracı varsayılan kiracıya
    // düşerse vardiya kapanışı başka işletmenin kasanın
    // devresini yazabilir (AGENTS.md §3.3).
    let tenant_id = crate::commands::command_helpers::require_tenant_id(tenant_id.as_deref())?;

    // Find open shift
    let row = sqlx::query("SELECT id, expected_amount_cents, opened_at, tenant_id FROM shifts WHERE cashier_id = ? AND status = 'OPEN' AND tenant_id = ?")
        .bind(&cashier_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let r = row.ok_or("Aktif açık vardiya bulunamadı (No active open shift found)")?;
    // `expected_amount_cents` para okumasıdır: AGENTS.md §3.4 gereği hata
    // yukarı taşınır, sıfıra düşmez. Kasa farkı sıfır kabul edilemez.
    let id: String = r.try_get("id").map_err(|e| e.to_string())?;
    let expected: i64 = r
        .try_get("expected_amount_cents")
        .map_err(|e| e.to_string())?;
    let opened_at: String = r.try_get("opened_at").map_err(|e| e.to_string())?;
    let shift_tenant: String = r.try_get("tenant_id").map_err(|e| e.to_string())?;

    let calc = crate::commands::cashier_commands::calculate_expected_shift_balance(
        &mut tx, &tenant_id, &id, &opened_at, None, expected,
    )
    .await?;

    let difference = actual_amount_cents - calc.expected_balance;

    sqlx::query("UPDATE shifts SET status = 'CLOSED', closed_at = datetime('now'), actual_amount_cents = ?, difference_cents = ? WHERE id = ?")
        .bind(actual_amount_cents)
        .bind(difference)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Kasa kapanışı "Eski Değer → Yeni Değer" sütununun en kritik kaydıdır:
    // beklenen ile sayılan tutar ve fark burada görünür olur.
    let now_iso = chrono::Utc::now().to_rfc3339();
    let (_, actor_role) = audit_actor(None, actor_role);
    let ctx = crate::services::audit_service::AuditContext::new(
        shift_tenant,
        cashier_id.clone(),
        actor_role,
        crate::services::audit_service::category::FINANS,
        "shift:closed",
        id.clone(),
        serde_json::json!({
            "shiftId": id,
            "changes": {
                "expectedAmountCents": { "old": calc.expected_balance, "new": actual_amount_cents },
            },
            "differenceCents": difference,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(ShiftDto {
        id,
        tenant_id,
        cashier_id,
        status: "CLOSED".into(),
        opened_at,
        closed_at: Some(chrono::Utc::now().to_rfc3339()),
        expected_amount_cents: calc.expected_balance,
        actual_amount_cents: Some(actual_amount_cents),
        difference_cents: Some(difference),
    })
}

/// Aktif vardiya, **yalnız bu kiracının** kasiyerine aitse döner.
///
/// Neden tenant_id eklendi (AGENTS.md §3.3): komut `cashier_id` ile süzüyordu.
/// `cashier_id` başka işletmede de aynı olabileceğinden, filtre yokken bir işletme
/// diğerinin kasa bakiyesini görebiliyordu. `cashier_id` kullanıcı kimliği
/// olduğu için "tüm işletmeler bu kimliği paylaşıyor" varsayımı güvenli değildir.
#[tauri::command]
pub async fn get_active_shift(
    cashier_id: String,
    tenant_id: String,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Option<ShiftDto>, String> {
    crate::rbac::require_any_present(
        Some(actor_role.as_str()),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    )?;
    let tenant = require_tenant_scope(Some(tenant_id.as_str()))?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let row = sqlx::query(
        "SELECT id, tenant_id, cashier_id, status, opened_at, closed_at,
                expected_amount_cents, actual_amount_cents, difference_cents
           FROM shifts
          WHERE tenant_id = ? AND cashier_id = ? AND status = 'OPEN'",
    )
    .bind(&tenant)
    .bind(&cashier_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Satır kolonları zorunludur; `unwrap_or_default` ile boş değere düşmek
    // AGENTS.md §3.4'teki sessiz hata yasağını ihlal ederdi.
    row.map(|r| {
        Ok(ShiftDto {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            tenant_id: r.try_get("tenant_id").map_err(|e| e.to_string())?,
            cashier_id: r.try_get("cashier_id").map_err(|e| e.to_string())?,
            status: r.try_get("status").map_err(|e| e.to_string())?,
            opened_at: r.try_get("opened_at").map_err(|e| e.to_string())?,
            closed_at: r.try_get("closed_at").map_err(|e| e.to_string())?,
            expected_amount_cents: r
                .try_get("expected_amount_cents")
                .map_err(|e| e.to_string())?,
            actual_amount_cents: r
                .try_get("actual_amount_cents")
                .map_err(|e| e.to_string())?,
            difference_cents: r.try_get("difference_cents").map_err(|e| e.to_string())?,
        })
    })
    .transpose()
}

/// Açık vardiyalar, **yalnız bu kiracının** kayıtlarıyla döner.
///
/// Neden tenant_id eklendi (AGENTS.md §3.3): `WHERE s.status = 'OPEN'` filtresi
/// tüm işletmeleri kapsıyordu. `users` join'i de tenant'sızdı; kiracı sınırı hem
/// `shifts` hem `users` tarafında uygulanmalıdır.
#[tauri::command]
pub async fn get_open_shifts(
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<serde_json::Value>, String> {
    crate::rbac::require_any(
        &actor_role,
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    )?;
    let tenant = require_tenant_scope(Some(tenant_id.as_str()))?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query(
        "SELECT s.id, s.tenant_id, s.cashier_id, u.name AS cashier_name,
                s.opened_at, s.expected_amount_cents
           FROM shifts s
           LEFT JOIN users u ON u.id = s.cashier_id AND u.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND s.status = 'OPEN'
          ORDER BY s.opened_at ASC",
    )
    .bind(&tenant)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut shifts: Vec<serde_json::Value> = Vec::with_capacity(rows.len());
    for r in rows {
        shifts.push(serde_json::json!({
            "id": r.try_get::<String, _>("id").map_err(|e| e.to_string())?,
            "tenantId": r.try_get::<String, _>("tenant_id").map_err(|e| e.to_string())?,
            "cashierId": r.try_get::<String, _>("cashier_id").map_err(|e| e.to_string())?,
            // Kullanıcı bulunamazsa ad boş kalır; "Bilinmiyor" dönmesi daha
            // dürüsttür, kasiyer adının yerine başka bir isim konmamalıdır.
            "cashierName": r.try_get::<Option<String>, _>("cashier_name").ok().flatten(),
            "openedAt": r.try_get::<String, _>("opened_at").map_err(|e| e.to_string())?,
            "openingBalance": r
                .try_get::<i64, _>("expected_amount_cents")
                .map_err(|e| e.to_string())?,
        }));
    }
    Ok(shifts)
}

#[tauri::command]
pub async fn get_shift_history(
    cashier_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ShiftDto>, String> {
    // Neden yetki/tenant eklendi: komut parametresi olmadan tüm işletmelerin
    // vardiyalarını (kasa beklenen/gerçek tutarlarıyla) döküyordu.
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    )?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let cid = cashier_id.unwrap_or_default();
    let rows = if cid.is_empty() || cid == "ALL" {
        sqlx::query(
            "SELECT id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents, actual_amount_cents, difference_cents
             FROM shifts WHERE tenant_id = ? ORDER BY opened_at DESC LIMIT 50"
        )
        .bind(&tenant)
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?
    } else {
        sqlx::query(
            "SELECT id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents, actual_amount_cents, difference_cents
             FROM shifts WHERE tenant_id = ? AND cashier_id = ? ORDER BY opened_at DESC LIMIT 50"
        )
        .bind(&tenant)
        .bind(&cid)
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?
    };

    let shifts = rows
        .into_iter()
        .map(|r| -> Result<ShiftDto, String> {
            Ok(ShiftDto {
                id: r.try_get("id").map_err(|e| e.to_string())?,
                tenant_id: r.try_get("tenant_id").map_err(|e| e.to_string())?,
                cashier_id: r.try_get("cashier_id").map_err(|e| e.to_string())?,
                status: r.try_get("status").map_err(|e| e.to_string())?,
                opened_at: r.try_get("opened_at").map_err(|e| e.to_string())?,
                closed_at: r
                    .try_get::<Option<String>, _>("closed_at")
                    .map_err(|e| e.to_string())?,
                expected_amount_cents: r
                    .try_get("expected_amount_cents")
                    .map_err(|e| e.to_string())?,
                actual_amount_cents: r
                    .try_get::<Option<i64>, _>("actual_amount_cents")
                    .map_err(|e| e.to_string())?,
                difference_cents: r
                    .try_get::<Option<i64>, _>("difference_cents")
                    .map_err(|e| e.to_string())?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(shifts)
}
