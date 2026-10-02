//! Net bakiye komutu (Faz 9).
//!
//! Neden ayrı komut: ekran beş hesap türünü ayrı kartlar hâlinde gösterirken
//! toplamı kendisi topluyordu. Toplama motorun (`ledger_service::net_balance`)
//! içinde; bu komut yalnız güvenlik kapısını uygular ve sonucu arayüze taşır.

use crate::db::DbPool;
use crate::ledger_commands::guard::{require_ledger_read, require_ledger_tenant};
use crate::services::ledger_service::{self, AccountClass};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NetBalancePositionDto {
    #[serde(rename = "accountClass")]
    pub account_class: String,
    pub label: String,
    pub badge: String,
    #[serde(rename = "directoryId")]
    pub directory_id: String,
    #[serde(rename = "directoryName")]
    pub directory_name: String,
    #[serde(rename = "receivableCents")]
    pub receivable_cents: i64,
    #[serde(rename = "payableCents")]
    pub payable_cents: i64,
    #[serde(rename = "ownerWithdrawalCents")]
    pub owner_withdrawal_cents: i64,
    #[serde(rename = "signedBalanceCents")]
    pub signed_balance_cents: i64,
    #[serde(rename = "openDebts")]
    pub open_debts: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NetBalanceClassTotalDto {
    #[serde(rename = "accountClass")]
    pub account_class: String,
    pub label: String,
    pub badge: String,
    #[serde(rename = "totalCents")]
    pub total_cents: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NetBalanceDto {
    pub positions: Vec<NetBalancePositionDto>,
    #[serde(rename = "byClass")]
    pub by_class: Vec<NetBalanceClassTotalDto>,
    #[serde(rename = "receivableCents")]
    pub receivable_cents: i64,
    #[serde(rename = "payableCents")]
    pub payable_cents: i64,
    #[serde(rename = "ownerWithdrawalCents")]
    pub owner_withdrawal_cents: i64,
    #[serde(rename = "netBalanceCents")]
    pub net_balance_cents: i64,
}

fn class_key(class: AccountClass) -> &'static str {
    match class {
        AccountClass::Supplier => "SUPPLIER",
        AccountClass::CustomerVeresiye => "CUSTOMER",
        AccountClass::Staff => "STAFF",
        AccountClass::FixedExpense => "FIXED_EXPENSE",
        AccountClass::OwnerPersonal => "OWNER_PERSONAL",
    }
}

/// Beş hesap türünü birleştirilmiş net bakiyeyi döndürür.
#[tauri::command]
pub async fn get_net_balance(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    include_zero: Option<bool>,
    pool: tauri::State<'_, DbPool>,
) -> Result<NetBalanceDto, String> {
    require_ledger_read(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;

    let report = ledger_service::net_balance(&pool, &tid, include_zero.unwrap_or(false)).await?;

    let positions = report
        .positions
        .iter()
        .map(|p| NetBalancePositionDto {
            account_class: class_key(p.account_class).to_string(),
            label: p.account_class.label().to_string(),
            badge: p.account_class.badge().to_string(),
            directory_id: p.directory_id.clone(),
            directory_name: p.directory_name.clone(),
            receivable_cents: p.receivable_cents,
            payable_cents: p.payable_cents,
            owner_withdrawal_cents: p.owner_withdrawal_cents,
            signed_balance_cents: p.signed_balance_cents(),
            open_debts: p.open_debts,
        })
        .collect();

    let by_class = report
        .by_class
        .iter()
        .map(|(class, total)| NetBalanceClassTotalDto {
            account_class: class_key(*class).to_string(),
            label: class.label().to_string(),
            badge: class.badge().to_string(),
            total_cents: *total,
        })
        .collect();

    Ok(NetBalanceDto {
        positions,
        by_class,
        receivable_cents: report.receivable_cents,
        payable_cents: report.payable_cents,
        owner_withdrawal_cents: report.owner_withdrawal_cents,
        net_balance_cents: report.net_balance_cents,
    })
}