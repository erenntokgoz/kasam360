//! Birleşik rapor merkezinin tek veri katmanı.
//!
//! Neden ayrı servis: rapor okuması iki ayrı ekranda (`OwnerSalesTab`,
//! `ReportsPanel`) üç ayrı komutla dağınık haldeydi ve **üçü de
//! tenant'sızdı**. Yani bir işletme sahibi başka bir işletmenin cirosunu ve
//! fişlerini görebiliyordu. Bu servis tüm rapor sorgularını tek yerde toplar:
//! her sorgu `tenant_id` ile daraltılır, tarih aralığı **zorunludur** ve
//! tutarlar kuruş (`*_cents`) olarak döner.
//!
//! Kaynak gerçekler (uydurma yok):
//! - Ciro: `orders.status = 'PAID'` (şema CHECK'i yalnız bu değeri üretir).
//! - Ödeme yöntemi: `audit_ledger` içindeki `payment:settled_fifo` kayıtları.
//! - Kategori hacmi: `order_items` → `products` → `categories` birleşimi.
//! - İptal: `order:voided` kaydı; onaylayan `approverId` payload'ındadır.
//! - İade/zayi: bu iki hareketin **yazma yolu henüz yok**; rapor boş döner ve
//!   arayüz "kayıt yok" der. Sıfır göstermek uydurma olurdu.

use sqlx::{Row, SqliteConnection};

/// Bir rapor sorgusunun tarih aralığı. Aralık zorunludur: "tüm zamanlar"
/// filtresiz `SELECT` demektir ve büyük tablolarda tüm tenant'ı tarar.
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

/// Satış raporu: ciro, sipariş sayısı, ortalama sepet, iptal toplamı,
/// ödeme yöntemi dağılımı ve kategori hacmi.
pub async fn sales_report(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    range: &ReportRange,
) -> Result<SalesReportDto, String> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(total_cents), 0) AS revenue, COUNT(*) AS order_count \
         FROM orders \
         WHERE tenant_id = ? AND status = 'PAID' AND created_at >= ? AND created_at <= ?",
    )
    .bind(tenant_id)
    .bind(&range.from)
    .bind(&range.to)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Para ve sayaç okumaları `unwrap_or(0)` **olamaz** (AGENTS.md §3.4): SQL
    // hatası sıfıra dönüşünce ciro "0" görünür ve rapor "satış yok" der —
    // hatasız, sessiz ve yanlış. Yanlış rapor, hata mesajından daha tehlikelidir.
    let total_revenue_cents: i64 = row
        .try_get::<Option<i64>, _>("revenue")
        .map_err(|e| e.to_string())?
        .unwrap_or(0);
    let total_orders: i64 = row
        .try_get::<Option<i64>, _>("order_count")
        .map_err(|e| e.to_string())?
        .unwrap_or(0);
    let average_order_value_cents = if total_orders > 0 {
        total_revenue_cents / total_orders
    } else {
        0
    };

    // İptal toplamı: aynı tenant'ın iptal ettiği siparişlerin toplamı. Ciro
    // düşülmez (rapor brüt gösterir), ama yönetici neyin iptal edildiğini görür.
    let voided_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(CAST(json_extract(payload, '$.orderTotalCents') AS INTEGER)), 0) \
         FROM audit_ledger \
         WHERE tenant_id = ? AND action = 'order:voided' AND timestamp >= ? AND timestamp <= ?",
    )
    .bind(tenant_id)
    .bind(&range.from)
    .bind(&range.to)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let payment_methods = payment_method_shares(conn, tenant_id, range).await?;
    let category_volume = category_volumes(conn, tenant_id, range).await?;

    Ok(SalesReportDto {
        total_revenue_cents,
        total_orders,
        average_order_value_cents,
        voided_cents,
        payment_methods,
        category_volume,
        from: range.from.clone(),
        to: range.to.clone(),
    })
}

async fn payment_method_shares(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    range: &ReportRange,
) -> Result<Vec<PaymentMethodShareDto>, String> {
    let rows = sqlx::query(
        "SELECT COALESCE(json_extract(payload, '$.method'), 'Bilinmiyor') AS method, \
                COALESCE(SUM(CAST(json_extract(payload, '$.totalAmount') AS INTEGER)), 0) AS amount \
         FROM audit_ledger \
         WHERE tenant_id = ? AND action = 'payment:settled_fifo' \
           AND timestamp >= ? AND timestamp <= ? \
         GROUP BY method ORDER BY amount DESC",
    )
    .bind(tenant_id)
    .bind(&range.from)
    .bind(&range.to)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Ödeme yöntemi tutarları para cinsinden toplamdır: hata sıfıra dönmez
    // (AGENTS.md §3.4), yoksa ciro "hiç ödeme alınmamış" gibi görünür.
    let mut sum: i64 = 0;
    for row in rows.iter() {
        let amount: i64 = row
            .try_get::<Option<i64>, _>("amount")
            .map_err(|e| e.to_string())?
            .unwrap_or(0);
        sum += amount;
    }

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let amount: i64 = row
            .try_get::<Option<i64>, _>("amount")
            .map_err(|e| e.to_string())?
            .unwrap_or(0);
        out.push(PaymentMethodShareDto {
            method: row
                .try_get::<Option<String>, _>("method")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            amount_cents: amount,
            share_percent: if sum > 0 {
                (amount * 100) / sum
            } else {
                0
            },
        });
    }
    Ok(out)
}

