//! Faz 11 B4 — maaş, bahşiş, KPI ve şüpheli işlem tipleri.
//!
//! Maaş gizliliği kuralı (AGENTS.md §3.2): `PAYROLL_MANAGER_VIEW` yetkisi
//! olmayan çağıran için tutarlar `None` döner. Sıfır **değil** `None` çünkü
//! sıfır "bu çalışan hiç kazanmadı" anlamına gelir; `None` ise "göremedin".
//! Manager ekranında sıfır göstermek patrona yanlış bilgi verirdi.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRule {
    pub user_id: String,
    pub full_name: String,
    pub model: String,
    pub base_salary_cents: i64,
    pub commission_percent: i64,
    pub hourly_rate_cents: i64,
    pub tip_multiplier_percent: i64,
    pub profit_share_percent: i64,
    pub active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRuleInput {
    pub user_id: String,
    pub model: String,
    pub base_salary_cents: i64,
    pub commission_percent: i64,
    pub hourly_rate_cents: i64,
    pub tip_multiplier_percent: i64,
    pub profit_share_percent: i64,
}

/// Tek bir bordro satırının tutarları. `None` = çağıran tutarı göremiyor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollAmounts {
    pub base_cents: i64,
    pub commission_cents: i64,
    pub tip_cents: i64,
    pub hourly_cents: i64,
    pub profit_share_cents: i64,
    pub deduction_cents: i64,
    pub gross_cents: i64,
    pub net_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRun {
    pub id: String,
    pub user_id: String,
    pub full_name: String,
    pub role: String,
    pub period: String,
    pub model: String,
    pub amounts: Option<PayrollAmounts>,
    /// Hesabın dayandığı veri: satış, vardiye saati, havuz tutarı. Denetim
    /// için tutarın yanında "bu nereden geldi" bilgisi de saklanır.
    pub basis_note: String,
    /// Hesaplanamadıysa nedeni. Sessizce 0 yazmak yerine sebep bildirilir.
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipAllocationInput {
    pub user_id: String,
    pub basis_cents: i64,
    pub multiplier_percent: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipAllocation {
    pub user_id: String,
    pub full_name: String,
    pub basis_cents: i64,
    pub multiplier_percent: i64,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipPoolSummary {
    pub period: String,
    pub total_cents: i64,
    pub distributed_cents: i64,
    pub entry_count: i64,
    /// Dağıtılmamış kalan. Sıfır olmalıdır; değilse kuruş kaybı vardır ve
    /// ekranda kırmızı olarak gösterilir.
    pub leftover_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffKpi {
    pub user_id: String,
    pub full_name: String,
    pub order_count: i64,
    pub item_count: i64,
    pub gross_sales_cents: i64,
    pub avg_ticket_cents: i64,
    pub void_count: i64,
    pub top_product: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuspiciousFlag {
    pub user_id: String,
    pub full_name: String,
    pub rule: String,
    pub severity: String,
    pub detail: String,
    pub measured: String,
    pub threshold: String,
}
