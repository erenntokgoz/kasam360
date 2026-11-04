//! Personel bordro hesabı (3 model).
//!
//! Modeller: FIXED, TIP, HOURLY. Komisyon ve kâr payı kaldırıldı; bordro satış ve
//! P&L okumaz, `commission_cents` ve `profit_share_cents` sütunları 0 yazılır. Her
//! model gerçek tablodan okur; hesaplanamayan bileşen `warning` ile bildirilir,
//! sessizce 0 yazılmaz (AGENTS.md §3.4).
//!
//! Gizlilik: `can_see_amounts` false ise `amounts: None` döner.

use crate::services::lan_sync::WritePool;
use crate::services::staff360::payroll_deductions;
use crate::services::staff360::payroll_hours::{hourly_pay_cents, hours_text, worked_seconds};
#[cfg(test)]
pub use crate::services::staff360::payroll_period::period_range;
use crate::services::staff360::payroll_period::{self, period_window, PeriodWindow};
use sqlx::Row;
use sqlx::SqlitePool;

use crate::services::staff360::payroll_types::{PayrollAmounts, PayrollRule, PayrollRun};
use crate::services::staff360::tip_service;

pub use crate::services::staff360::payroll_rules::{
    delete_rule, hourly_equivalent_cents, set_rule, set_tip_multiplier,
};

pub async fn list_rules(
    pool: &SqlitePool,
    tenant_id: &str,
    can_see_amounts: bool,
) -> Result<Vec<PayrollRule>, String> {
    let rows = sqlx::query(
        "SELECT pr.user_id, u.name, pr.model, pr.base_salary_cents, pr.hourly_rate_cents,
                pr.tip_multiplier_percent, pr.pay_period, pr.active
           FROM payroll_rules pr
           JOIN users u ON u.id = pr.user_id AND u.tenant_id = pr.tenant_id
          WHERE pr.tenant_id = ?1
          ORDER BY u.name ASC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let model: String = r.try_get("model").map_err(|e| e.to_string())?;
        let pay_period: String = r.try_get("pay_period").map_err(|e| e.to_string())?;
        let base: i64 = r.try_get("base_salary_cents").map_err(|e| e.to_string())?;
        let rate: i64 = r.try_get("hourly_rate_cents").map_err(|e| e.to_string())?;
        // Yetkisiz çağıran için maaş ve saatlik ücret sıfırlanır: model ve
        // çarpan görünür (yönetici planı anlamalı), tutarlar görünmez.
        let gizli = !can_see_amounts;
        out.push(PayrollRule {
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            full_name: r.try_get("name").map_err(|e| e.to_string())?,
            hourly_equivalent_cents: if gizli {
                None
            } else {
                Some(hourly_equivalent_cents(&model, &pay_period, base, rate)?)
            },
            model,
            base_salary_cents: if gizli { 0 } else { base },
            hourly_rate_cents: if gizli { 0 } else { rate },
            tip_multiplier_percent: r
                .try_get("tip_multiplier_percent")
                .map_err(|e| e.to_string())?,
            pay_period,
            active: r.try_get::<i64, _>("active").map_err(|e| e.to_string())? != 0,
        });
    }
    Ok(out)
}