async fn category_volumes(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    range: &ReportRange,
) -> Result<Vec<CategoryVolumeDto>, String> {
    let rows = sqlx::query(
        "SELECT COALESCE(c.name, 'Kategorisiz') AS category_name, \
                COALESCE(SUM(oi.quantity), 0) AS qty, \
                COALESCE(SUM(oi.total_cents), 0) AS total \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id \
         JOIN products p ON p.id = oi.product_id AND p.tenant_id = ? \
         LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id = ? \
         WHERE o.tenant_id = ? AND o.status = 'PAID' \
           AND o.created_at >= ? AND o.created_at <= ? \
         GROUP BY c.id, COALESCE(c.name, 'Kategorisiz') ORDER BY qty DESC",
    )
    .bind(tenant_id)
    .bind(tenant_id)
    .bind(tenant_id)
    .bind(&range.from)
    .bind(&range.to)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Kategori adı, miktar ve tutar: satır bozulursa hata yükselir.
    // Sessiz sıfır, "bu kategoride satış yok" ile "okuma başarısız" ayrımını
    // yok eder (AGENTS.md §3.4).
    let mut out = Vec::with_capacity(rows.len());
    for r in rows.iter() {
        out.push(CategoryVolumeDto {
            name: r.try_get::<Option<String>, _>("category_name")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            quantity: r
                .try_get::<Option<i64>, _>("qty")
                .map_err(|e| e.to_string())?
                .unwrap_or(0),
            total_cents: r
                .try_get::<Option<i64>, _>("total")
                .map_err(|e| e.to_string())?
                .unwrap_or(0),
        });
    }
    Ok(out)
}

