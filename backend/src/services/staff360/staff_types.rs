//! Faz 11 B3 — personel tipleri.
//!
//! Not kuralı: tarih alanları bilinmiyorsa `null` gelir, boş string `""` değil.
//! Boş string ile `null` karışırsa ekranda "bilinmiyor" ile "0" ayrımı kaybolur.

use serde::{Deserialize, Serialize};

/// Personel profili. `base_salary_cents` yalnız `OWNER` ekranında gösterilir;
/// liste servisi bu değeri taşır, yetki kapısı çağrıdan önce uygulanır.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffProfile {
    pub user_id: String,
    pub full_name: String,
    pub role: String,
    pub base_salary_cents: i64,
    pub commission_percent: i64,
    pub birth_date: Option<String>,
    pub hire_date: Option<String>,
    pub phone: Option<String>,
    pub national_id: Option<String>,
    pub address: Option<String>,
    pub emergency_contact: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffProfileInput {
    pub user_id: String,
    pub full_name: String,
    pub base_salary_cents: i64,
    pub commission_percent: i64,
    pub birth_date: Option<String>,
    pub hire_date: Option<String>,
    pub phone: Option<String>,
    pub national_id: Option<String>,
    pub address: Option<String>,
    pub emergency_contact: Option<String>,
    pub notes: Option<String>,
}

/// Vardiya planı. `realized_shift_id` dolu ise plan gerçekleşmiştir.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftPlan {
    pub id: String,
    pub user_id: String,
    pub user_name: String,
    pub plan_date: String,
    pub start_time: String,
    pub end_time: String,
    pub planned_break_minutes: i64,
    pub role_required: String,
    pub station: Option<String>,
    pub status: String,
    pub realized_shift_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftPlanInput {
    pub user_id: String,
    pub plan_date: String,
    pub start_time: String,
    pub end_time: String,
    pub planned_break_minutes: i64,
    pub role_required: String,
    pub station: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveRequest {
    pub id: String,
    pub user_id: String,
    pub kind: String,
    pub start_date: String,
    pub end_date: String,
    pub reason: Option<String>,
    pub status: String,
    pub approver_id: Option<String>,
    pub decided_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveInput {
    pub user_id: String,
    pub kind: String,
    pub start_date: String,
    pub end_date: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustodyRecord {
    pub id: String,
    pub user_id: String,
    pub item_name: String,
    pub quantity: i64,
    pub status: String,
    pub delivered_at: String,
    pub returned_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    pub id: String,
    pub user_id: String,
    pub kind: String,
    pub severity: String,
    pub occurred_at: String,
    pub summary: String,
    pub details: Option<String>,
    pub resolution: Option<String>,
    pub status: String,
    pub recorded_by: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentInput {
    pub user_id: String,
    pub kind: String,
    pub severity: String,
    pub occurred_at: String,
    pub summary: String,
    pub details: Option<String>,
}