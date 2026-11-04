//! Maaş kuralı yazma ve silme.

use crate::services::lan_sync::WritePool;
use crate::services::staff360::payroll_period;
use crate::services::staff360::payroll_types::PayrollRuleInput;
use sqlx::SqlitePool;

/// Maaş kuralını yazar (UPSERT). Model doğrulanır: bilinmeyen model
/// bordroyu sessizce sıfır bırakırdı.
pub async fn set_rule(
    pool: &SqlitePool,
    tenant_id: &str,
    input: &PayrollRuleInput,
) -> Result<(), String> {
    let mut tx = pool.begin_write().await?;
    const MODELLER: [&str; 5] = ["FIXED", "COMMISSION", "TIP", "HOURLY", "PROFIT_SHARE"];
    if !MODELLER.contains(&input.model.as_str()) {
        return Err(format!("gecersiz maas modeli: {}", input.model));
    }
    if input.base_salary_cents < 0
        || input.commission_percent < 0
        || input.hourly_rate_cents < 0
        || input.profit_share_percent < 0
    {
        return Err("maas bilesenleri negatif olamaz".to_string());
    }
    if input.commission_percent > 100 || input.profit_share_percent > 100 {
        return Err("yuzde 100'u gecemez".to_string());
    }
    if ![
        payroll_period::DAILY,
        payroll_period::WEEKLY,
        payroll_period::MONTHLY,
    ]
    .contains(&input.pay_period.as_str())
    {
        return Err(format!("gecersiz hakedis donemi: {}", input.pay_period));
    }
    if input.tip_multiplier_percent > 500 {
        return Err("bahsis katsayisi 500'u gecemez".to_string());
    }
    let var: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM users WHERE tenant_id = ?1 AND id = ?2 AND is_active = 1",
    )
    .bind(tenant_id)
    .bind(&input.user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    if var.is_none() {
        return Err(format!("calisan bulunamadi: {}", input.user_id));
    }

    sqlx::query(
        "INSERT INTO payroll_rules
             (id, tenant_id, user_id, model, base_salary_cents, commission_percent,
              hourly_rate_cents, tip_multiplier_percent, profit_share_percent, pay_period, active,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET model = excluded.model,
                       base_salary_cents = excluded.base_salary_cents,
                       commission_percent = excluded.commission_percent,
                       hourly_rate_cents = excluded.hourly_rate_cents,
                       tip_multiplier_percent = excluded.tip_multiplier_percent,
                       profit_share_percent = excluded.profit_share_percent,
                       pay_period = excluded.pay_period,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .bind(crate::id_generator::generate_id("prl"))
    .bind(tenant_id)
    .bind(&input.user_id)
    .bind(&input.model)
    .bind(input.base_salary_cents)
    .bind(input.commission_percent)
    .bind(input.hourly_rate_cents)
    .bind(input.tip_multiplier_percent)
    .bind(input.profit_share_percent)
    .bind(&input.pay_period)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await?;
    Ok(())
}

/// Kuralı kaldırır. Hesaplanmış bordrolar kalır; kişi yeni bordroda görünmez.
pub async fn delete_rule(pool: &SqlitePool, tenant_id: &str, user_id: &str) -> Result<(), String> {
    let mut tx = pool.begin_write().await?;
    sqlx::query("DELETE FROM payroll_rules WHERE tenant_id = ?1 AND user_id = ?2")
        .bind(tenant_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await?;
    Ok(())
}