/// Vardiya geçmişi. Kasiyer adı `users` ile birleşimle gelir (N+1 yok).
pub async fn shift_report(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    range: &ReportRange,
    limit: i64,
) -> Result<Vec<ShiftReportRowDto>, String> {
    let rows = sqlx::query(
        "SELECT s.id, s.cashier_id, COALESCE(u.name, s.cashier_id) AS cashier_name, s.status, \
                s.opened_at, s.closed_at, s.expected_amount_cents, s.actual_amount_cents, \
                s.difference_cents \
         FROM shifts s \
         LEFT JOIN users u ON u.id = s.cashier_id AND u.tenant_id = s.tenant_id \
         WHERE s.tenant_id = ? AND s.opened_at >= ? \
           AND (s.closed_at IS NULL OR s.closed_at <= ?) \
         ORDER BY s.opened_at DESC LIMIT ?",
    )
    .bind(tenant_id)
    .bind(&range.from)
    .bind(&range.to)
    .bind(limit)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Vardiya satırları para alanı içerir: `expected_amount_cents` zorunlu,
    // `actual_amount_cents` ve `difference_cents` sayım girmeden `NULL` olabilir.
    // Üçü de hata yükseltir; `NULL` yalnız kolon adı doğruysa meşru (AGENTS.md §3.4).
    let mut out = Vec::with_capacity(rows.len());
    for r in rows.iter() {
        out.push(ShiftReportRowDto {
            id: r.try_get::<Option<String>, _>("id")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            cashier_id: r
                .try_get::<Option<String>, _>("cashier_id")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            cashier_name: r
                .try_get::<Option<String>, _>("cashier_name")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            status: r
                .try_get::<Option<String>, _>("status")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            opened_at: r
                .try_get::<Option<String>, _>("opened_at")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            closed_at: r
                .try_get::<Option<String>, _>("closed_at")
                .map_err(|e| e.to_string())?,
            expected_amount_cents: r
                .try_get::<Option<i64>, _>("expected_amount_cents")
                .map_err(|e| e.to_string())?
                .unwrap_or(0),
            actual_amount_cents: r
                .try_get::<Option<i64>, _>("actual_amount_cents")
                .map_err(|e| e.to_string())?,
            difference_cents: r
                .try_get::<Option<i64>, _>("difference_cents")
                .map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

/// Fiş geçmişi. Kalem sayısı ve kalem toplamı **tek** sorguda gelir; eski
/// sürüm fiş başına ayrı `order_items` sorgusu atıyordu (N+1).
pub async fn receipts_report(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    range: &ReportRange,
    limit: i64,
) -> Result<Vec<ReceiptReportRowDto>, String> {
    let rows = sqlx::query(
        "SELECT o.id, o.table_id, o.total_cents, o.created_at, o.cashier_id, o.status, \
                COUNT(oi.id) AS item_count, COALESCE(SUM(oi.total_cents), 0) AS items_total_cents \
         FROM orders o \
         LEFT JOIN order_items oi ON oi.order_id = o.id \
         WHERE o.tenant_id = ? AND o.status IN ('PAID', 'VOID') \
           AND o.created_at >= ? AND o.created_at <= ? \
         GROUP BY o.id ORDER BY o.created_at DESC LIMIT ?",
    )
    .bind(tenant_id)
    .bind(&range.from)
    .bind(&range.to)
    .bind(limit)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Fiş satırları tutar ve sayaç taşır: ikisi de hata yükseltir
    // (AGENTS.md §3.4). Sessiz sıfır, "fişte kalem yok" ile "okuma
    // başarısız" durumlarını birbirine karıştırır.
    let mut out = Vec::with_capacity(rows.len());
    for r in rows.iter() {
        out.push(ReceiptReportRowDto {
            id: r.try_get::<Option<String>, _>("id")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            table_id: r
                .try_get::<Option<String>, _>("table_id")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            total_cents: r
                .try_get::<Option<i64>, _>("total_cents")
                .map_err(|e| e.to_string())?
                .unwrap_or(0),
            created_at: r
                .try_get::<Option<String>, _>("created_at")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            cashier_id: r
                .try_get::<Option<String>, _>("cashier_id")
                .map_err(|e| e.to_string())?,
            status: r
                .try_get::<Option<String>, _>("status")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            item_count: r
                .try_get::<Option<i64>, _>("item_count")
                .map_err(|e| e.to_string())?
                .unwrap_or(0),
            items_total_cents: r
                .try_get::<Option<i64>, _>("items_total_cents")
                .map_err(|e| e.to_string())?
                .unwrap_or(0),
        });
    }
    Ok(out)
}

/// İptal / iade / zayi hareketleri ve **kim onayladı** bilgisi.
///
/// İade (`payment:refund`) ve zayi (`stock:waste`) yazma yolları henüz yok;
/// bulunamadığında satır üretmek yerine `kinds_without_records` listesinde
/// bildirilir. Böylece arayüz "kayıt yok" der, sıfır tutar uydurmaz.
pub async fn adjustments_report(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    range: &ReportRange,
) -> Result<AdjustmentsReportDto, String> {
    let rows = sqlx::query(
        "SELECT action, resource_id, actor_id, actor_role, timestamp, payload \
         FROM audit_ledger \
         WHERE tenant_id = ? AND action IN ('order:voided', 'payment:refund', 'stock:waste') \
           AND timestamp >= ? AND timestamp <= ? \
         ORDER BY timestamp DESC",
    )
    .bind(tenant_id)
    .bind(&range.from)
    .bind(&range.to)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    let mut seen_void = false;
    let mut seen_refund = false;
    let mut seen_waste = false;

    for row in rows {
        let action: String = row
            .try_get::<Option<String>, _>("action")
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let payload_text: String = row
            .try_get::<Option<String>, _>("payload")
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let payload: serde_json::Value =
            serde_json::from_str(&payload_text).unwrap_or(serde_json::Value::Null);

        let (kind, amount_key) = match action.as_str() {
            "order:voided" => {
                seen_void = true;
                ("VOID", "orderTotalCents")
            }
            "payment:refund" => {
                seen_refund = true;
                ("REFUND", "amountCents")
            }
            _ => {
                seen_waste = true;
                ("WASTE", "amountCents")
            }
        };

        // Tutar payload içinden gelir. Anahtar eksikse hata yükselir: `0`
        // yazmak "bu hareket 0 tutarındı" uydurması olurdu. `refund` ve
        // `waste` yazma yolları henüz olmadığı için payload anahtarı yoksa
        // rapor hata döner; ekran "bu hareket için kayıt yok" gösterir.
        let amount_cents = payload
            .get(amount_key)
            .and_then(|v| v.as_i64())
            .ok_or_else(|| format!("{} kaydında '{}' tutarı okunamadı.", kind, amount_key))?;
        let approver_id = payload
            .get("approverId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let actor_id: String = row
            .try_get::<Option<String>, _>("actor_id")
            .map_err(|e| e.to_string())?
            .unwrap_or_default();

        out.push(AdjustmentRowDto {
            kind: kind.to_string(),
            resource_id: row
                .try_get::<Option<String>, _>("resource_id")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            amount_cents,
            reason: payload
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            actor_id: actor_id.clone(),
            approver_id: if approver_id.is_empty() {
                actor_id
            } else {
                approver_id
            },
            approver_role: payload
                .get("approverRole")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            occurred_at: row
                .try_get::<Option<String>, _>("timestamp")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
        });
    }

    let mut kinds_without_records = Vec::new();
    if !seen_void {
        kinds_without_records.push("VOID".to_string());
    }
    if !seen_refund {
        kinds_without_records.push("REFUND".to_string());
    }
    if !seen_waste {
        kinds_without_records.push("WASTE".to_string());
    }

    Ok(AdjustmentsReportDto {
        rows: out,
        kinds_without_records,
    })
}

#[cfg(test)]
#[path = "report_service_tests.rs"]
mod tests;