//! Paket servis müşteri rehberi: telefon, ad, birden çok adres, not ve geçmiş siparişler.
//!
//! Telefon kiracı içinde tekildir (`normalize_phone` biçimiyle). Adres silinmez, pasife
//! alınır: geçmiş siparişler adresi kendi satırında kopya olarak taşır, ama rehberdeki
//! kayıt kaybolursa müşteri geçmişi okunamaz hale gelirdi.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::{id_is_valid, normalize_phone, optional_text, required_text, text_error};
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

const NAME_MAX: usize = 120;
const NOTE_MAX: usize = 500;
const ADDRESS_MAX: usize = 400;
const LABEL_MAX: usize = 60;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryAddress {
    pub id: String,
    pub label: String,
    pub address: String,
    pub directions: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryCustomer {
    pub id: String,
    pub phone: String,
    pub name: String,
    pub note: String,
    pub addresses: Vec<DeliveryAddress>,
    pub order_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomerOrderRow {
    pub delivery_id: String,
    pub status: String,
    pub total_cents: i64,
    pub payment_method: String,
    pub items_summary: String,
    pub address_text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerInput {
    /// Boşsa yeni müşteri açılır; doluysa o müşteri güncellenir.
    pub id: Option<String>,
    pub phone: String,
    pub name: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressInput {
    pub id: Option<String>,
    pub customer_id: String,
    #[serde(default)]
    pub label: String,
    pub address: String,
    #[serde(default)]
    pub directions: String,
}

async fn load_addresses(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    customer_id: &str,
) -> Result<Vec<DeliveryAddress>, String> {
    let rows = sqlx::query(
        "SELECT id, label, address, directions FROM delivery_addresses
         WHERE tenant_id = ? AND customer_id = ? AND is_active = 1
         ORDER BY created_at ASC, id ASC",
    )
    .bind(tenant_id)
    .bind(customer_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            Ok(DeliveryAddress {
                id: row.try_get("id").map_err(text_error)?,
                label: row.try_get("label").map_err(text_error)?,
                address: row.try_get("address").map_err(text_error)?,
                directions: row.try_get("directions").map_err(text_error)?,
            })
        })
        .collect()
}

async fn customer_from_row(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    row: &sqlx::sqlite::SqliteRow,
) -> Result<DeliveryCustomer, String> {
    let id: String = row.try_get("id").map_err(text_error)?;
    let addresses = load_addresses(conn, tenant_id, &id).await?;
    Ok(DeliveryCustomer {
        phone: row.try_get("phone").map_err(text_error)?,
        name: row.try_get("name").map_err(text_error)?,
        note: row.try_get("note").map_err(text_error)?,
        order_count: row.try_get("order_count").map_err(text_error)?,
        addresses,
        id,
    })
}

const CUSTOMER_SELECT: &str = "SELECT c.id, c.phone, c.name, c.note,
        (SELECT COUNT(*) FROM delivery_orders d
          WHERE d.tenant_id = c.tenant_id AND d.customer_id = c.id AND d.status != 'CANCELLED') AS order_count
    FROM delivery_customers c";

/// Telefonla hızlı arama: rakam yazıldıysa numaranın içinde, harf yazıldıysa adın içinde aranır.
pub async fn search(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    query: &str,
) -> Result<Vec<DeliveryCustomer>, String> {
    let needle = query.trim();
    let digits: String = needle.chars().filter(char::is_ascii_digit).collect();
    let by_phone = !digits.is_empty()
        && needle
            .chars()
            .all(|c| c.is_ascii_digit() || c.is_whitespace() || "+-()".contains(c));
    let rows = if needle.is_empty() {
        sqlx::query(&format!(
            "{CUSTOMER_SELECT} WHERE c.tenant_id = ? AND c.is_active = 1
             ORDER BY c.updated_at DESC LIMIT 30"
        ))
        .bind(tenant_id)
        .fetch_all(&mut *conn)
        .await
    } else if by_phone {
        sqlx::query(&format!(
            "{CUSTOMER_SELECT} WHERE c.tenant_id = ? AND c.is_active = 1 AND instr(c.phone, ?) > 0
             ORDER BY c.updated_at DESC LIMIT 30"
        ))
        .bind(tenant_id)
        .bind(&digits)
        .fetch_all(&mut *conn)
        .await
    } else {
        // Ad aramasında SQLite `lower` yalnız ASCII katlar; Türkçe harfler için eşleşme
        // uygulama tarafında yapılır, aday kümesi kiracının etkin müşterileriyle sınırlıdır.
        sqlx::query(&format!(
            "{CUSTOMER_SELECT} WHERE c.tenant_id = ? AND c.is_active = 1
             ORDER BY c.updated_at DESC LIMIT 500"
        ))
        .bind(tenant_id)
        .fetch_all(&mut *conn)
        .await
    }
    .map_err(text_error)?;

    let lowered = needle.to_lowercase();
    let mut found = Vec::new();
    for row in &rows {
        let customer = customer_from_row(conn, tenant_id, row).await?;
        if needle.is_empty() || by_phone || customer.name.to_lowercase().contains(&lowered) {
            found.push(customer);
        }
        if found.len() >= 30 {
            break;
        }
    }
    Ok(found)
}

pub async fn get(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    customer_id: &str,
) -> Result<DeliveryCustomer, String> {
    let row = sqlx::query(&format!(
        "{CUSTOMER_SELECT} WHERE c.tenant_id = ? AND c.id = ? AND c.is_active = 1"
    ))
    .bind(tenant_id)
    .bind(customer_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?
    .ok_or_else(|| "NOT_FOUND: müşteri bulunamadı".to_string())?;
    customer_from_row(conn, tenant_id, &row).await
}

/// Müşterinin geçmiş siparişleri; iptaller de görünür, hangi adrese gittiği okunur.
pub async fn history(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    customer_id: &str,
    limit: i64,
) -> Result<Vec<CustomerOrderRow>, String> {
    let rows = sqlx::query(
        "SELECT d.id, d.status, o.total_cents, d.payment_method, d.address_text, d.created_at,
                COALESCE((SELECT GROUP_CONCAT(oi.quantity || ' x ' || p.name, ', ')
                            FROM order_items oi JOIN products p ON p.id = oi.product_id
                            WHERE oi.order_id = d.order_id AND oi.tenant_id = d.tenant_id
                              AND oi.status != 'CANCELLED' AND p.sku != 'DELIVERY_FEE'), '') AS items_summary
         FROM delivery_orders d JOIN orders o ON o.id = d.order_id AND o.tenant_id = d.tenant_id
         WHERE d.tenant_id = ? AND d.customer_id = ?
         ORDER BY d.created_at DESC LIMIT ?",
    )
    .bind(tenant_id)
    .bind(customer_id)
    .bind(limit.clamp(1, 100))
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            Ok(CustomerOrderRow {
                delivery_id: row.try_get("id").map_err(text_error)?,
                status: row.try_get("status").map_err(text_error)?,
                total_cents: row.try_get("total_cents").map_err(text_error)?,
                payment_method: row.try_get("payment_method").map_err(text_error)?,
                items_summary: row.try_get("items_summary").map_err(text_error)?,
                address_text: row.try_get("address_text").map_err(text_error)?,
                created_at: row.try_get("created_at").map_err(text_error)?,
            })
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
async fn audit(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    action: &str,
    resource_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::SIPARIS_MASA,
        action,
        resource_id.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await.map(|_| ())
}

/// Müşteri açar ya da günceller. Aynı telefon başka müşteride varsa kayıt reddedilir.
pub async fn save_customer(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    input: &CustomerInput,
) -> Result<DeliveryCustomer, String> {
    let phone = normalize_phone(&input.phone)?;
    let name = required_text(&input.name, "ad", NAME_MAX)?;
    let note = optional_text(&input.note, "not", NOTE_MAX)?;
    let now = chrono::Utc::now().to_rfc3339();

    let clash: Option<String> =
        sqlx::query_scalar("SELECT id FROM delivery_customers WHERE tenant_id = ? AND phone = ?")
            .bind(tenant_id)
            .bind(&phone)
            .fetch_optional(&mut *conn)
            .await
            .map_err(text_error)?;

    let id = match input.id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(existing) => {
            if !id_is_valid(existing, "cus") {
                return Err("INVALID_ARGUMENT: müşteri kimliği geçersiz".to_string());
            }
            if clash.as_deref().is_some_and(|other| other != existing) {
                return Err("CONFLICT: bu telefon başka bir müşteride kayıtlı".to_string());
            }
            let result = sqlx::query(
                "UPDATE delivery_customers SET phone = ?, name = ?, note = ?, updated_at = ?
                 WHERE id = ? AND tenant_id = ? AND is_active = 1",
            )
            .bind(&phone)
            .bind(&name)
            .bind(&note)
            .bind(&now)
            .bind(existing)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
            if result.rows_affected() == 0 {
                return Err("NOT_FOUND: müşteri bulunamadı".to_string());
            }
            existing.to_string()
        }
        None => {
            if clash.is_some() {
                return Err("CONFLICT: bu telefon başka bir müşteride kayıtlı".to_string());
            }
            let id = crate::id_generator::generate_id("cus");
            sqlx::query(
                "INSERT INTO delivery_customers (id, tenant_id, phone, name, note, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(tenant_id)
            .bind(&phone)
            .bind(&name)
            .bind(&note)
            .bind(&now)
            .bind(&now)
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
            id
        }
    };
    audit(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        "delivery:customer_saved",
        &id,
        serde_json::json!({ "customerId": id, "phone": phone, "name": name }),
    )
    .await?;
    get(conn, tenant_id, &id).await
}

/// Adres ekler ya da günceller; adres müşteriye ve kiracıya aittir.
pub async fn save_address(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    input: &AddressInput,
) -> Result<DeliveryCustomer, String> {
    let label = optional_text(&input.label, "adres adı", LABEL_MAX)?;
    let address = required_text(&input.address, "adres", ADDRESS_MAX)?;
    let directions = optional_text(&input.directions, "tarif", ADDRESS_MAX)?;
    get(conn, tenant_id, input.customer_id.trim()).await?;

    let id = match input.id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(existing) => {
            if !id_is_valid(existing, "adr") {
                return Err("INVALID_ARGUMENT: adres kimliği geçersiz".to_string());
            }
            let result = sqlx::query(
                "UPDATE delivery_addresses SET label = ?, address = ?, directions = ?
                 WHERE id = ? AND tenant_id = ? AND customer_id = ? AND is_active = 1",
            )
            .bind(&label)
            .bind(&address)
            .bind(&directions)
            .bind(existing)
            .bind(tenant_id)
            .bind(input.customer_id.trim())
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
            if result.rows_affected() == 0 {
                return Err("NOT_FOUND: adres bulunamadı".to_string());
            }
            existing.to_string()
        }
        None => {
            let id = crate::id_generator::generate_id("adr");
            sqlx::query(
                "INSERT INTO delivery_addresses (id, tenant_id, customer_id, label, address, directions, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(tenant_id)
            .bind(input.customer_id.trim())
            .bind(&label)
            .bind(&address)
            .bind(&directions)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
            id
        }
    };
    audit(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        "delivery:address_saved",
        &id,
        serde_json::json!({ "addressId": id, "customerId": input.customer_id.trim() }),
    )
    .await?;
    get(conn, tenant_id, input.customer_id.trim()).await
}

/// Adresi pasife alır; geçmiş siparişler kendi adres kopyasını taşıdığı için etkilenmez.
pub async fn remove_address(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    address_id: &str,
) -> Result<DeliveryCustomer, String> {
    let customer_id: Option<String> = sqlx::query_scalar(
        "SELECT customer_id FROM delivery_addresses WHERE id = ? AND tenant_id = ? AND is_active = 1",
    )
    .bind(address_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let customer_id = customer_id.ok_or_else(|| "NOT_FOUND: adres bulunamadı".to_string())?;
    sqlx::query("UPDATE delivery_addresses SET is_active = 0 WHERE id = ? AND tenant_id = ?")
        .bind(address_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    audit(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        "delivery:address_removed",
        address_id,
        serde_json::json!({ "addressId": address_id, "customerId": customer_id }),
    )
    .await?;
    get(conn, tenant_id, &customer_id).await
}
