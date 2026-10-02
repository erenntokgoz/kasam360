//! Fiş komutları (fiş listesi, fiş detayı, finansal hareket, termal baskı)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};


#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReceiptItemDto {
    pub id: String,
    #[serde(rename = "productId", alias = "product_id")]
    pub product_id: String,
    #[serde(rename = "productName", alias = "product_name")]
    pub product_name: String,
    pub quantity: i64,
    #[serde(rename = "unitPriceCents", alias = "unit_price_cents")]
    pub unit_price_cents: i64,
    #[serde(rename = "taxRate", alias = "tax_rate")]
    pub tax_rate: f64,
    #[serde(rename = "subtotalCents", alias = "subtotal_cents")]
    pub subtotal_cents: i64,
    #[serde(rename = "taxAmountCents", alias = "tax_amount_cents")]
    pub tax_amount_cents: i64,
    #[serde(rename = "totalCents", alias = "total_cents")]
    pub total_cents: i64,
    #[serde(default)]
    pub modifiers: Vec<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReceiptDto {
    pub id: String,
    /// Tahsilatın bağlandığı sipariş (varsa). Fişin siparişe olan bağıdır.
    #[serde(rename = "order_id", alias = "orderId", default)]
    pub order_id: Option<String>,
    /// Fiş numarası **veritabanından** türetilir; istemci gönderemez.
    #[serde(rename = "fiscal_receipt_no", alias = "fiscalReceiptNo", default)]
    pub fiscal_receipt_no: Option<String>,
    /// Fişin tek finansal gerçekliği: tahsilat kaydının işlem kimliği.
    #[serde(rename = "transaction_id", alias = "transactionId", default)]
    pub transaction_id: String,
    #[serde(rename = "table_id", alias = "tableId")]
    pub table_id: String,
    #[serde(rename = "total_cents", alias = "totalCents")]
    pub total_cents: i64,
    #[serde(rename = "subtotal_cents", alias = "subtotalCents")]
    pub subtotal_cents: i64,
    #[serde(rename = "tax_total_cents", alias = "taxTotalCents")]
    pub tax_total_cents: i64,
    #[serde(rename = "discount_cents", alias = "discountCents")]
    pub discount_cents: i64,
    #[serde(rename = "created_at", alias = "createdAt")]
    pub created_at: String,
    #[serde(rename = "cashier_id", alias = "cashierId")]
    pub cashier_id: Option<String>,
    #[serde(rename = "cashier_name", alias = "cashierName")]
    pub cashier_name: Option<String>,
    #[serde(rename = "payment_method", alias = "paymentMethod")]
    pub payment_method: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub items: Vec<ReceiptItemDto>,
    #[serde(rename = "tendered_cents", alias = "tenderedCents")]
    pub tendered_cents: Option<i64>,
    #[serde(rename = "change_cents", alias = "changeCents")]
    pub change_cents: Option<i64>,
    /// Kalem satırı var mı? Kalem yoksa alt toplam/KDV **uydurulmaz**; 0 kalır
    /// ve arayüz "kalem kaydı yok" durumunu gösterir.
    #[serde(rename = "has_items", alias = "hasItems")]
    pub has_items: bool,
}


/// Fiş listesi — **tahsilat kaydından** türetilir (Faz 7).
///
/// Neden servis: Faz 6'daki şube kilidine benzer şekilde veri katmanı
/// (`services::receipt_service`) tek kaynağı ve tenant izolasyonunu taşır.
/// Fişin varlığı siparişten değil **tahsilattan** gelir; böylece aynı satış iki
/// listede iki kez görünmez ve uydurma KDV hesabı ortadan kalkar.
#[tauri::command]
pub async fn get_receipts(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    limit: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ReceiptDto>, String> {
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager, crate::rbac::Role::Cashier],
    )?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    crate::services::receipt_service::list(&mut conn, &tenant, clamp_receipt_limit(limit)).await
}

/// Fiş limiti güvenli aralığa kırpılır: sıfır/negatif sınırsız tarama, çok büyük
/// değer bellek tüketir.
fn clamp_receipt_limit(limit: Option<i64>) -> i64 {
    match limit {
        Some(value) if value > 0 => value.min(500),
        _ => 200,
    }
}

/// Çağıranın tenant'ı zorunludur: eksik veya boşsa sorgu hiç çalışmaz.
pub(crate) fn require_tenant_scope(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}

/// Tek fiş — yalnız bu tenant'ın kendi tahsilatından.
#[tauri::command]
pub async fn get_receipt_details(
    receipt_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Option<ReceiptDto>, String> {
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager, crate::rbac::Role::Cashier],
    )?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    crate::services::receipt_service::find(&mut conn, &tenant, &receipt_id).await
}

/// Hesap Defteri finansal hareketleri (Faz 7).
///
/// Hareket satırı fiş taşıyabilir ya da taşımayabilir; `receipt_id` boşsa
/// arayüz açıkça "Fiş yok" durumunu gösterir. Fiş, ayrı bir ekranın konusu
/// olmaktan çıkıp **harekete bağlı bir bağlantıya** dönüşür.
#[tauri::command]
pub async fn get_financial_movements(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
    limit: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<FinancialMovementDto>, String> {
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager, crate::rbac::Role::Cashier],
    )?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let range = require_receipt_range(from.as_deref(), to.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let movements = crate::services::receipt_service::list_financial_movements(
        &mut conn,
        &tenant,
        &range.0,
        &range.1,
        clamp_receipt_limit(limit),
    )
    .await?;
    Ok(movements
        .iter()
        .map(crate::services::receipt_service::FinancialMovement::to_dto)
        .collect())
}

