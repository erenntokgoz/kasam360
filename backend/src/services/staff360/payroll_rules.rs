//! Maaş kuralı yazma ve silme.
//!
//! Geçerli modeller FIXED, TIP ve HOURLY'dir. Komisyon ve kâr payı kaldırıldı: satış ve
//! P&L tabanlı prim yanlış tabandan ödeme riski taşıyordu (0017 eski kuralları FIXED yaptı).

use crate::services::lan_sync::WritePool;
use crate::services::staff360::payroll_period;
use crate::services::staff360::payroll_types::PayrollRuleInput;
use sqlx::SqlitePool;

pub const MODELS: [&str; 3] = ["FIXED", "TIP", "HOURLY"];

/// Bahşiş çarpanı yüzde olarak tutulur (100 = 1,00). Üst sınır, yanlış girilen
/// fazladan sıfırın havuzu tek kişiye toplamasını önler.
fn validate_multiplier(percent: i64) -> Result<(), String> {
    if !(0..=500).contains(&percent) {
        return Err("VALIDATION: bahşiş çarpanı 0 ile 500 arasında olmalı".to_string());
    }
    Ok(())
}

/// Yalnız bahşiş çarpanını yazar. Maaş kuralının geri kalanına dokunmaz: kart
/// üzerindeki küçük düzenleme maaşı yanlışlıkla sıfırlamasın.
pub async fn set_tip_multiplier(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    percent: i64,
) -> Result<(), String> {
    validate_multiplier(percent)?;
    let mut tx = pool.begin_write().await?;
    let changed = sqlx::query(
        "UPDATE payroll_rules SET tip_multiplier_percent = ?3,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE tenant_id = ?1 AND user_id = ?2",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(percent)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();
    if changed == 0 {
        return Err(
            "NOT_FOUND: bu personelin maaş kuralı yok; önce maaş kuralını kaydedin".to_string(),
        );
    }
    tx.commit().await?;
    Ok(())
}

/// Maaş kuralını yazar (UPSERT). Model doğrulanır: bilinmeyen model
/// bordroyu sessizce sıfır bırakırdı.
pub async fn set_rule(
    pool: &SqlitePool,
    tenant_id: &str,
    input: &PayrollRuleInput,
) -> Result<(), String> {
    let mut tx = pool.begin_write().await?;
    if !MODELS.contains(&input.model.as_str()) {
        return Err(format!("gecersiz maas modeli: {}", input.model));
    }
    // Eski istemcinin gönderdiği yüzde sessizce yutulmaz: patron primin
    // ödeneceğini sanırdı.
    if input.commission_percent != 0 || input.profit_share_percent != 0 {
        return Err("VALIDATION: komisyon ve kâr payı artık desteklenmiyor".to_string());
    }
    if input.base_salary_cents < 0 || input.hourly_rate_cents < 0 {
        return Err("maas bilesenleri negatif olamaz".to_string());
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
    validate_multiplier(input.tip_multiplier_percent)?;
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
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, 0, ?8, 1,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET model = excluded.model,
                       base_salary_cents = excluded.base_salary_cents,
                       commission_percent = 0,
                       hourly_rate_cents = excluded.hourly_rate_cents,
                       tip_multiplier_percent = excluded.tip_multiplier_percent,
                       profit_share_percent = 0,
                       pay_period = excluded.pay_period,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .bind(crate::id_generator::generate_id("prl"))
    .bind(tenant_id)
    .bind(&input.user_id)
    .bind(&input.model)
    .bind(input.base_salary_cents)
    .bind(input.hourly_rate_cents)
    .bind(input.tip_multiplier_percent)
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
