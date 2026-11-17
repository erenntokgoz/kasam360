//! Teslimat durum geçişleri: Hazırlanıyor, Hazır, Yolda, Teslim edildi.
//!
//! Geçişler tek yönlüdür ve yalnız bu tablodaki çiftler geçerlidir. İptal ayrı yoldan
//! (`orders::cancel`) onayla yapılır. Kurye yalnız kendine atanmış siparişi "Yolda" ve
//! "Teslim edildi" yapabilir; "Hazır" mutfak tarafının kararıdır.

use sqlx::SqliteConnection;

use super::couriers::require_courier;
use super::{find_delivery, id_is_valid, text_error, DeliveryRow};
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

/// Geçerli geçişler: `(şu an, sonraki)`.
const FLOW: [(&str, &str); 3] = [
    ("PREPARING", "READY"),
    ("READY", "ON_ROUTE"),
    ("ON_ROUTE", "DELIVERED"),
];

/// Çağıranın teslimat üzerindeki yetki biçimi.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Who {
    /// İşletme personeli (sahip, müdür, kasiyer): her geçişi ve atamayı yapar.
    Staff,
    /// Kurye etiketli personel: yalnız kendine atanmış siparişi ilerletir.
    Courier,
}

fn audit_ctx(
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    action: &str,
    delivery_id: &str,
    payload: serde_json::Value,
) -> Result<AuditContext, String> {
    AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::SIPARIS_MASA,
        action,
        delivery_id.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )
}

/// Siparişi bir sonraki duruma geçirir.
///
/// `courier_id` yalnız personelin "Yolda" geçişinde, atama yapılmamışsa kullanılır.
/// Önceden ödenmiş (ONLINE) sipariş teslimde aynı işlemde kapanır; kapıda tahsilatlı
/// sipariş kurye mutabakatına kadar açık kalır.
#[allow(clippy::too_many_arguments)]
pub async fn advance(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    who: Who,
    delivery_id: &str,
    to: &str,
    courier_id: Option<&str>,
) -> Result<DeliveryRow, String> {
    super::require_enabled(conn, tenant_id).await?;
    if !id_is_valid(delivery_id, "dlv") {
        return Err("INVALID_ARGUMENT: teslimat kimliği geçersiz".to_string());
    }
    let to = to.trim().to_uppercase();
    let delivery = find_delivery(conn, tenant_id, delivery_id).await?;
    if !FLOW.contains(&(delivery.status.as_str(), to.as_str())) {
        return Err(format!(
            "INVALID_TRANSITION: {} durumundan {} durumuna geçilemez",
            delivery.status, to
        ));
    }

    let mut assigned = delivery.courier_id.clone();
    match who {
        Who::Courier => {
            if assigned.as_deref() != Some(actor_id) {
                return Err("FORBIDDEN: bu sipariş size atanmamış".to_string());
            }
            if to == "READY" {
                return Err("FORBIDDEN: kurye siparişi hazır işaretleyemez".to_string());
            }
        }
        Who::Staff => {
            if to == "ON_ROUTE" {
                if let Some(requested) = courier_id.map(str::trim).filter(|v| !v.is_empty()) {
                    require_courier(conn, tenant_id, requested).await?;
                    assigned = Some(requested.to_string());
                }
            }
        }
    }
    if to == "ON_ROUTE" && assigned.is_none() {
        return Err("INVALID_ARGUMENT: yola çıkarmak için kurye atanmalı".to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let column = match to.as_str() {
        "READY" => "ready_at",
        "ON_ROUTE" => "dispatched_at",
        _ => "delivered_at",
    };
    let result = sqlx::query(&format!(
        "UPDATE delivery_orders SET status = ?, {column} = ?, courier_id = ?
         WHERE id = ? AND tenant_id = ? AND status = ?"
    ))
    .bind(&to)
    .bind(&now)
    .bind(&assigned)
    .bind(delivery_id)
    .bind(tenant_id)
    .bind(&delivery.status)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    // Başka cihaz aynı geçişi önce yaptıysa ikinci yazma sessizce geçmez.
    if result.rows_affected() == 0 {
        return Err("CONFLICT: sipariş durumu bu arada değişti".to_string());
    }

    if to == "DELIVERED" && delivery.payment_method == "ONLINE" {
        super::settlement::settle_prepaid(conn, lock, tenant_id, actor_id, actor_role, &delivery)
            .await?;
    }

    let ctx = audit_ctx(
        tenant_id,
        actor_id,
        actor_role,
        "delivery:status_changed",
        delivery_id,
        serde_json::json!({
            "deliveryId": delivery_id,
            "orderId": delivery.order_id,
            "fromStatus": delivery.status,
            "toStatus": to,
            "courierId": assigned,
        }),
    )?;
    AuditService::append(conn, lock, &ctx).await?;
    find_delivery(conn, tenant_id, delivery_id).await
}

/// Kuryeyi atar ya da değiştirir. Teslim edilmiş sipariş kuryesi değişmez: mutabakat o kuryeyedir.
pub async fn assign_courier(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    delivery_id: &str,
    courier_id: &str,
) -> Result<DeliveryRow, String> {
    super::require_enabled(conn, tenant_id).await?;
    if !id_is_valid(delivery_id, "dlv") {
        return Err("INVALID_ARGUMENT: teslimat kimliği geçersiz".to_string());
    }
    let courier_id = courier_id.trim();
    let courier_name = require_courier(conn, tenant_id, courier_id).await?;
    let delivery = find_delivery(conn, tenant_id, delivery_id).await?;
    if !matches!(delivery.status.as_str(), "READY" | "ON_ROUTE") {
        return Err(format!(
            "INVALID_TRANSITION: {} durumundaki siparişe kurye atanamaz",
            delivery.status
        ));
    }
    sqlx::query("UPDATE delivery_orders SET courier_id = ? WHERE id = ? AND tenant_id = ?")
        .bind(courier_id)
        .bind(delivery_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    let ctx = audit_ctx(
        tenant_id,
        actor_id,
        actor_role,
        "delivery:courier_assigned",
        delivery_id,
        serde_json::json!({
            "deliveryId": delivery_id,
            "courierId": courier_id,
            "courierName": courier_name,
            "previousCourierId": delivery.courier_id,
        }),
    )?;
    AuditService::append(conn, lock, &ctx).await?;
    find_delivery(conn, tenant_id, delivery_id).await
}

/// Siparişe bağlı PREPARING durumundaki teslimatı HAZIR yapar; paket değilse hiçbir şey yapmaz.
///
/// Neden ayrı: mutfak "Hazır" dediğinde kurye tahtasındaki durum da aynı işlemde ilerlemeli.
/// Özellik kapalıysa adım atlanır; KDS akışı paket servis ayarına bağımlı olmamalıdır.
pub async fn mark_ready_for_order(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    order_id: &str,
    actor_id: &str,
    actor_role: &str,
) -> Result<(), String> {
    let found: Option<String> = sqlx::query_scalar(
        "SELECT id FROM delivery_orders WHERE order_id = ? AND tenant_id = ? AND status = 'PREPARING'",
    )
    .bind(order_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let Some(delivery_id) = found else {
        return Ok(());
    };
    if super::require_enabled(conn, tenant_id).await.is_err() {
        return Ok(());
    }
    advance(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        Who::Staff,
        &delivery_id,
        "READY",
        None,
    )
    .await?;
    Ok(())
}