/// Fiş aralığı zorunludur: "tüm zaman" taraması hem yavaştır hem de geçmiş
/// finansal veriyi sınırsız taşır.
fn require_receipt_range(from: Option<&str>, to: Option<&str>) -> Result<(String, String), String> {
    let normalize = |value: Option<&str>| -> Result<String, String> {
        let trimmed = value.map(str::trim).filter(|v| !v.is_empty()).ok_or_else(|| {
            "INVALID_ARGUMENT: from/to are required (tarih aralığı zorunludur)".to_string()
        })?;
        // ISO 8601 damgası SQLite `datetime('now')` ile karşılaştırılabilir
        // biçime indirgenir; saat dilimi son eki atılır.
        Ok(trimmed.replace('T', " ").replace("+00:00", ""))
    };
    let start = normalize(from)?;
    let end = normalize(to)?;
    if start > end {
        return Err("INVALID_ARGUMENT: from must be before to".to_string());
    }
    Ok((start, end))
}

/// Fiş DTO'su: fiş ile finansal hareket arasındaki bağlantıyı taşır.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FinancialMovementDto {
    pub movement_id: String,
    pub tenant_id: String,
    pub movement_type: String,
    pub amount_cents: i64,
    pub payment_method: String,
    pub description: Option<String>,
    pub created_at: String,
    /// Fiş varsa tahsilat kimliği; kasa/cari hareketlerinde `None`.
    pub receipt_id: Option<String>,
    pub fiscal_receipt_no: Option<String>,
}

/// Termal fiş basımı — **yalnız kayıtlı tahsilat için** (Faz 7).
///
/// Neden imza değişti: komut rol ve tenant almayan, kendisine gönderilen
/// keyfi JSON'u basıyordu. Bu, hem yetkisiz fiş basımına hem de **uydurma
/// mali fişe** yol açıyordu. Artık yalnız `receipt_id` kabul edilir; içerik
/// veritabanındaki tahsilattan okunur, bu tenant'a ait değilse basılmaz.
///
/// Termal akış korunur: aynı satır düzeni, aynı ESC/POS hedefi, aynı veri
/// kaynağı (tahsilat kaydı) kullanılır.
#[tauri::command]
pub async fn print_receipt(
    receipt_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager, crate::rbac::Role::Cashier],
    )?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let receipt = crate::services::receipt_service::find(&mut conn, &tenant, &receipt_id)
        .await?
        .ok_or_else(|| "NOT_FOUND: bu işletmeye ait fiş bulunamadı".to_string())?;

    println!("\n================================================");
    println!("             *** KASAM360 ADİSYON ***           ");
    println!("              ESC/POS 80mm TERMAL FİŞ           ");
    println!("================================================");
    println!("Fiş No   : {}", receipt.fiscal_receipt_no.as_deref().unwrap_or(&receipt.id));
    println!("Masa     : {}", if receipt.table_id.is_empty() { "-" } else { &receipt.table_id });
    println!(
        "Kasiyer  : {}",
        receipt.cashier_name.as_deref().unwrap_or("-")
    );
    println!("Tarih    : {}", receipt.created_at);
    println!("Ödeme    : {}", receipt.payment_method);
    println!("------------------------------------------------");
    println!("{:<22} {:>4} {:>9} {:>9}", "ÜRÜN", "ADET", "FİYAT", "TUTAR");
    println!("------------------------------------------------");

    for item in &receipt.items {
        let short_name: String = item.product_name.chars().take(22).collect();
        println!(
            "{:<22} {:>4} {:>7.2}TL {:>7.2}TL",
            short_name,
            item.quantity,
            item.unit_price_cents as f64 / 100.0,
            item.total_cents as f64 / 100.0
        );
    }

    println!("------------------------------------------------");
    if !receipt.has_items {
        // Kalem satırı yoksa alt toplam/KDV **uydurulmaz**: fiş toplamı tek
        // satırda gösterilir ve eksiklik açıkça yazılır.
        println!("Kalem kaydı yok; yalnız tahsilat toplamı geçerlidir.");
    }
    if receipt.discount_cents > 0 {
        println!(
            "İNDİRİM:                             -{:>7.2} TL",
            receipt.discount_cents as f64 / 100.0
        );
    }
    println!(
        "GENEL TOPLAM:                         {:>7.2} TL",
        receipt.total_cents as f64 / 100.0
    );
    if let Some(tendered) = receipt.tendered_cents {
        println!(
            "Tahsil Edilen ({}):            {:>7.2} TL",
            receipt.payment_method,
            tendered as f64 / 100.0
        );
        if let Some(change) = receipt.change_cents {
            println!("Para Üstü:                            {:>7.2} TL", change as f64 / 100.0);
        }
    }
    println!("================================================");
    println!("       MALİ DEĞERİ YOKTUR - BİLGİ FİŞİDİR       ");
    println!("         Bizi Tercih Ettiğiniz İçin             ");
    println!("              TEŞEKKÜR EDERİZ!                  ");
    println!("================================================\n");
    Ok(())
}
