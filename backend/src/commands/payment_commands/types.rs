//! Ödeme DTO'ları ve yardımcı fonksiyonlar.
//!
//! Neden ayrı dosya: payment_commands.rs dosyasının 500 satır tavanını
//! aşmasını önlemek için veri transfer nesneleri bu modüle ayrıldı.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct CartItemDto {
    pub id: String,
    pub product: serde_json::Value,
    pub quantity: i64,
    #[serde(
        rename = "unitPrice",
        alias = "unit_price",
        alias = "priceCents",
        alias = "price_cents",
        default
    )]
    pub unit_price: i64,
    /// Kullanımdan kalkacak: yerine `tax_rate_bp` kullanılacak.
    /// Hesap backend'deneldiği için client'tan okunmaz; geriye uyumluluk için kalır.
    #[serde(rename = "taxRate", alias = "tax_rate", default)]
    pub tax_rate: Option<i64>,
    #[serde(default)]
    pub subtotal: Option<i64>,
    #[serde(rename = "taxAmount", alias = "tax_amount", default)]
    pub tax_amount: Option<i64>,
    #[serde(default)]
    pub total: Option<i64>,
    pub modifiers: Option<serde_json::Value>,
    pub note: Option<String>,
    pub discount: Option<serde_json::Value>,
    #[serde(rename = "paidQuantity", alias = "paid_quantity", default)]
    pub paid_quantity: Option<i64>,
    #[serde(rename = "isComp", alias = "is_comp", default)]
    pub is_comp: Option<bool>,
    #[serde(rename = "courseNumber", alias = "course_number", default)]
    pub course_number: Option<i64>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SplitPaymentDto {
    pub id: Option<String>,
    pub method: String,
    pub amount: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PaymentPayloadDto {
    #[serde(rename = "transactionId")]
    pub transaction_id: String,
    #[serde(rename = "orderId")]
    pub order_id: Option<String>,
    pub timestamp: String,
    pub method: String,
    #[serde(rename = "amountTendered")]
    pub amount_tendered: i64,
    #[serde(rename = "totalAmount")]
    pub total_amount: i64,
    #[serde(rename = "changeAmount")]
    pub change_amount: Option<i64>,
    pub items: Vec<CartItemDto>,
    pub splits: Option<Vec<SplitPaymentDto>>,
    pub notes: Option<String>,
    #[serde(rename = "customerRef")]
    pub customer_ref: Option<String>,
    #[serde(rename = "cashierId")]
    pub cashier_id: Option<String>,
    #[serde(rename = "terminalId")]
    pub terminal_id: Option<String>,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: Option<String>,
    #[serde(rename = "globalDiscount", default)]
    pub global_discount: Option<serde_json::Value>,
    /// Anlık PIN onayından gelen tek kullanımlık jeton. Sunucu hesabında
    /// indirim varsa **zorunludur**; indirim yoksa yok sayılır.
    #[serde(rename = "approvalToken", default)]
    pub approval_token: Option<String>,
    /// İndirim/ikram işleminde onaylayan kişinin kimliği (rapor için).
    #[serde(rename = "actorId", default)]
    pub actor_id: Option<String>,
    /// Veresiye (`method = "VERESIYE"`) seçildiğinde borcun açılacağı müşteri
    /// cari kartı.
    ///
    /// Neden gerekli: `debts.directory_id` `NOT NULL` ve `directories(id)`'ye
    /// yabancı anahtarla bağlı. Veresiye tutarının kime yazılacağı masadan
    /// anlaşılamaz; çağıran bilerek seçer. Gönderilmezse komut hata döner,
    /// tahsilat kaydı oluşmaz.
    #[serde(rename = "debtDirectoryId", alias = "debt_directory_id", default)]
    pub debt_directory_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PaymentResultDto {
    pub success: bool,
    #[serde(rename = "transactionId")]
    pub transaction_id: String,
    #[serde(rename = "fiscalReceiptNo")]
    pub fiscal_receipt_no: Option<String>,
    pub timestamp: String,
    pub message: String,
    #[serde(rename = "cogsTotal")]
    pub cogs_total: Option<i64>,
}

/// Compensation refund payload'ı: ters bir tahsilat kaydı oluşturur.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CompensationRefundPayloadDto {
    /// Orijinal tahsilatın transaction_id'si (txn_ prefix).
    #[serde(rename = "originalTransactionId")]
    pub original_transaction_id: String,
    /// Orijinal sipariş ID'si (opsiyonel; events tablosundan çözülebilir).
    #[serde(rename = "orderId")]
    pub order_id: Option<String>,
    /// Geri iade tutarı (kuruş). AGENTS.md §2.1: 0 kontrolü zorunlu.
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    pub reason: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
    /// Onay token'ı (REFUND scope).
    #[serde(rename = "approvalToken")]
    pub approval_token: Option<String>,
}

/// Ödemenin ait olduğu tenant'ı veritabanından fail-closed çözer.
///
/// Ödeme payload'ı tenant taşımaz; sahiplik siparişin ya da
/// masanın satırında durur. Denetim kaydı bu değerle yazılır;
/// ayrıca `check_idempotency` ve satış olayı da aynı tenant'ı
/// kullanır.
///
/// Neden hata döner: ne sipariş ne masa kiracısını çözerse
/// varsayılan kiracıya düşmek, ödemeyi kimliği belirsiz bir
/// işletmenin defterine yazmaktır. Kiracı çözülemezse
/// tahsilat yazılmaz (fail-closed, AGENTS.md §2.7).
pub(crate) async fn resolve_payment_tenant(
    conn: &mut sqlx::SqliteConnection,
    payload: &PaymentPayloadDto,
) -> Result<String, String> {
    if let Some(order_id) = payload.order_id.as_deref() {
        if let Ok(Some(tenant)) =
            sqlx::query_scalar::<_, String>("SELECT tenant_id FROM orders WHERE id = ?")
                .bind(order_id)
                .fetch_optional(&mut *conn)
                .await
        {
            return Ok(tenant);
        }
    }
    if let Some(table_id) = payload.customer_ref.as_deref() {
        if let Ok(Some(tenant)) =
            sqlx::query_scalar::<_, String>("SELECT tenant_id FROM tables WHERE id = ?")
                .bind(table_id)
                .fetch_optional(&mut *conn)
                .await
        {
            return Ok(tenant);
        }
    }
    Err("UNAUTHORIZED: tenant_id is required".to_string())
}
