//! Paket servis: müşteri rehberi, paket siparişi, kurye atama ve kurye mutabakatı.
//!
//! Paket siparişi ayrı bir sipariş sistemi değildir: kalem, fiyat, stok ve tahsilat
//! mevcut `orders` / `order_items` hattından geçer. Her paket siparişi salon planında
//! görünmeyen kendi satış noktasına bağlanır; böylece iki paket aynı adisyona karışmaz.
//! Bu modül yalnız teslimat durumunu, adresi ve kurye parasını tutar.
//!
//! Her sorgu `tenant_id` ile daraltılır. Yazan işlevler çağıranın açtığı yazma işlemi
//! içinde çalışır; denetim kaydı aynı işlemde yazılır. `feat_delivery` bayrağı kapalıysa
//! hiçbir işlev çalışmaz (fail-closed).

pub mod couriers;
pub mod customers;
pub mod orders;
pub mod reports;
pub mod settlement;
pub mod transitions;

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

/// Paket servis özellik bayrağı.
pub const FEATURE_FLAG: &str = "feat_delivery";
/// Paket siparişinin satış noktası kimlik öneki; `tbl_counter_` öneki salon planında gizlenir.
pub const TABLE_ID_PREFIX: &str = "tbl_counter_dlv_";
/// Teslimat ücreti satırının görünmez ürün kodu; mutfak ekranı bu satırı göstermez.
pub const FEE_PRODUCT_SKU: &str = "DELIVERY_FEE";
/// Tek işlemde kabul edilen üst tutar (kuruş); taşma ve yazım hatasına karşı.
pub const MAX_AMOUNT_CENTS: i64 = 100_000_000_000;

/// Teslimat durumları; sıra iş akışıdır.
pub const STATUSES: [&str; 5] = ["PREPARING", "READY", "ON_ROUTE", "DELIVERED", "CANCELLED"];
/// Kapıda tahsil edilen ya da önceden ödenmiş olabilen ödeme şekilleri.
pub const PAYMENT_METHODS: [&str; 3] = ["CASH", "CARD", "ONLINE"];

pub(crate) fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Bayrak kapalıysa komut ve servis reddedilir.
///
/// Neden veritabanından: arayüzün bayrağı yalnız menüyü gizler, güvenlik sunucuda durur.
pub async fn require_enabled(conn: &mut SqliteConnection, tenant_id: &str) -> Result<(), String> {
    let enabled: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM tenant_modules WHERE tenant_id = ? AND module_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .bind(FEATURE_FLAG)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    if enabled.is_some() {
        Ok(())
    } else {
        Err("NOT_FOUND: paket servis bu işletmede etkin değil".to_string())
    }
}

/// Telefonu karşılaştırılabilir biçime çevirir: yalnız rakamlar, başında tek `0`.
///
/// Neden: aynı müşteri "0532 111 22 33", "+90 532 111 22 33" ve "5321112233" yazılabilir;
/// tek biçim olmazsa aynı kişi için üç kayıt açılır.
pub fn normalize_phone(raw: &str) -> Result<String, String> {
    let mut digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    if digits.len() == 12 && digits.starts_with("90") {
        digits.drain(..2);
    }
    if digits.len() == 10 && digits.starts_with('5') {
        digits.insert(0, '0');
    }
    if !(7..=15).contains(&digits.len()) {
        return Err("INVALID_ARGUMENT: telefon numarası geçersiz".to_string());
    }
    Ok(digits)
}

/// Zorunlu, kırpılmış ve uzunluğu sınırlı metin.
pub(crate) fn required_text(value: &str, field: &str, max_chars: usize) -> Result<String, String> {
    let text = value.trim();
    if text.is_empty() {
        return Err(format!("INVALID_ARGUMENT: {field} boş olamaz"));
    }
    if text.chars().count() > max_chars {
        return Err(format!(
            "INVALID_ARGUMENT: {field} en fazla {max_chars} karakter olabilir"
        ));
    }
    Ok(text.to_string())
}

/// İsteğe bağlı metin; boş kalabilir ama sınırı aşamaz.
pub(crate) fn optional_text(value: &str, field: &str, max_chars: usize) -> Result<String, String> {
    let text = value.trim();
    if text.chars().count() > max_chars {
        return Err(format!(
            "INVALID_ARGUMENT: {field} en fazla {max_chars} karakter olabilir"
        ));
    }
    Ok(text.to_string())
}

pub(crate) fn amount_gate(cents: i64, field: &str) -> Result<(), String> {
    if !(0..=MAX_AMOUNT_CENTS).contains(&cents) {
        return Err(format!("INVALID_ARGUMENT: {field} geçersiz"));
    }
    Ok(())
}

