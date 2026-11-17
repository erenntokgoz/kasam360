//! Kurye etiketi ve kurye başına açık iş özeti.
//!
//! Kurye ayrı bir rol değildir: personelin üzerindeki etikettir. Etiketli kişi kendi rolüyle
//! girer ve ek olarak kendine atanan siparişleri görür. Etiket kaldırılsa da geçmiş siparişler
//! o kişiye bağlı kalır; kaldırma, tahsil edilmemiş sipariş varken reddedilir.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

use super::text_error;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CourierRow {
    pub user_id: String,
    pub name: String,
    pub role: String,
    pub is_courier: bool,
    /// Şu an yolda olan sipariş sayısı.
    pub on_route_count: i64,
    /// Teslim edilmiş, parası kuryeden henüz teslim alınmamış sipariş sayısı.
    pub unsettled_count: i64,
    pub unsettled_cash_cents: i64,
    pub unsettled_card_cents: i64,
}

/// Etkin ve kurye etiketli personeli doğrular; adını döndürür.
pub async fn require_courier(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
) -> Result<String, String> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT name FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1 AND is_courier = 1",
    )
    .bind(user_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    name.ok_or_else(|| "NOT_FOUND: kurye bulunamadı veya kurye olarak tanımlı değil".to_string())
}

/// Kullanıcı bu kiracıda etkin bir kurye mi.
pub async fn is_courier(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
) -> Result<bool, String> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1 AND is_courier = 1",
    )
    .bind(user_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(found.is_some())
}

/// Etkin personel ve kurye durumları. Mutfak ve platform hesapları kurye olamaz.
pub async fn list(conn: &mut SqliteConnection, tenant_id: &str) -> Result<Vec<CourierRow>, String> {
    let rows = sqlx::query(
        "SELECT u.id, u.name, u.role, u.is_courier,
            (SELECT COUNT(*) FROM delivery_orders d WHERE d.tenant_id = u.tenant_id
               AND d.courier_id = u.id AND d.status = 'ON_ROUTE') AS on_route_count,
            (SELECT COUNT(*) FROM delivery_orders d WHERE d.tenant_id = u.tenant_id
               AND d.courier_id = u.id AND d.status = 'DELIVERED' AND d.settled_at IS NULL) AS unsettled_count,
            (SELECT COALESCE(SUM(o.total_cents), 0) FROM delivery_orders d
               JOIN orders o ON o.id = d.order_id AND o.tenant_id = d.tenant_id
              WHERE d.tenant_id = u.tenant_id AND d.courier_id = u.id AND d.status = 'DELIVERED'
                AND d.settled_at IS NULL AND d.payment_method = 'CASH') AS cash_cents,
            (SELECT COALESCE(SUM(o.total_cents), 0) FROM delivery_orders d
               JOIN orders o ON o.id = d.order_id AND o.tenant_id = d.tenant_id
              WHERE d.tenant_id = u.tenant_id AND d.courier_id = u.id AND d.status = 'DELIVERED'
                AND d.settled_at IS NULL AND d.payment_method = 'CARD') AS card_cents
         FROM users u
         WHERE u.tenant_id = ? AND u.is_active = 1 AND UPPER(u.role) NOT IN ('KITCHEN', 'MASTER')
         ORDER BY u.is_courier DESC, u.name ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            let flag: i64 = row.try_get("is_courier").map_err(text_error)?;
            Ok(CourierRow {
                user_id: row.try_get("id").map_err(text_error)?,
                name: row.try_get("name").map_err(text_error)?,
                role: row.try_get("role").map_err(text_error)?,
                is_courier: flag != 0,
                on_route_count: row.try_get("on_route_count").map_err(text_error)?,
                unsettled_count: row.try_get("unsettled_count").map_err(text_error)?,
                unsettled_cash_cents: row.try_get("cash_cents").map_err(text_error)?,
                unsettled_card_cents: row.try_get("card_cents").map_err(text_error)?,
            })
        })
        .collect()
}

/// Kurye etiketini açar ya da kapatır.
pub async fn set_flag(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    user_id: &str,
    enabled: bool,
) -> Result<(), String> {
    super::require_enabled(conn, tenant_id).await?;
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1",
    )
    .bind(user_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let role = role.ok_or_else(|| "NOT_FOUND: personel bulunamadı".to_string())?;
    if matches!(role.to_uppercase().as_str(), "KITCHEN" | "MASTER") {
        return Err("INVALID_ARGUMENT: bu hesap kurye olamaz".to_string());
    }
    if !enabled {
        // Yoldaki ya da parası alınmamış siparişi olan kişinin etiketi kalkarsa sipariş sahipsiz kalırdı.
        let open: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM delivery_orders WHERE tenant_id = ? AND courier_id = ?
               AND (status = 'ON_ROUTE' OR (status = 'DELIVERED' AND settled_at IS NULL))",
        )
        .bind(tenant_id)
        .bind(user_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(text_error)?;
        if open > 0 {
            return Err(
                "CONFLICT: kuryenin yolda ya da mutabakat bekleyen siparişi var".to_string(),
            );
        }
    }
    sqlx::query("UPDATE users SET is_courier = ? WHERE id = ? AND tenant_id = ?")
        .bind(i64::from(enabled))
        .bind(user_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::PERSONEL,
        "delivery:courier_flag",
        user_id.to_string(),
        serde_json::json!({ "userId": user_id, "isCourier": enabled }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await.map(|_| ())
}
