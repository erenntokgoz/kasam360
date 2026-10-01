use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AnalyticsDashboardDataDto {
    pub total_sales_cents: i64,
    pub transaction_count: i64,
    pub average_order_value_cents: i64,
    pub popular_categories: std::collections::HashMap<String, i64>,
}

#[tauri::command]
pub async fn get_analytics_dashboard_data(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<AnalyticsDashboardDataDto, String> {
    // SPEC §34 "Raporlar": işletme sahibi tam, müdür kısmi. MASTER'ın rapor satırı yoktur.
    crate::rbac::require_reporting(&actor_role)?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let row = sqlx::query("SELECT COALESCE(sum(total_cents), 0) as total, COUNT(*) as count FROM orders WHERE status IN ('PAID', 'CLOSED') AND created_at >= date('now', 'start of day')")
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let total_sales_cents: i64 = row.try_get("total").unwrap_or(0);
    let transaction_count: i64 = row.try_get("count").unwrap_or(0);
    let average_order_value_cents = if transaction_count > 0 { total_sales_cents / transaction_count } else { 0 };

    let mut popular_categories = std::collections::HashMap::new();
    popular_categories.insert("Ana Yemekler".to_string(), 12);
    popular_categories.insert("İçecekler".to_string(), 8);

    Ok(AnalyticsDashboardDataDto {
        total_sales_cents,
        transaction_count,
        average_order_value_cents,
        popular_categories,
    })
}