pub(crate) fn id_is_valid(id: &str, prefix: &str) -> bool {
    id.strip_prefix(&format!("{prefix}_"))
        .is_some_and(|rest| rest.len() == 24 && rest.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// Teslimat satırı: tahta ve kurye ekranı aynı sözleşmeyi okur.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryRow {
    pub id: String,
    pub order_id: String,
    pub customer_name: String,
    pub phone: String,
    pub address_text: String,
    pub directions: String,
    pub source: String,
    pub external_ref: Option<String>,
    pub status: String,
    pub courier_id: Option<String>,
    pub courier_name: Option<String>,
    pub fee_cents: i64,
    pub total_cents: i64,
    pub payment_method: String,
    pub note: String,
    pub items_summary: String,
    pub created_at: String,
    pub ready_at: Option<String>,
    pub dispatched_at: Option<String>,
    pub delivered_at: Option<String>,
    pub cancelled_at: Option<String>,
    pub cancel_reason: Option<String>,
    pub settled_at: Option<String>,
}

const ROW_SELECT: &str = "SELECT d.id, d.order_id, d.customer_name, d.phone, d.address_text,
        d.directions, d.source, d.external_ref, d.status, d.courier_id,
        (SELECT u.name FROM users u WHERE u.id = d.courier_id AND u.tenant_id = d.tenant_id) AS courier_name,
        d.fee_cents, o.total_cents, d.payment_method, d.note,
        COALESCE((SELECT GROUP_CONCAT(oi.quantity || ' x ' || p.name, ', ')
                    FROM order_items oi JOIN products p ON p.id = oi.product_id
                    WHERE oi.order_id = d.order_id AND oi.tenant_id = d.tenant_id
                      AND oi.status != 'CANCELLED' AND p.sku != 'DELIVERY_FEE'), '') AS items_summary,
        d.created_at, d.ready_at, d.dispatched_at, d.delivered_at, d.cancelled_at,
        d.cancel_reason, d.settled_at
    FROM delivery_orders d JOIN orders o ON o.id = d.order_id AND o.tenant_id = d.tenant_id";

fn map_row(row: &sqlx::sqlite::SqliteRow) -> Result<DeliveryRow, String> {
    let get = |name: &str| row.try_get::<String, _>(name).map_err(text_error);
    let opt = |name: &str| row.try_get::<Option<String>, _>(name).map_err(text_error);
    Ok(DeliveryRow {
        id: get("id")?,
        order_id: get("order_id")?,
        customer_name: get("customer_name")?,
        phone: get("phone")?,
        address_text: get("address_text")?,
        directions: get("directions")?,
        source: get("source")?,
        external_ref: opt("external_ref")?,
        status: get("status")?,
        courier_id: opt("courier_id")?,
        courier_name: opt("courier_name")?,
        fee_cents: row.try_get("fee_cents").map_err(text_error)?,
        total_cents: row.try_get("total_cents").map_err(text_error)?,
        payment_method: get("payment_method")?,
        note: get("note")?,
        items_summary: get("items_summary")?,
        created_at: get("created_at")?,
        ready_at: opt("ready_at")?,
        dispatched_at: opt("dispatched_at")?,
        delivered_at: opt("delivered_at")?,
        cancelled_at: opt("cancelled_at")?,
        cancel_reason: opt("cancel_reason")?,
        settled_at: opt("settled_at")?,
    })
}

/// Tek teslimat; yoksa ya da başka kiracıya aitse bulunamaz.
pub async fn find_delivery(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    delivery_id: &str,
) -> Result<DeliveryRow, String> {
    let row = sqlx::query(&format!("{ROW_SELECT} WHERE d.tenant_id = ? AND d.id = ?"))
        .bind(tenant_id)
        .bind(delivery_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(text_error)?
        .ok_or_else(|| "NOT_FOUND: paket siparişi bulunamadı".to_string())?;
    map_row(&row)
}

/// Aktif (teslim edilmemiş) siparişler ile son kapananlar.
///
/// Neden iki küme: tahta açık işleri eksiksiz, kapananları yalnız son `closed_limit`
/// kadar gösterir; eski kayıtlar rapordan okunur.
pub async fn list_board(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    courier_filter: Option<&str>,
    closed_limit: i64,
) -> Result<Vec<DeliveryRow>, String> {
    let courier_sql = if courier_filter.is_some() {
        " AND d.courier_id = ?"
    } else {
        ""
    };
    let sql = format!(
        "{ROW_SELECT} WHERE d.tenant_id = ?{courier_sql}
           AND (d.status IN ('PREPARING', 'READY', 'ON_ROUTE')
                OR (d.status = 'DELIVERED' AND d.settled_at IS NULL))
         ORDER BY d.created_at ASC"
    );
    let mut query = sqlx::query(&sql).bind(tenant_id);
    if let Some(courier) = courier_filter {
        query = query.bind(courier);
    }
    let mut rows = query
        .fetch_all(&mut *conn)
        .await
        .map_err(text_error)?
        .iter()
        .map(map_row)
        .collect::<Result<Vec<_>, _>>()?;

    let closed_sql = format!(
        "{ROW_SELECT} WHERE d.tenant_id = ?{courier_sql}
           AND (d.status = 'CANCELLED' OR (d.status = 'DELIVERED' AND d.settled_at IS NOT NULL))
         ORDER BY COALESCE(d.cancelled_at, d.delivered_at) DESC LIMIT ?"
    );
    let mut closed = sqlx::query(&closed_sql).bind(tenant_id);
    if let Some(courier) = courier_filter {
        closed = closed.bind(courier);
    }
    let closed_rows = closed
        .bind(closed_limit.clamp(0, 200))
        .fetch_all(&mut *conn)
        .await
        .map_err(text_error)?;
    for row in &closed_rows {
        rows.push(map_row(row)?);
    }
    Ok(rows)
}

#[cfg(test)]
mod flow_tests;
#[cfg(test)]
mod money_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telefon_tek_bicime_iner() {
        assert_eq!(normalize_phone("0532 111 22 33").unwrap(), "05321112233");
        assert_eq!(normalize_phone("+90 532 111 22 33").unwrap(), "05321112233");
        assert_eq!(normalize_phone("5321112233").unwrap(), "05321112233");
        assert!(normalize_phone("12").is_err());
        assert!(normalize_phone("").is_err());
    }

    #[test]
    fn kimlik_oneki_ve_uzunluk_denetlenir() {
        assert!(id_is_valid("dlv_0123456789abcdef01234567", "dlv"));
        assert!(!id_is_valid("usr_0123456789abcdef01234567", "dlv"));
        assert!(!id_is_valid("dlv_xyz", "dlv"));
    }
}
