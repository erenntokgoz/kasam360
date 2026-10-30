//! Bütçe ve tekrarlayan gider komutları.
//!
//! Neden ayrı dosya: `ledger_commands.rs` 500 satır tavanını aşıyordu; bu
//! komutlar hesap defterinin yeni yüzeyleri ve motorla birebir eşleşiyor.

use crate::db::DbPool;
use crate::ledger_commands::guard::{
    require_ledger_read, require_ledger_tenant, require_ledger_write,
};
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::budget_service::{self, RecurringDue};
use crate::services::lan_sync::WritePool;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BudgetStatusDto {
    pub category: String,
    #[serde(rename = "monthlyLimitCents")]
    pub monthly_limit_cents: i64,
    #[serde(rename = "spentCents")]
    pub spent_cents: i64,
    #[serde(rename = "remainingCents")]
    pub remaining_cents: i64,
    #[serde(rename = "usedPercent")]
    pub used_percent: i64,
    #[serde(rename = "isExceeded")]
    pub is_exceeded: bool,
    #[serde(rename = "isNearLimit")]
    pub is_near_limit: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RecurringDueDto {
    pub id: String,
    pub title: String,
    pub category: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    pub frequency: String,
    #[serde(rename = "dueDay")]
    pub due_day: i64,
    #[serde(rename = "daysInMonth")]
    pub days_in_month: i64,
    #[serde(rename = "isOverdue")]
    pub is_overdue: bool,
    #[serde(rename = "isDueToday")]
    pub is_due_today: bool,
}

impl From<RecurringDue> for RecurringDueDto {
    fn from(value: RecurringDue) -> Self {
        Self {
            id: value.id,
            title: value.title,
            category: value.category,
            amount_cents: value.amount_cents,
            frequency: value.frequency,
            due_day: value.due_day,
            days_in_month: value.days_in_month,
            is_overdue: value.is_overdue,
            is_due_today: value.is_due_today,
        }
    }
}

/// Bütçe limitleri ile gerçekleşen harcamayı karşılaştırır.
#[tauri::command]
pub async fn get_budget_status(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    as_of: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<BudgetStatusDto>, String> {
    require_ledger_read(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;

    let rows = budget_service::budget_status(&pool, &tid, as_of.as_deref()).await?;

    Ok(rows
        .into_iter()
        .map(|s| BudgetStatusDto {
            category: s.category,
            monthly_limit_cents: s.monthly_limit_cents,
            spent_cents: s.spent_cents,
            remaining_cents: s.remaining_cents,
            used_percent: s.used_percent,
            is_exceeded: s.is_exceeded,
            is_near_limit: s.is_near_limit,
        })
        .collect())
}

/// Aktif tekrarlayan giderleri ve ay içindeki vade durumunu listeler.
#[tauri::command]
pub async fn get_recurring_expenses(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    as_of: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<RecurringDueDto>, String> {
    require_ledger_read(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;

    Ok(budget_service::recurring_due(&pool, &tid, as_of.as_deref())
        .await?
        .into_iter()
        .map(RecurringDueDto::from)
        .collect())
}

const CATEGORIES: [&str; 8] = [
    "RENT",
    "UTILITIES",
    "SUPPLIER",
    "STAFF_ADVANCE",
    "TAX",
    "PERSONAL",
    "MAINTENANCE",
    "OTHER",
];

fn require_category(value: &str) -> Result<(), String> {
    if CATEGORIES.contains(&value) {
        return Ok(());
    }
    Err(format!("VALIDATION: geçersiz gider kategorisi: {value}"))
}

async fn audit(
    conn: &mut sqlx::SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor: (&str, &str),
    action: &str,
    resource: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor.0.to_string(),
        actor.1.to_string(),
        category::FINANS,
        action,
        resource.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await.map(|_| ())
}

/// Kategorinin aylık sınırını yazar; aynı kategoride önceki sınırın yerine geçer.
#[tauri::command]
pub async fn set_budget_limit(
    category: String,
    monthly_limit_cents: i64,
    actor_id: String,
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    require_ledger_write(Some(&actor_role))?;
    let tid = require_ledger_tenant(Some(&tenant_id))?;
    require_category(&category)?;
    if monthly_limit_cents <= 0 {
        return Err("VALIDATION: bütçe sıfırdan büyük olmalıdır".to_string());
    }
    let lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    sqlx::query(
        "INSERT INTO budget_limits (id, tenant_id, category, monthly_limit_cents)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(tenant_id, category) DO UPDATE SET monthly_limit_cents = ?4",
    )
    .bind(crate::id_generator::generate_id("bgt"))
    .bind(&tid)
    .bind(&category)
    .bind(monthly_limit_cents)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    audit(
        &mut tx,
        &lock,
        &tid,
        (&actor_id, &actor_role),
        "budget:limit_set",
        &category,
        serde_json::json!({ "monthlyLimitCents": monthly_limit_cents }),
    )
    .await?;
    tx.commit().await
}

/// Kira gibi her ay tekrar eden gideri tanımlar.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_recurring_expense(
    title: String,
    category: String,
    amount_cents: i64,
    due_day: i64,
    actor_id: String,
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    require_ledger_write(Some(&actor_role))?;
    let tid = require_ledger_tenant(Some(&tenant_id))?;
    require_category(&category)?;
    let title = title.trim();
    if title.is_empty() || amount_cents <= 0 || !(1..=31).contains(&due_day) {
        return Err("VALIDATION: başlık, tutar ve ayın günü zorunludur".to_string());
    }
    let id = crate::id_generator::generate_id("rec");
    let lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    sqlx::query(
        "INSERT INTO recurring_expenses (id, tenant_id, title, category, amount_cents, frequency, due_day)
         VALUES (?, ?, ?, ?, ?, 'MONTHLY', ?)",
    )
    .bind(&id)
    .bind(&tid)
    .bind(title)
    .bind(&category)
    .bind(amount_cents)
    .bind(due_day)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    audit(
        &mut tx,
        &lock,
        &tid,
        (&actor_id, &actor_role),
        "recurring:created",
        &id,
        serde_json::json!({ "title": title, "amountCents": amount_cents }),
    )
    .await?;
    tx.commit().await
}

/// Tekrarlayan gideri durdurur. Geçmiş ödemeler silinmez.
#[tauri::command]
pub async fn deactivate_recurring_expense(
    id: String,
    actor_id: String,
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    require_ledger_write(Some(&actor_role))?;
    let tid = require_ledger_tenant(Some(&tenant_id))?;
    let lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let changed =
        sqlx::query("UPDATE recurring_expenses SET is_active = 0 WHERE id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&tid)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    if changed.rows_affected() != 1 {
        return Err("NOT_FOUND: sabit gider bulunamadı".to_string());
    }
    audit(
        &mut tx,
        &lock,
        &tid,
        (&actor_id, &actor_role),
        "recurring:stopped",
        &id,
        serde_json::json!({}),
    )
    .await?;
    tx.commit().await
}
