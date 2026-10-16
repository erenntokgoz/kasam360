//! Rapor veri modelleri ve DTO'ları.
//!
//! Neden ayrı modül: report_service.rs 500 satır tavanını aştığı için
//! rapor transfer nesneleri ve tarih aralığı bu alt modüle ayrıldı.

/// Bir rapor sorgusunun tarih aralığı.
#[derive(Debug, Clone)]
pub struct ReportRange {
    /// ISO-8601 başlangıç (dahil).
    pub from: String,
    /// ISO-8601 bitiş (dahil).
    pub to: String,
}

impl ReportRange {
    pub fn new(from: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            from: from.into(),
            to: to.into(),
        }
    }

    /// Başlangıçtan bitişe uzunluğu gün cinsinden döndürür (yalnız görüntü için).
    pub fn days(&self) -> i64 {
        let from = chrono::DateTime::parse_from_rfc3339(&self.from)
            .map(|d| d.timestamp())
            .unwrap_or(0);
        let to = chrono::DateTime::parse_from_rfc3339(&self.to)
            .map(|d| d.timestamp())
            .unwrap_or(0);
        let diff = to - from;
        if diff <= 0 {
            1
        } else {
            diff / 86_400 + 1
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct PaymentMethodShareDto {
    pub method: String,
    pub amount_cents: i64,
    /// Yüzde, tam sayı (0-100). Yuvarlama farkı toplamı bozmaz.
    pub share_percent: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct CategoryVolumeDto {
    pub name: String,
    pub quantity: i64,
    pub total_cents: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SalesReportDto {
    pub total_revenue_cents: i64,
    pub total_orders: i64,
    pub average_order_value_cents: i64,
    pub voided_cents: i64,
    pub payment_methods: Vec<PaymentMethodShareDto>,
    pub category_volume: Vec<CategoryVolumeDto>,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ShiftReportRowDto {
    pub id: String,
    pub cashier_id: String,
    pub cashier_name: String,
    pub status: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub expected_amount_cents: i64,
    pub actual_amount_cents: Option<i64>,
    pub difference_cents: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReceiptReportRowDto {
    pub id: String,
    pub table_id: String,
    pub total_cents: i64,
    pub created_at: String,
    pub cashier_id: Option<String>,
    pub status: String,
    pub item_count: i64,
    pub items_total_cents: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AdjustmentRowDto {
    /// `VOID` | `REFUND` | `WASTE`
    pub kind: String,
    pub resource_id: String,
    pub amount_cents: i64,
    pub reason: String,
    /// İşlemi yapan kişi (denetim `actor_id`).
    pub actor_id: String,
    /// Onayı veren kişi. İptalde `approverId`; yoksa `actor_id`.
    pub approver_id: String,
    pub approver_role: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AdjustmentsReportDto {
    pub rows: Vec<AdjustmentRowDto>,
    /// Kaydı bulunmayan hareket türleri; arayüz "kayıt yok" diye bilgilendirir.
    pub kinds_without_records: Vec<String>,
}
