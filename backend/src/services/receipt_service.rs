//! Fiş veri katmanı (Faz 7).
//!
//! Neden ayrı servis: Faz 6'daki şube servisinin izi. Komut katmanı RBAC, tenant
//! çözümlemesi ve denetim kaydıyla ilgilenir; SQL kuralları burada tek yerde
//! durur ve bellek içi SQLite ile doğrudan test edilir.
//!
//! # Tek finansal gerçeklik
//!
//! Faz 7 öncesi fiş **iki paralel kaynaktan** türetiliyordu: `orders` tablosundaki
//! `PAID` satırları ve `events` tablosundaki `SALE_SETTLED` kayıtları. Aynı satış
//! iki listede iki kez görünebiliyor, alt toplam/KDV `total * 100 / 110` gibi
//! **uydurma** bir formülle dolduruluyordu ve ödeme bulunamadığında yöntem "Nakit"
//! varsayılıyordu.
//!
//! Artık fişin tek kaynağı **tahsilat kaydıdır**: `events` tablosundaki
//! `aggregate_type = 'SALE'` / `event_type = 'SALE_SETTLED'` satırı. Sipariş
//! satırı yalnız **zenginleştirme** için okunur (masa, kasiyer, kalemler); fişin
//! varlığı siparişten değil tahsilattan gelir.
//!
//! # Değişmezler
//!
//! - **Kiracı izolasyonu:** her sorgu `tenant_id` ile daraltılır.
//! - **Sessiz uydurma yok:** toplam/alt toplam/KDV yalnız kayıtlı değerlerden
//!   okunur. Kalem yoksa `subtotal_cents` ve `tax_total_cents` **0**'dır ve
//!   `has_items` yanlıştır; arayüz bu durumu açıkça gösterir.
//! - **Geçmiş değişmez:** bu servis yalnız `SELECT` yapar. Fiş satırı yoktur ve
//!   üretilmez; finansal geçmiş `events` + `audit_ledger` içinde yaşar ve
//!   denetim defteri trigger'larıyla değiştirilemez.

use sqlx::Row;

use crate::commands::{ReceiptDto, ReceiptItemDto};

/// Bir fişin sahibi olabileceği tek hareket: tahsilat kaydı.
const SALE_EVENT_FILTER: &str =
    "aggregate_type = 'SALE' AND event_type = 'SALE_SETTLED'";

/// Ödeme yöntemini rapor/ekran diliyle döndürür.
///
/// Neden eşleme: `method` alanı enum'dur (`CASH`, `CREDIT_CARD`, `SPLIT`).
/// Bilinmeyen veya boş bir değerde **"Nakit" uydurmak** yanlış finansal gerçek
/// üretirdi; bu yüzden değer neyse o yazılır, boşsa `"Belirtilmemiş"`.
fn payment_method_label(raw: Option<&str>) -> String {
    match raw.unwrap_or("").trim().to_uppercase().as_str() {
        "CASH" => "Nakit".to_string(),
        "CREDIT_CARD" => "Kredi Kartı".to_string(),
        "SPLIT" => "Parçalı".to_string(),
        "DEBT" | "VERESIYE" => "Veresiye".to_string(),
        "" => "Belirtilmemiş".to_string(),
        other => other.to_string(),
    }
}

