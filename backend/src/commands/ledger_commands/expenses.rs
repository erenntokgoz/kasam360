//! Genel işletme giderleri ve finansal rapor (P&L)
//!
//! Bu dosya ledger_commands.rs 500 satır tavanını aştığı için bölündü.
//!
//! Güvenlik kapıları: rol kapısı, fail-closed kiracı çözümü,
//! tarih aralığının yarım kabul edilmemesi, para okumalarında hata yükseltme
//! (`AGENTS.md §3.4`), her yazma işleminde `audit_ledger` kaydı.

use crate::commands::command_helpers::audit_actor;
use crate::db::DbPool;
use crate::ledger_commands::guard::{require_ledger_read, require_ledger_tenant};
use crate::services::audit_service::{self, AuditContext, AuditService};
use crate::services::expense_service::{self, insert_expense, NewExpense};
use crate::services::lan_sync::WritePool;
use crate::services::staff360::payroll_gate;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExpenseDto {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub category: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    #[serde(rename = "paymentMethod")]
    pub payment_method: String,
    #[serde(rename = "directoryId")]
    pub directory_id: Option<String>,
    #[serde(rename = "directoryName")]
    pub directory_name: Option<String>,
    #[serde(rename = "shiftId")]
    pub shift_id: Option<String>,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    pub description: Option<String>,
    #[serde(rename = "expenseDate")]
    pub expense_date: String,
    #[serde(rename = "recurringId")]
    pub recurring_id: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CreateExpensePayload {
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    pub category: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    #[serde(rename = "paymentMethod")]
    pub payment_method: String,
    #[serde(rename = "directoryId")]
    pub directory_id: Option<String>,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    pub description: Option<String>,
    #[serde(rename = "expenseDate")]
    pub expense_date: Option<String>,
    /// Sabit gider ödemesiyse kaynağı: "bu ay ödendi" başlığa değil buna bakar.
    #[serde(rename = "recurringId", default)]
    pub recurring_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExpenseCategorySummaryDto {
    pub category: String,
    #[serde(rename = "totalCents")]
    pub total_cents: i64,
    pub count: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MonthlyFinancialTrendDto {
    pub month: String,
    #[serde(rename = "revenueCents")]
    pub revenue_cents: i64,
    #[serde(rename = "expenseCents")]
    pub expense_cents: i64,
    #[serde(rename = "profitCents")]
    pub profit_cents: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FinancialReportDto {
    #[serde(rename = "totalRevenueCents")]
    pub total_revenue_cents: i64,
    #[serde(rename = "totalCogsCents", default)]
    pub total_cogs_cents: i64,
    #[serde(rename = "totalRefundsCents", default)]
    pub total_refunds_cents: i64,
    #[serde(rename = "totalVatCents")]
    pub total_vat_cents: i64,
    #[serde(rename = "grossProfitCents", default)]
    pub gross_profit_cents: i64,
    /// Partisiz düşülen kalem sayısı; sıfır değilse kâr yaklaşıktır.
    #[serde(rename = "costMissingLines", default)]
    pub cost_missing_lines: i64,
    #[serde(rename = "totalExpensesCents")]
    pub total_expenses_cents: i64,
    #[serde(rename = "netProfitCents")]
    pub net_profit_cents: i64,
    #[serde(rename = "receivablesCents")]
    pub receivables_cents: i64,
    #[serde(rename = "payablesCents")]
    pub payables_cents: i64,
    #[serde(rename = "expensesByCategory")]
    pub expenses_by_category: Vec<ExpenseCategorySummaryDto>,
    #[serde(rename = "monthlyTrend")]
    pub monthly_trend: Vec<MonthlyFinancialTrendDto>,
}

/// Tarih aralığını fail-closed çözer.
///
/// Neden `Option<(String, String)>` dönüyor: önceki yazım `if start.is_some() &&
/// end.is_some()` korumasına güveniyordu ve korumanın içinde `unwrap()`
/// kullanıyordu. Koruma yanlış yazılırsa komut paniklerdi. Burada eşleşme
/// doğrudan `Option` üretir: ikisi de verilmişse `Some`, yarım verilmişse
/// `None` ve çağıran bilinçli şekilde "tüm zaman" aralığına düşer.
///
/// Yarım aralık **hata** döner: `start` verilip `end` verilmemişse kullanıcı
/// bütün zamanı istemedi, hattayı unuttu; sessizce tüm zamanı göstermek para
/// tablosunda yanlış toplam üretir.
pub(crate) fn resolve_date_range<'a>(
    start_date: Option<&'a String>,
    end_date: Option<&'a String>,
) -> Result<Option<(&'a String, &'a String)>, String> {
    match (start_date, end_date) {
        (Some(s), Some(e)) => {
            let trimmed_start = s.trim();
            let trimmed_end = e.trim();
            if trimmed_start.is_empty() || trimmed_end.is_empty() {
                return Err("INVALID_ARGUMENT: startDate ve endDate boş olamaz".to_string());
            }
            if trimmed_start > trimmed_end {
                return Err("INVALID_ARGUMENT: startDate endDate'den sonra olamaz".to_string());
            }
            Ok(Some((s, e)))
        }
        (None, None) => Ok(None),
        _ => Err("INVALID_ARGUMENT: startDate ve endDate birlikte verilmelidir".to_string()),
    }
}

/// `get_expenses` çıktısındaki tek satırı DTO'ya çevirir.
fn row_to_expense(r: &sqlx::sqlite::SqliteRow) -> Result<ExpenseDto, String> {
    Ok(ExpenseDto {
        id: r.try_get("id").map_err(|e| e.to_string())?,
        tenant_id: r.try_get("tenant_id").map_err(|e| e.to_string())?,
        category: r.try_get("category").map_err(|e| e.to_string())?,
        amount_cents: r.try_get("amount_cents").map_err(|e| e.to_string())?,
        payment_method: r.try_get("payment_method").map_err(|e| e.to_string())?,
        directory_id: r.try_get("directory_id").map_err(|e| e.to_string())?,
        directory_name: r.try_get("directory_name").map_err(|e| e.to_string())?,
        shift_id: r.try_get("shift_id").map_err(|e| e.to_string())?,
        actor_id: r.try_get("actor_id").map_err(|e| e.to_string())?,
        description: r.try_get("description").map_err(|e| e.to_string())?,
        expense_date: r.try_get("expense_date").map_err(|e| e.to_string())?,
        recurring_id: r.try_get("recurring_id").map_err(|e| e.to_string())?,
        created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
    })
}

/// İşletme gider kayıtlarını listeler.
#[tauri::command]
pub async fn get_expenses(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    category: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ExpenseDto>, String> {
    require_ledger_read(actor_role.as_deref())?;
    let _range = resolve_date_range(start_date.as_ref(), end_date.as_ref())?;

    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let mut query_str = String::from(
        "SELECT e.id, e.tenant_id, e.category, e.amount_cents, e.payment_method,
                e.directory_id, d.name as directory_name, e.shift_id, e.actor_id,
                e.description, e.expense_date, e.recurring_id, e.created_at
         FROM general_expenses e
         LEFT JOIN directories d ON e.directory_id = d.id AND d.tenant_id = e.tenant_id
         WHERE e.tenant_id = ?",
    );

    if category.is_some() {
        query_str.push_str(" AND e.category = ?");
    }
    // Sınırlar gün karşılaştırır: `YYYY-MM-DD 23:59:59` gibi gün sonu metni de aynı güne denk gelir.
    if start_date.is_some() {
        query_str.push_str(&format!(
            " AND {} >= substr(?, 1, 10)",
            expense_service::LOCAL_DAY_SQL
        ));
    }
    if end_date.is_some() {
        query_str.push_str(&format!(
            " AND {} <= substr(?, 1, 10)",
            expense_service::LOCAL_DAY_SQL
        ));
    }
    query_str.push_str(" ORDER BY e.expense_date DESC");

    let mut query = sqlx::query(&query_str).bind(&tid);
    if let Some(ref cat) = category {
        query = query.bind(cat);
    }
    if let Some(ref sd) = start_date {
        query = query.bind(sd);
    }
    if let Some(ref ed) = end_date {
        query = query.bind(ed);
    }

    let rows = query
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(rows.len());
    for r in rows {
        result.push(row_to_expense(&r)?);
    }

    Ok(result)
}

/// Yeni bir işletme gider fişi oluşturur.
/// Eğer nakit (CASH) ise kasa çekmecesinden anında OUT kasa hareketi keser.
#[tauri::command]
pub async fn create_expense(
    actor_role: Option<String>,
    payload: CreateExpensePayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ExpenseDto, String> {
    state.lan_sync.require_local_write()?;
    crate::rbac::require_owner(actor_role.as_deref().unwrap_or_default())?;

    if payload.amount_cents <= 0 {
        return Err("Gider tutarı 0'dan büyük olmalıdır.".to_string());
    }

    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;
    let exp_date = payload
        .expense_date
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;

    let (id, active_shift_id) = insert_expense(
        &mut tx,
        &tid,
        &NewExpense {
            category: &payload.category,
            amount_cents: payload.amount_cents,
            payment_method: &payload.payment_method,
            directory_id: payload.directory_id.as_deref(),
            recurring_id: payload.recurring_id.as_deref(),
            actor_id: &payload.actor_id,
            description: payload.description.as_deref(),
            expense_date: &exp_date,
        },
    )
    .await?;

    // Cari adını sorgula
    let dir_name: Option<String> = if let Some(ref did) = payload.directory_id {
        sqlx::query_scalar("SELECT name FROM directories WHERE id = ? AND tenant_id = ?")
            .bind(did)
            .bind(&tid)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
    } else {
        None
    };

    let (audit_actor_id, audit_actor_role) =
        audit_actor(Some(payload.actor_id.clone()), actor_role);
    let ctx = AuditContext::new(
        tid.clone(),
        audit_actor_id,
        audit_actor_role,
        audit_service::category::FINANS,
        "expense:created",
        id.clone(),
        serde_json::json!({
            "expenseId": id,
            "category": payload.category,
            "amountCents": payload.amount_cents,
            "paymentMethod": payload.payment_method,
            "directoryId": payload.directory_id,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(ExpenseDto {
        id,
        tenant_id: tid,
        category: payload.category,
        amount_cents: payload.amount_cents,
        payment_method: payload.payment_method,
        directory_id: payload.directory_id,
        directory_name: dir_name,
        shift_id: active_shift_id,
        actor_id: payload.actor_id,
        description: payload.description,
        expense_date: exp_date,
        recurring_id: payload.recurring_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Gideri iptal eder. Yanlış girilen gider silinmez, iz bırakarak geri alınır.
#[tauri::command]
pub async fn void_expense(
    expense_id: String,
    reason: String,
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_owner(actor_role.as_deref().unwrap_or_default())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let (amount_cents, category) =
        expense_service::void_expense(&mut tx, &tid, &expense_id, &actor_id, &reason).await?;
    let (audit_actor_id, audit_actor_role) = audit_actor(Some(actor_id), actor_role);
    let ctx = AuditContext::new(
        tid,
        audit_actor_id,
        audit_actor_role,
        audit_service::category::FINANS,
        "expense:voided",
        expense_id,
        serde_json::json!({ "category": category, "amountCents": amount_cents, "reason": reason }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await
}

/// Personel avansı verir; döneminin bordrosundan düşülür. Para çıkışı olduğu için müdür
/// yalnız işletme sahibi onay jetonuyla verebilir.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn record_staff_advance(
    user_id: String,
    period: String,
    amount_cents: i64,
    payment_method: String,
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    approval_token: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let role = actor_role.as_deref().unwrap_or_default();
    crate::rbac::require_staff_admin(role)?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let resource = payroll_gate::resource(
        crate::approval_service::operation::STAFF_ADVANCE,
        &format!("{user_id}:{period}"),
    );
    payroll_gate::authorize_money_out(
        &mut tx,
        &audit_lock,
        &tid,
        &actor_id,
        role,
        crate::approval_service::operation::STAFF_ADVANCE,
        &resource,
        amount_cents,
        approval_token.as_deref(),
    )
    .await?;
    let id = expense_service::record_staff_advance(
        &mut tx,
        &tid,
        &user_id,
        &period,
        amount_cents,
        &payment_method,
        &actor_id,
        &chrono::Utc::now().to_rfc3339(),
    )
    .await?;
    let (audit_actor_id, audit_actor_role) = audit_actor(Some(actor_id), actor_role);
    let ctx = AuditContext::new(
        tid,
        audit_actor_id,
        audit_actor_role,
        audit_service::category::PERSONEL,
        "staff:advance",
        id.clone(),
        serde_json::json!({ "userId": user_id, "period": period, "amountCents": amount_cents }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await?;
    Ok(id)
}
