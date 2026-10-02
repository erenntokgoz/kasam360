//! Bütçe ve tekrarlayan gider komutları (Faz 9).
//!
//! Neden ayrı dosya: `ledger_commands.rs` 500 satır tavanını aşıyordu; bu
//! komutlar hesap defterinin yeni yüzeyleri ve motorla birebir eşleşiyor.

use crate::db::DbPool;
use crate::ledger_commands::guard::{require_ledger_read, require_ledger_tenant};
use crate::services::budget_service::{self, RecurringDue};
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