fn payload_string(payload: &serde_json::Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn payload_i64(payload: &serde_json::Value, key: &str) -> Option<i64> {
    payload.get(key).and_then(|value| value.as_i64())
}

/// Fişin mali fiş numarası: tahsilat kaydının `transactionId`'si türetilir.
///
/// Neden ayrı fonksiyon: `process_payment` aynı biçimi `PaymentResultDto` içinde
/// döndürüyor. Numara **veritabanından** türetilir; istemci fiş numarası
/// gönderemez, böylece fiş numarası değiştirilemez.
pub fn fiscal_receipt_no(transaction_id: &str) -> Option<String> {
    let prefix: String = transaction_id.chars().take(6).collect();
    if prefix.is_empty() {
        None
    } else {
        Some(format!("FISC-{}", prefix))
    }
}

/// Tenant'ın fişlerini tek kaynaktan (tahsilat kayıtları) listeler.
pub async fn list(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    limit: i64,
) -> Result<Vec<ReceiptDto>, String> {
    let sql = format!(
        "SELECT event_id, aggregate_id, payload, created_at \
         FROM events WHERE tenant_id = ? AND {} \
         ORDER BY created_at DESC LIMIT ?",
        SALE_EVENT_FILTER
    );
    let rows = sqlx::query(&sql)
        .bind(tenant_id)
        .bind(limit)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut receipts = Vec::with_capacity(rows.len());
    for row in rows {
        let payload_raw: String = row.try_get("payload").unwrap_or_default();
        let aggregate_id: String = row.try_get("aggregate_id").unwrap_or_default();
        let created_at: String = row.try_get("created_at").unwrap_or_default();
        let payload: serde_json::Value =
            serde_json::from_str(&payload_raw).unwrap_or(serde_json::Value::Null);
        receipts.push(build_receipt(
            conn,
            tenant_id,
            &aggregate_id,
            &payload,
            &created_at,
        )
        .await?);
    }
    Ok(receipts)
}

/// Tek bir fişi **kimliğiyle** getirir; bulunamazsa `None`.
///
/// `receipt_id` tahsilat kimliğidir (`transactionId`). Fiş numarası (`FISC-…`)
/// da kabul edilir: kullanıcı ekranda gördüğü numarayı arayabilir. Numara
/// veritabanında **ayrı bir alan olarak saklanmaz**, tahsilat kimliğinden
/// türetilir; bu yüzden arama `aggregate_id` önekiyle yapılır.
pub async fn find(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    receipt_id: &str,
) -> Result<Option<ReceiptDto>, String> {
    let trimmed = receipt_id.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    // `FISC-txn_ab` → hem tam numarayı hem de türetilmiş öneki (`txn_ab`) dene.
    let bare = trimmed.strip_prefix("FISC-").unwrap_or(trimmed);
    let like_pattern = format!("{}%", bare);

    let sql = format!(
        "SELECT event_id, aggregate_id, payload, created_at \
         FROM events WHERE tenant_id = ? AND {} \
         AND (aggregate_id = ? OR aggregate_id LIKE ?) \
         ORDER BY created_at DESC LIMIT 1",
        SALE_EVENT_FILTER
    );
    let row = sqlx::query(&sql)
        .bind(tenant_id)
        .bind(bare)
        .bind(like_pattern)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let Some(row) = row else { return Ok(None) };
    let aggregate_id: String = row.try_get("aggregate_id").unwrap_or_default();
    let created_at: String = row.try_get("created_at").unwrap_or_default();
    let payload_raw: String = row.try_get("payload").unwrap_or_default();
    let payload: serde_json::Value =
        serde_json::from_str(&payload_raw).unwrap_or(serde_json::Value::Null);
    Ok(Some(
        build_receipt(conn, tenant_id, &aggregate_id, &payload, &created_at).await?,
    ))
}

/// Bir tahsilat kaydının bu tenant için fişinin var olup olmadığını söyler.
///
/// `print_receipt` bu kontrolü yapar: **yalnız kayıtlı ve bu tenant'a ait**
/// tahsilat için fiş basılır. Böylece istenen herhangi bir JSON yazdırılamaz.
pub async fn exists(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    transaction_id: &str,
) -> Result<bool, String> {
    let sql = format!(
        "SELECT 1 FROM events WHERE tenant_id = ? AND {} AND aggregate_id = ? LIMIT 1",
        SALE_EVENT_FILTER
    );
    let found = sqlx::query(&sql)
        .bind(tenant_id)
        .bind(transaction_id.trim())
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(found.is_some())
}

/// Tek tahsilat kaydından fiş DTO'su kurar.
///
/// Sipariş satırı **yalnız zenginlik** sağlar (masa adı, kasiyer, kalemler).
/// Sipariş bulunamazsa fiş yine de üretilir: tahsilat gerçekleşmiştir, ürün
/// kalemleri POS tarafında saklanmamış olabilir.
async fn build_receipt(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    transaction_id: &str,
    payload: &serde_json::Value,
    created_at: &str,
) -> Result<ReceiptDto, String> {
    let order_id = payload_string(payload, "orderId");
    let total_cents = payload_i64(payload, "totalAmount").unwrap_or(0);

    let mut table_display = order_id.clone().unwrap_or_default();
    let mut cashier_id = payload_string(payload, "cashierId");
    let mut notes = payload_string(payload, "notes");

    if let Some(order) = order_id.as_deref() {
        if let Some(row) = sqlx::query(
            "SELECT table_id, cashier_id, notes FROM orders WHERE tenant_id = ? AND id = ? LIMIT 1",
        )
        .bind(tenant_id)
        .bind(order)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        {
            let raw_table_id: String = row.try_get("table_id").unwrap_or_default();
            let table_name: Option<String> =
                sqlx::query_scalar("SELECT name FROM tables WHERE tenant_id = ? AND id = ? LIMIT 1")
                    .bind(tenant_id)
                    .bind(&raw_table_id)
                    .fetch_optional(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?
                    .flatten();
            table_display = table_name.unwrap_or(raw_table_id);
            if cashier_id.is_none() {
                cashier_id = row.try_get("cashier_id").ok().flatten();
            }
            if notes.is_none() {
                notes = row.try_get("notes").ok().flatten();
            }
        }
    }

    let items = load_items(conn, tenant_id, order_id.as_deref()).await?;

    // Alt toplam ve KDV yalnız **kayıtlı** kalemlerden toplanır. Kalem yoksa
    // uydurma oran uygulanmaz; `has_items` arayüzün durumu bildirmesini sağlar.
    let has_items = !items.is_empty();
    let subtotal_cents: i64 = items.iter().map(|item| item.subtotal_cents).sum();
    let tax_total_cents: i64 = items.iter().map(|item| item.tax_amount_cents).sum();

    let cashier_name = match cashier_id.as_deref() {
        Some(id) if !id.is_empty() => sqlx::query_scalar::<_, String>(
            "SELECT name FROM users WHERE tenant_id = ? AND id = ? LIMIT 1",
        )
        .bind(tenant_id)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?,
        _ => None,
    };

    Ok(ReceiptDto {
        id: transaction_id.to_string(),
        order_id,
        fiscal_receipt_no: fiscal_receipt_no(transaction_id),
        transaction_id: transaction_id.to_string(),
        table_id: table_display,
        total_cents,
        subtotal_cents,
        tax_total_cents,
        discount_cents: payload_i64(payload, "discountAmount").unwrap_or(0),
        created_at: if payload_string(payload, "timestamp").is_some() {
            payload_string(payload, "timestamp").unwrap_or_default()
        } else {
            created_at.to_string()
        },
        cashier_id,
        cashier_name,
        payment_method: payment_method_label(payload.get("method").and_then(|m| m.as_str())),
        notes,
        items,
        tendered_cents: payload_i64(payload, "amountTendered"),
        change_cents: payload_i64(payload, "changeAmount"),
        has_items,
    })
}

/// Sipariş kalemlerini tenant'ın kendi ürünleriyle eşleştirerek okur.
async fn load_items(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    order_id: Option<&str>,
) -> Result<Vec<ReceiptItemDto>, String> {
    let Some(order_id) = order_id else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query(
        "SELECT oi.id, oi.product_id, COALESCE(p.name, oi.product_id) AS product_name, \
                oi.quantity, oi.unit_price_cents, oi.tax_rate, oi.subtotal_cents, \
                oi.tax_amount_cents, oi.total_cents, oi.modifiers, oi.notes \
         FROM order_items oi \
         LEFT JOIN products p ON p.tenant_id = ? AND p.id = oi.product_id \
         WHERE oi.order_id = ? \
         ORDER BY oi.id",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let modifiers_raw: Option<String> = row.try_get("modifiers").ok();
        let modifiers = modifiers_raw
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default();
        items.push(ReceiptItemDto {
            id: row.try_get("id").unwrap_or_default(),
            product_id: row.try_get("product_id").unwrap_or_default(),
            product_name: row.try_get("product_name").unwrap_or_default(),
            quantity: row.try_get("quantity").unwrap_or(1),
            unit_price_cents: row.try_get("unit_price_cents").unwrap_or(0),
            tax_rate: row.try_get("tax_rate").unwrap_or(0.0),
            subtotal_cents: row.try_get("subtotal_cents").unwrap_or(0),
            tax_amount_cents: row.try_get("tax_amount_cents").unwrap_or(0),
            total_cents: row.try_get("total_cents").unwrap_or(0),
            modifiers,
            notes: row.try_get("notes").ok().flatten(),
        });
    }
    Ok(items)
}

/// Hesap Defteri'nin finansal hareket listesi (Faz 7).
///
/// Hareket türleri:
/// - `SALE_PAYMENT`: tahsilat → **fiş vardır** (`receipt_id` = tahsilat kimliği)
/// - `CASH_MOVEMENT`: kasa giriş/çıkışı → fiş yoktur
/// - `DEBT_PAYMENT`: cari borç tahsilatı → fiş yoktur
///
/// Neden tek komut: Hesap Defteri hareketleri **tek listede** gösterir; fiş olan
/// satırda "Fişi Görüntüle", olmayan satırda açık "Fiş yok" durumu görünür.
/// Böylece fiş, ayrı bir ekranın konusu olmaktan çıkıp harekete bağlı bir
/// bağlantıya dönüşür.
pub async fn list_financial_movements(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
    limit: i64,
) -> Result<Vec<FinancialMovement>, String> {
    let sales_sql = format!(
        "SELECT aggregate_id AS movement_id, payload, created_at \
         FROM events WHERE tenant_id = ? AND {} AND created_at >= ? AND created_at <= ? \
         ORDER BY created_at DESC LIMIT ?",
        SALE_EVENT_FILTER
    );
    let sales = sqlx::query(&sales_sql)
        .bind(tenant_id)
        .bind(from)
        .bind(to)
        .bind(limit)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let cash_sql = "SELECT id, movement_type, amount_cents, reason, created_at \
         FROM cash_movements WHERE tenant_id = ? AND created_at >= ? AND created_at <= ? \
         ORDER BY created_at DESC LIMIT ?";
    let cash = sqlx::query(cash_sql)
        .bind(tenant_id)
        .bind(from)
        .bind(to)
        .bind(limit)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let debt_sql = "SELECT dp.id, dp.amount_cents, dp.payment_method, d.description, dp.created_at \
         FROM debt_payments dp \
         JOIN debts d ON d.id = dp.debt_id AND d.tenant_id = dp.tenant_id \
         WHERE dp.tenant_id = ? AND dp.created_at >= ? AND dp.created_at <= ? \
         ORDER BY dp.created_at DESC LIMIT ?";
    let debt = sqlx::query(debt_sql)
        .bind(tenant_id)
        .bind(from)
        .bind(to)
        .bind(limit)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut movements: Vec<FinancialMovement> = Vec::new();

    for row in &sales {
        let movement_id: String = row.try_get("movement_id").unwrap_or_default();
        let created_at: String = row.try_get("created_at").unwrap_or_default();
        let payload_raw: String = row.try_get("payload").unwrap_or_default();
        let payload: serde_json::Value =
            serde_json::from_str(&payload_raw).unwrap_or(serde_json::Value::Null);
        movements.push(FinancialMovement {
            movement_id: movement_id.clone(),
            tenant_id: tenant_id.to_string(),
            movement_type: MOVEMENT_SALE_PAYMENT.to_string(),
            amount_cents: payload_i64(&payload, "totalAmount").unwrap_or(0),
            payment_method: payment_method_label(payload.get("method").and_then(|m| m.as_str())),
            description: payload_string(&payload, "customerRef"),
            created_at,
            // Tahsilat kaydı varsa fiş de vardır: ikisi aynı finansal gerçeğin
            // iki görünümüdür, ayrı kayıt değil.
            receipt_id: Some(movement_id.clone()),
            fiscal_receipt_no: fiscal_receipt_no(&movement_id),
        });
    }

    for row in &cash {
        let movement_type_raw: String = row.try_get("movement_type").unwrap_or_default();
        let sign = if movement_type_raw.eq_ignore_ascii_case("OUT") {
            -1
        } else {
            1
        };
        movements.push(FinancialMovement {
            movement_id: row.try_get("id").unwrap_or_default(),
            tenant_id: tenant_id.to_string(),
            movement_type: MOVEMENT_CASH_MOVEMENT.to_string(),
            amount_cents: sign * row.try_get("amount_cents").unwrap_or(0),
            payment_method: "Nakit".to_string(),
            description: Some(row.try_get("reason").unwrap_or_default()),
            created_at: row.try_get("created_at").unwrap_or_default(),
            receipt_id: None,
            fiscal_receipt_no: None,
        });
    }

    for row in &debt {
        movements.push(FinancialMovement {
            movement_id: row.try_get("id").unwrap_or_default(),
            tenant_id: tenant_id.to_string(),
            movement_type: MOVEMENT_DEBT_PAYMENT.to_string(),
            amount_cents: row.try_get("amount_cents").unwrap_or(0),
            payment_method: payment_method_label(
                row.try_get::<String, _>("payment_method").ok().as_deref(),
            ),
            description: row.try_get("description").ok().flatten(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            receipt_id: None,
            fiscal_receipt_no: None,
        });
    }

    // En yeni hareket en üstte: türler arası karışık liste tek sıralama ister.
    movements.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    movements.truncate(limit.max(0) as usize);
    Ok(movements)
}

pub const MOVEMENT_SALE_PAYMENT: &str = "SALE_PAYMENT";
pub const MOVEMENT_CASH_MOVEMENT: &str = "CASH_MOVEMENT";
pub const MOVEMENT_DEBT_PAYMENT: &str = "DEBT_PAYMENT";

/// Hesap Defteri satırı: her finansal hareketin fiş bağlantısı taşınır.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinancialMovement {
    pub movement_id: String,
    pub tenant_id: String,
    pub movement_type: String,
    pub amount_cents: i64,
    pub payment_method: String,
    pub description: Option<String>,
    pub created_at: String,
    /// Fiş varsa tahsilat kimliği; yoksa `None` (arayüz "Fiş yok" der).
    pub receipt_id: Option<String>,
    pub fiscal_receipt_no: Option<String>,
}

impl FinancialMovement {
    /// Tauri'ye giden DTO'ya çevirir (alan adları birebir aynıdır).
    pub fn to_dto(&self) -> crate::commands::FinancialMovementDto {
        crate::commands::FinancialMovementDto {
            movement_id: self.movement_id.clone(),
            tenant_id: self.tenant_id.clone(),
            movement_type: self.movement_type.clone(),
            amount_cents: self.amount_cents,
            payment_method: self.payment_method.clone(),
            description: self.description.clone(),
            created_at: self.created_at.clone(),
            receipt_id: self.receipt_id.clone(),
            fiscal_receipt_no: self.fiscal_receipt_no.clone(),
        }
    }
}

#[cfg(test)]
#[path = "receipt_service_tests.rs"]
mod tests;