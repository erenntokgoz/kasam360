//! Kasa transfer nesneleri (DTO).
//!
//! Neden ayrı dosya: 500 satır sınırını korumak ve kasa DTO'larını
//! tek bir veri sözleşmesi altında toplamak için.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CashMovementDto {
    pub id: String,
    pub shift_id: String,
    pub movement_type: String,
    pub amount_cents: i64,
    pub reason: String,
    pub actor_id: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSummaryDto {
    pub shift_id: String,
    pub total_sales: i64,
    pub total_cash_in: i64,
    pub total_cash_out: i64,
    pub expected_balance: i64,
    pub discrepancy: i64,
    pub actual_closing_balance: Option<i64>,
    #[serde(alias = "cash_sales", default)]
    pub cash_sales: i64,
    #[serde(alias = "card_sales", default)]
    pub card_sales: i64,
    #[serde(alias = "meal_card_sales", default)]
    pub meal_card_sales: i64,
    #[serde(alias = "veresiye_sales", default)]
    pub veresiye_sales: i64,
    #[serde(alias = "total_refunds", default)]
    pub total_refunds: i64,
    #[serde(alias = "total_discounts", default)]
    pub total_discounts: i64,
}

#[derive(Debug, Clone, Default)]
pub struct ShiftCalculation {
    pub total_sales: i64,
    pub cash_sales: i64,
    pub card_sales: i64,
    pub meal_card_sales: i64,
    pub veresiye_sales: i64,
    pub total_discounts: i64,
    pub total_cash_in: i64,
    pub total_cash_out: i64,
    pub total_refunds: i64,
    pub cash_refunds: i64,
    pub expected_balance: i64,
}
