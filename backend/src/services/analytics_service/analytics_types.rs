//! Faz 10 analitik veri modelleri.
//!
//! Neden ayrı dosya: DTO'lar hem servisin hem komut katmanının ortak
//! sözleşmesidir; servis dosyası 500 satır sınırına yaklaşmasın diye
//! burada toplanır. Konvansiyon: `report_service` ile aynı — **snake_case**
//! alan adları (serde rename yok), frontend `reportTypes.ts` ile birebir.

/// Dönem filtresi: `None` = bu ay (tüm zaman değil, çünkü rapor ekranı
/// varsayılan olarak içinde bulunulan ayı gösterir), `Some((from, to))` =
/// ISO-8601 aralık (`from <= to` sözleşini komut katmanı doğrular).
pub type AnalyticsRange = Option<(String, String)>;

/// Ürün kâr marjı satırı.
///
/// `unit_cost_cents`, `gross_profit_cents` ve `margin_percent` **null** olabilir:
/// ürünün FIFO partisi yoksa maliyet bilinmez. AGENTS.md §3.4 gereği bu durum
/// 0'a dönüştürülmez, bilinmiyor olarak bırakılır.
#[derive(Debug, Clone)]
pub struct ProductMargin {
    pub product_id: String,
    pub product_name: String,
    pub category_name: String,
    pub units_sold: i64,
    pub revenue_cents: i64,
    pub unit_cost_cents: Option<i64>,
    pub gross_profit_cents: Option<i64>,
    pub margin_percent: Option<i64>,
}

/// BCG matrisinde bir ürünün konumu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BcgQuadrant {
    /// Yüksek hacim + yüksek marj — korunmalı, yatırım almalı
    Star,
    /// Düşük hacim + yüksek marj — niş, fiyat/konumlandırma denenir
    Plowhorse,
    /// Yüksek hacim + düşük marj — fiyat/maliyet revizyonu şart
    CashCow,
    /// Düşük hacim + düşük marj — eleme adayı
    Dog,
}

/// BCG sınıflandırma sonucu (eşikler raporun kendi medyanından türetilir).
#[derive(Debug, Clone)]
pub struct BcgEntry {
    pub product_id: String,
    pub product_name: String,
    pub quadrant: BcgQuadrant,
    pub units_sold: i64,
    pub margin_percent: Option<i64>,
}

/// Kovadan kovaya ürün sayısı. BCG ekranındaki dört kutunun rozetleri.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BcgCounts {
    pub star: i64,
    pub plowhorse: i64,
    pub cash_cow: i64,
    pub dog: i64,
}

/// İki ürünün birlikte satılma sıklığı.
#[derive(Debug, Clone)]
pub struct ProductCombination {
    pub product_a_id: String,
    pub product_a_name: String,
    pub product_b_id: String,
    pub product_b_name: String,
    /// Bu ikilinin birlikte göründüğü sipariş sayısı (destek).
    pub support: i64,
    /// Bu ikilinin geçtiği tüm siparişler içindeki pay (yüzde).
    pub confidence_percent: i64,
}

/// Saatlik satış kovası (yoğun saat analizi).
#[derive(Debug, Clone)]
pub struct PeakHourBucket {
    /// 0–23
    pub hour: i64,
    pub revenue_cents: i64,
    pub orders: i64,
}

/// Aylık hedef gerçekleşme durumu.
#[derive(Debug, Clone)]
pub struct MonthlyTargetStatus {
    /// `YYYY-MM`
    pub month: String,
    pub category: String,
    pub target_cents: i64,
    pub actual_cents: i64,
    pub difference_cents: i64,
    /// Hedef 0 ise **null**: "sınırsız aşıldı" değil, oran hesaplanamaz.
    pub achieved_percent: Option<i64>,
}

/// Bizim fiyat ile rakip fiyat arasındaki fark.
#[derive(Debug, Clone)]
pub struct CompetitorPriceGap {
    pub product_id: String,
    pub product_name: String,
    pub competitor_name: String,
    pub our_price_cents: i64,
    pub competitor_price_cents: i64,
    /// `bizim - rakip`. Negatifse biz daha pahalıyız.
    pub gap_cents: i64,
    /// `gap * 100 / rakip`. Negatifse biz daha pahalıyız.
    pub gap_percent: i64,
    /// Gözlemin alındığı zaman (ISO-8601). Fiyat geçmişi silinmez.
    pub observed_at: String,
}

/// İptal (void) kaybının toplam cirosa oranı.
#[derive(Debug, Clone)]
pub struct VoidLossRate {
    pub voided_cents: i64,
    pub total_cents: i64,
    /// Toplam ciro 0 ise **null**: oran hesaplanamaz, 0 sanılmaz.
    pub void_rate_percent: Option<i64>,
    pub voided_orders: i64,
    /// Yalnız `PAID`/`VOID` siparişleri: ciro toplamıyla aynı evren.
    pub total_orders: i64,
}

/// `get_analytics_metrics` komutunun tamamı.
#[derive(Debug, Clone)]
pub struct AnalyticsMetrics {
    pub from: Option<String>,
    pub to: Option<String>,
    pub currency: String,
    pub product_margins: Vec<ProductMargin>,
    pub bcg_matrix: Vec<BcgEntry>,
    pub bcg_counts: BcgCounts,
    pub combinations: Vec<ProductCombination>,
    pub peak_hours: Vec<PeakHourBucket>,
    pub monthly_targets: Vec<MonthlyTargetStatus>,
    pub competitor_gaps: Vec<CompetitorPriceGap>,
    pub void_loss: Option<VoidLossRate>,
}

/// BCG ekran sütunu adı (UI etiketi). Diğer AGENTS.md metin kuralı gereği
/// ASCII kalanına sadeleştirilmiştir; frontend etiketi ayrıca lokalize edilir.
pub fn quadrant_label(q: BcgQuadrant) -> &'static str {
    match q {
        BcgQuadrant::Star => "Yildiz",
        BcgQuadrant::Plowhorse => "Bova",
        BcgQuadrant::CashCow => "Nakit Urunu",
        BcgQuadrant::Dog => "Soru Isareti",
    }
}