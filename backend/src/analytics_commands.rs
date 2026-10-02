//! Owner gösterge panelinin (dashboard) özet verisi.
//!
//! Neden yeniden yazıldı (Faz 5): komut `tenant_id` almıyordu ve
//! `popular_categories` alanı **sabit sayılarla** (`Ana Yemekler: 12`,
//! `İçecekler: 8`) dolduruluyordu. Bu hem çapraz işletme sızıntısı hem de
//! AGENTS.md'nin uydurma veri yasağını ihlal ediyordu. Artık kategori
//! dağılımı gerçek satırlardan hesaplanır ve tarih aralığı zorunludur.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AnalyticsDashboardDataDto {
    pub total_sales_cents: i64,
    pub transaction_count: i64,
    pub average_order_value_cents: i64,
    /// Kategori adı → satılan adet (kuruş değil, adet).
    pub popular_categories: std::collections::HashMap<String, i64>,
    pub from: String,
    pub to: String,
}

/// Çağıranın tenant'ı zorunludur: eksik veya boşsa fail-closed reddedilir.
fn require_tenant(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}

fn require_range(from: Option<&str>, to: Option<&str>) -> Result<(String, String), String> {
    let from_raw = from
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "INVALID_ARGUMENT: from is required".to_string())?;
    let to_raw = to
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "INVALID_ARGUMENT: to is required".to_string())?;
    let from_dt = chrono::DateTime::parse_from_rfc3339(from_raw)
        .map_err(|_| "INVALID_ARGUMENT: from must be ISO-8601".to_string())?;
    let to_dt = chrono::DateTime::parse_from_rfc3339(to_raw)
        .map_err(|_| "INVALID_ARGUMENT: to must be ISO-8601".to_string())?;
    if to_dt < from_dt {
        return Err("INVALID_ARGUMENT: to must not be before from".to_string());
    }
    Ok((from_raw.to_string(), to_raw.to_string()))
}

#[tauri::command]
pub async fn get_analytics_dashboard_data(
    actor_role: String,
    tenant_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<AnalyticsDashboardDataDto, String> {
    // SPEC §34 "Raporlar": işletme sahibi tam, müdür kısmi. MASTER'ın rapor satırı yoktur.
    crate::rbac::require_reporting(&actor_role)?;
    let tenant = require_tenant(tenant_id.as_deref())?;
    let (from, to) = require_range(from.as_deref(), to.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let row = sqlx::query(
        "SELECT COALESCE(sum(total_cents), 0) as total, COUNT(*) as count \
         FROM orders WHERE tenant_id = ? AND status IN ('PAID', 'CLOSED') \
           AND created_at >= ? AND created_at <= ?",
    )
    .bind(&tenant)
    .bind(&from)
    .bind(&to)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let total_sales_cents: i64 = row.try_get("total").unwrap_or(0);
    let transaction_count: i64 = row.try_get("count").unwrap_or(0);
    let average_order_value_cents = if transaction_count > 0 {
        total_sales_cents / transaction_count
    } else {
        0
    };

    // Kategori dağılımı gerçek satırlardan: kategori yoksa "Kategorisiz".
    let category_rows = sqlx::query(
        "SELECT COALESCE(c.name, 'Kategorisiz') AS category_name, \
                COALESCE(SUM(oi.quantity), 0) AS qty \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id \
         JOIN products p ON p.id = oi.product_id AND p.tenant_id = ? \
         LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id = ? \
         WHERE o.tenant_id = ? AND o.status IN ('PAID', 'CLOSED') \
           AND o.created_at >= ? AND o.created_at <= ? \
         GROUP BY c.id, COALESCE(c.name, 'Kategorisiz') \
         ORDER BY qty DESC LIMIT 10",
    )
    .bind(&tenant)
    .bind(&tenant)
    .bind(&tenant)
    .bind(&from)
    .bind(&to)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut popular_categories = std::collections::HashMap::new();
    for row in category_rows {
        let name: String = row.try_get::<String, _>("category_name").unwrap_or_default();
        let qty: i64 = row.try_get("qty").unwrap_or(0);
        if !name.is_empty() {
            popular_categories.insert(name, qty);
        }
    }

    Ok(AnalyticsDashboardDataDto {
        total_sales_cents,
        transaction_count,
        average_order_value_cents,
        popular_categories,
        from,
        to,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tenant_zorunludur() {
        assert!(require_tenant(None).is_err());
        assert!(require_tenant(Some(" ")).is_err());
        assert_eq!(require_tenant(Some("tnt_a")).unwrap(), "tnt_a");
    }

    #[test]
    fn aralik_zorunlu_ve_sirali_olmalidir() {
        assert!(require_range(None, Some("2026-01-01T00:00:00+00:00")).is_err());
        assert!(require_range(Some("2026-01-02T00:00:00+00:00"), Some("2026-01-01T00:00:00+00:00")).is_err());
        assert!(require_range(Some("2026-01-01T00:00:00+00:00"), Some("2026-01-31T00:00:00+00:00")).is_ok());
    }

    #[test]
    fn master_gostergeye_giremez() {
        assert!(crate::rbac::require_reporting("MASTER").is_err());
        assert!(crate::rbac::require_reporting("OWNER").is_ok());
    }
}
