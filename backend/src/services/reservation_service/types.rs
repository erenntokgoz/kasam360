//! Rezervasyon veri tipleri ve DTO'ları.
//!
//! Neden ayrı modül: reservation_service.rs 500 satır tavanını aştığı için
//! veri modelleri ve dönüştürücüler bu alt modüle ayrıldı.

use serde::{Deserialize, Serialize};
use sqlx::Row;

/// Hâlâ masayı bloke eden rezervasyon durumları.
pub const OPEN_STATUSES: [&str; 2] = ["ACTIVE", "ARRIVED"];

/// Terminal (kapanmış) rezervasyon durumları. Bunlar masayı artık bloklamaz.
pub(crate) const CLOSED_STATUSES: [&str; 3] = ["SEATED", "CANCELLED", "NO_SHOW"];

pub(crate) const OPEN_FILTER: &str = "status IN ('ACTIVE', 'ARRIVED')";

/// Rezervasyon kaydının arayüze giden görünümü.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReservationDto {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "table_id", alias = "tableId")]
    pub table_id: String,
    #[serde(rename = "table_name", alias = "tableName", default)]
    pub table_name: String,
    pub status: String,
    #[serde(rename = "customer_name", alias = "customerName")]
    pub customer_name: String,
    #[serde(rename = "customer_phone", alias = "customerPhone", default)]
    pub customer_phone: Option<String>,
    #[serde(rename = "party_size", alias = "partySize")]
    pub party_size: i64,
    #[serde(rename = "reserved_at", alias = "reservedAt")]
    pub reserved_at: String,
    #[serde(rename = "created_at", alias = "createdAt")]
    pub created_at: String,
    #[serde(rename = "arrived_at", alias = "arrivedAt", default)]
    pub arrived_at: Option<String>,
    #[serde(rename = "closed_at", alias = "closedAt", default)]
    pub closed_at: Option<String>,
    pub note: Option<String>,
    #[serde(rename = "created_by", alias = "createdBy", default)]
    pub created_by: Option<String>,
    #[serde(rename = "created_by_role", alias = "createdByRole", default)]
    pub created_by_role: Option<String>,
    #[serde(rename = "close_reason", alias = "closeReason", default)]
    pub close_reason: Option<String>,
}

/// Yeni rezervasyon isteği.
#[derive(Debug, Clone)]
pub struct NewReservation {
    pub customer_name: String,
    pub customer_phone: Option<String>,
    pub party_size: i64,
    pub reserved_at: String,
    pub note: Option<String>,
}

pub(crate) fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub(crate) fn trimmed(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

pub(crate) fn normalize_new(input: NewReservation) -> Result<NewReservation, String> {
    let customer_name = trimmed(&input.customer_name)
        .ok_or_else(|| "VALIDATION: müşteri adı zorunludur".to_string())?;
    if input.party_size < 1 || input.party_size > 500 {
        return Err("VALIDATION: kişi sayısı 1 ile 500 arasında olmalıdır".to_string());
    }
    let reserved_at = trimmed(&input.reserved_at).ok_or_else(|| {
        "VALIDATION: randevu saati zorunludur (ISO-8601, örn. 2026-10-02T20:30:00+03:00)"
            .to_string()
    })?;
    Ok(NewReservation {
        customer_name,
        customer_phone: trimmed(input.customer_phone.as_deref().unwrap_or("")),
        party_size: input.party_size,
        reserved_at,
        note: trimmed(input.note.as_deref().unwrap_or("")),
    })
}

pub(crate) const SELECT_COLUMNS: &str =
    "r.id, r.table_id, t.name AS table_name, r.status, r.customer_name, \
     r.customer_phone, r.party_size, r.reserved_at, r.created_at, r.arrived_at, \
     r.closed_at, r.note, r.created_by, r.created_by_role, r.close_reason";

pub(crate) fn row_to_dto(row: &sqlx::sqlite::SqliteRow) -> ReservationDto {
    ReservationDto {
        id: row.try_get("id").unwrap_or_default(),
        table_id: row.try_get("table_id").unwrap_or_default(),
        table_name: row.try_get("table_name").unwrap_or_default(),
        status: row
            .try_get("status")
            .unwrap_or_else(|_| "ACTIVE".to_string()),
        customer_name: row.try_get("customer_name").unwrap_or_default(),
        customer_phone: row.try_get("customer_phone").ok(),
        party_size: row.try_get("party_size").unwrap_or(1),
        reserved_at: row.try_get("reserved_at").unwrap_or_default(),
        created_at: row.try_get("created_at").unwrap_or_default(),
        arrived_at: row.try_get("arrived_at").ok(),
        closed_at: row.try_get("closed_at").ok(),
        note: row.try_get("note").ok(),
        created_by: row.try_get("created_by").ok(),
        created_by_role: row.try_get("created_by_role").ok(),
        close_reason: row.try_get("close_reason").ok(),
    }
}