/// Dönemin bordrosunu hesaplar ve `payroll_runs` tablosuna yazar. Aynı dönem yeniden
/// hesaplanırsa satır güncellenir: "hangi rakam doğru?" sorusu cevapsız kalmamalı.
pub async fn run_payroll(
    pool: &SqlitePool,
    tenant_id: &str,
    pay_period: &str,
    period: &str,
    can_see_amounts: bool,
) -> Result<Vec<PayrollRun>, String> {
    let window = period_window(pay_period, period)?;
    let PeriodWindow {
        key: donem,
        from: baslangic,
        to: bitis,
        days: donem_gunu,
    } = window;
    // Tutarlar her zaman gerçek değerle hesaplanır ve yazılır; gizlilik yalnız
    // yanıtta uygulanır. Müdürün başlattığı hesap sıfır maaşla kaydedilmemeli.
    let rules: Vec<PayrollRule> = list_rules(pool, tenant_id, true)
        .await?
        .into_iter()
        .filter(|rule| rule.pay_period == pay_period)
        .collect();
    if rules.is_empty() {
        return Err("bu hakedis donemiyle tanimli maas kurali yok".to_string());
    }

    let mut tx = pool.begin_write().await?;
    let mut out: Vec<PayrollRun> = Vec::with_capacity(rules.len());
    for kural in &rules {
        let mut uyari: Vec<String> = Vec::new();

        let bahsis = if kural.model == "TIP" {
            // Bahşiş aylık dağıtılır: kısa dönemde dağıtım tarihi esas alınır, tekrar yazılmaz.
            if pay_period == payroll_period::MONTHLY {
                tip_service::tip_for_user(pool, tenant_id, &kural.user_id, period).await?
            } else {
                payroll_deductions::tips_between(
                    &mut tx,
                    tenant_id,
                    &kural.user_id,
                    &baslangic,
                    &bitis,
                )
                .await?
            }
        } else {
            0
        };
        if kural.model == "TIP" && bahsis == 0 {
            uyari.push("bu donemde dagitilmis bahsis yok".to_string());
        }

        let (saat_ucreti, saat) = if kural.model == "HOURLY" {
            let h = worked_seconds(pool, tenant_id, &kural.user_id, &baslangic, &bitis).await?;
            if h == 0 {
                uyari.push("bu donemde kapanmis vardiye kaydi yok".to_string());
            }
            (hourly_pay_cents(h, kural.hourly_rate_cents)?, h)
        } else {
            (0, 0)
        };

        let brut = kural.base_salary_cents + bahsis + saat_ucreti;
        let kesinti = payroll_deductions::for_user(
            &mut tx,
            tenant_id,
            &kural.user_id,
            period,
            &baslangic,
            &bitis,
            kural.base_salary_cents,
            donem_gunu,
        )
        .await?;
        let net = brut - kesinti.total_cents();
        if net < 0 {
            uyari.push("kesinti brütü aşıyor; fark sonraki döneme kalır".to_string());
        }
        let id = crate::id_generator::generate_id("pay");
        let not = with_deductions(
            basis_note(
                &kural.model,
                kural.base_salary_cents,
                kural.hourly_rate_cents,
                bahsis,
                saat,
                brut,
            ),
            &kesinti,
        );

        sqlx::query(
            "INSERT INTO payroll_runs
                 (id, tenant_id, user_id, period, model, base_cents, commission_cents,
                  tip_cents, hourly_cents, profit_share_cents, deduction_cents,
                  gross_cents, net_cents, input_snapshot, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, 0, ?11, ?9, ?12, ?10,
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT (tenant_id, user_id, period)
             DO UPDATE SET model = excluded.model,
                           base_cents = excluded.base_cents,
                           commission_cents = 0,
                           tip_cents = excluded.tip_cents,
                           hourly_cents = excluded.hourly_cents,
                           profit_share_cents = 0,
                           deduction_cents = excluded.deduction_cents,
                           gross_cents = excluded.gross_cents,
                           net_cents = excluded.net_cents,
                           input_snapshot = excluded.input_snapshot,
                           created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        )
        .bind(&id)
        .bind(tenant_id)
        .bind(&kural.user_id)
        .bind(&donem)
        .bind(&kural.model)
        .bind(kural.base_salary_cents)
        .bind(bahsis)
        .bind(saat_ucreti)
        .bind(brut)
        .bind(&not)
        .bind(kesinti.total_cents())
        .bind(net)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        let role: String =
            sqlx::query_scalar("SELECT role FROM users WHERE tenant_id = ?1 AND id = ?2")
                .bind(tenant_id)
                .bind(&kural.user_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "BILINMIYOR".to_string());

        out.push(PayrollRun {
            id,
            user_id: kural.user_id.clone(),
            full_name: kural.full_name.clone(),
            role,
            period: donem.clone(),
            model: kural.model.clone(),
            amounts: if can_see_amounts {
                Some(PayrollAmounts {
                    base_cents: kural.base_salary_cents,
                    commission_cents: 0,
                    tip_cents: bahsis,
                    hourly_cents: saat_ucreti,
                    profit_share_cents: 0,
                    deduction_cents: kesinti.total_cents(),
                    gross_cents: brut,
                    net_cents: net,
                })
            } else {
                None
            },
            // Dayanak metni tutar içerir; müdür yanıtında boş döner.
            basis_note: if can_see_amounts { not } else { String::new() },
            worked_seconds: saat,
            warning: if uyari.is_empty() {
                None
            } else {
                Some(uyari.join("; "))
            },
        });
    }
    tx.commit().await?;
    Ok(out)
}

/// Patron kesintinin nereden geldiğini de görmeli.
fn with_deductions(note: String, kesinti: &payroll_deductions::Deductions) -> String {
    if kesinti.total_cents() == 0 {
        return note;
    }
    format!(
        "{note}; avans {} kr; ücretsiz izin {} gün {} kr",
        kesinti.advance_cents, kesinti.unpaid_days, kesinti.unpaid_leave_cents
    )
}

/// Hesabın dayanağını düz cümleyle yazar. Ekranda "tutar" yanında "bu nereden
/// geldi" de görünür: patron rakamı sorgulayabilmelidir.
fn basis_note(
    model: &str,
    taban_maas: i64,
    saat_ucreti: i64,
    bahsis: i64,
    saat: i64,
    brut: i64,
) -> String {
    match model {
        "TIP" => format!("sabit {} kr + dagitilmis bahsis {} kr", taban_maas, bahsis),
        "HOURLY" => format!(
            "{} saat × saatlik {} kr = {} kr",
            hours_text(saat),
            saat_ucreti,
            brut
        ),
        _ => format!("sabit maas {} kr", taban_maas),
    }
}

#[cfg(test)]
#[path = "payroll_service_tests.rs"]
mod tests;
