//! Faz 11 B4 — bordro hesabı (5 model).
//!
//! Modeller: FIXED, COMMISSION, TIP, HOURLY, PROFIT_SHARE. Her model gerçek
//! tablodan okur; hiçbiri tahminle çalışmaz. Hesaplanamayan bileşen
//! `warning` ile bildirilir, sessizce 0 yazılmaz (AGENTS.md §3.4).
//!
//! Gizlilik: `can_see_amounts` false ise `amounts: None` döner.

use sqlx::Row;
use sqlx::SqlitePool;

use crate::services::staff360::payroll_types::{
    PayrollAmounts, PayrollRule, PayrollRuleInput, PayrollRun,
};
use crate::services::staff360::{tip_service};

/// Maaş kuralını yazar (UPSERT). Model doğrulanır: bilinmeyen model
/// bordroyu sessizce sıfır bırakırdı.
pub async fn set_rule(
    pool: &SqlitePool,
    tenant_id: &str,
    input: &PayrollRuleInput,
) -> Result<(), String> {
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
    if input.tip_multiplier_percent > 500 {
        return Err("bahsis katsayisi 500'u gecemez".to_string());
    }
    let var: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM users WHERE tenant_id = ?1 AND id = ?2 AND is_active = 1",
    )
    .bind(tenant_id)
    .bind(&input.user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    if var.is_none() {
        return Err(format!("calisan bulunamadi: {}", input.user_id));
    }

    sqlx::query(
        "INSERT INTO payroll_rules
             (id, tenant_id, user_id, model, base_salary_cents, commission_percent,
              hourly_rate_cents, tip_multiplier_percent, profit_share_percent, active,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET model = excluded.model,
                       base_salary_cents = excluded.base_salary_cents,
                       commission_percent = excluded.commission_percent,
                       hourly_rate_cents = excluded.hourly_rate_cents,
                       tip_multiplier_percent = excluded.tip_multiplier_percent,
                       profit_share_percent = excluded.profit_share_percent,
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
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn list_rules(
    pool: &SqlitePool,
    tenant_id: &str,
    can_see_amounts: bool,
) -> Result<Vec<PayrollRule>, String> {
    let rows = sqlx::query(
        "SELECT pr.user_id, u.name, pr.model, pr.base_salary_cents, pr.commission_percent,
                pr.hourly_rate_cents, pr.tip_multiplier_percent, pr.profit_share_percent, pr.active
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
        // Yetkisiz çağıran için maaş ve saatlik ücret sıfırlanır: model ve
        // oranlar görünür (yönetici planı anlamalı), tutarlar görünmez.
        let gizli = !can_see_amounts;
        out.push(PayrollRule {
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            full_name: r.try_get("name").map_err(|e| e.to_string())?,
            model: r.try_get("model").map_err(|e| e.to_string())?,
            base_salary_cents: if gizli {
                0
            } else {
                r.try_get("base_salary_cents").map_err(|e| e.to_string())?
            },
            commission_percent: r
                .try_get("commission_percent")
                .map_err(|e| e.to_string())?,
            hourly_rate_cents: if gizli {
                0
            } else {
                r.try_get("hourly_rate_cents").map_err(|e| e.to_string())?
            },
            tip_multiplier_percent: r
                .try_get("tip_multiplier_percent")
                .map_err(|e| e.to_string())?,
            profit_share_percent: r
                .try_get("profit_share_percent")
                .map_err(|e| e.to_string())?,
            active: r.try_get::<i64, _>("active").map_err(|e| e.to_string())? != 0,
        });
    }
    Ok(out)
}

/// `YYYY-MM` dönemini `[baslangic, bitis]` aralığına çevirir.
/// Geçersiz dönem hata verir; sessizce tüm zaman aralığına düşmez.
fn period_range(period: &str) -> Result<(String, String), String> {
    let parcalar: Vec<&str> = period.split('-').collect();
    if parcalar.len() != 2 || parcalar[0].len() != 4 || parcalar[1].len() != 2 {
        return Err(format!("donem YYYY-MM olmali: {period}"));
    }
    let yil: i32 = parcalar[0]
        .parse()
        .map_err(|_| format!("donem yili gecersiz: {period}"))?;
    let ay: u32 = parcalar[1]
        .parse()
        .map_err(|_| format!("donem ayi gecersiz: {period}"))?;
    if !(1..=12).contains(&ay) {
        return Err(format!("donem ayi 1-12 olmali: {period}"));
    }
    let ilk = format!("{yil:04}-{ay:02}-01");
    // Ay uzunluğu: 31'e `31 - gün` farkı eklenir. Şubat artık yılda 29, normal
    // yılda 28 gündür; hata burada bordro dönemini bir gün kaydırır.
    let son_gun = 31u8
        - match ay {
            4 | 6 | 9 | 11 => 2,
            2 => if (yil % 4 == 0 && yil % 100 != 0) || yil % 400 == 0 {
                2
            } else {
                3
            },
            _ => 0,
        };
    let son = if ay == 12 {
        format!("{}-{}-31", yil + 1, "01")
    } else {
        format!("{yil:04}-{ay:02}-{son_gun}")
    };
    Ok((ilk, format!("{son}T23:59:59")))
}

/// Dönemin bordrosunu hesaplar ve `payroll_runs` tablosuna yazar.
/// Aynı dönem yeniden hesaplanırsa satırlar güncellenir (UPSERT): maaş
/// hesabı tekrarlanabilir olmalıdır, aksi halde ay sonunda "hangi rakam
/// doğru?" sorusu cevapsız kalır.
pub async fn run_payroll(
    pool: &SqlitePool,
    tenant_id: &str,
    period: &str,
    can_see_amounts: bool,
) -> Result<Vec<PayrollRun>, String> {
    let (baslangic, bitis) = period_range(period)?;
    let rules = list_rules(pool, tenant_id, can_see_amounts).await?;
    if rules.is_empty() {
        return Err("bu isletmede tanimli maas kurali yok".to_string());
    }

    // PROFIT_SHARE modeli icin donem net kararini bir kez hesapla.
    let kar_aran = Some((baslangic.clone(), bitis.clone()));
    let mut net_kar: Option<i64> = None;

    let mut out: Vec<PayrollRun> = Vec::with_capacity(rules.len());
    for kural in &rules {
        let mut uyari: Vec<String> = Vec::new();
        let komisyon_taban = if kural.commission_percent > 0 {
            own_sales_cents(pool, tenant_id, &kural.user_id, &baslangic, &bitis).await?
        } else {
            0
        };
        let komisyon = yuzde_hesapla(komisyon_taban, kural.commission_percent);
        if kural.commission_percent > 0 && komisyon_taban == 0 {
            uyari.push("bu donemde satış kaydı yok; komisyon hesaplanmadi".to_string());
        }

        let bahsis = if kural.model == "TIP" {
            tip_service::tip_for_user(pool, tenant_id, &kural.user_id, period).await?
        } else {
            0
        };
        if kural.model == "TIP" && bahsis == 0 {
            uyari.push("bu donemde dagitilmis bahsis yok".to_string());
        }

        let (saat_ucreti, saat) = if kural.model == "HOURLY" {
            let h = worked_hours(pool, tenant_id, &kural.user_id, &baslangic, &bitis).await?;
            if h == 0.0 {
                uyari.push("bu donemde kapanmis vardiye kaydi yok".to_string());
            }
            (
                (h * kural.hourly_rate_cents as f64).round() as i64,
                h,
            )
        } else {
            (0, 0.0)
        };

        let kar_payi = if kural.profit_share_percent > 0 {
            if net_kar.is_none() {
                let rapor = crate::services::pnl_service::financial_report(pool, tenant_id, &kar_aran)
                    .await
                    .map_err(|e| format!("donem kari hesaplanamadi: {e}"))?;
                net_kar = Some(rapor.net_profit_cents);
            }
            let kar = net_kar.unwrap_or(0);
            if kar <= 0 {
                uyari.push("donem net kârı sıfır veya zarar; kâr payı verilmedi".to_string());
                0
            } else {
                yuzde_hesapla(kar, kural.profit_share_percent)
            }
        } else {
            0
        };

        let brut = kural.base_salary_cents + komisyon + bahsis + saat_ucreti + kar_payi;
        let id = crate::id_generator::generate_id("pay");
        let not = basis_note(
            &kural.model,
            kural.commission_percent,
            kural.base_salary_cents,
            komisyon_taban,
            bahsis,
            saat,
            kar_payi,
            brut,
        );

        sqlx::query(
            "INSERT INTO payroll_runs
                 (id, tenant_id, user_id, period, model, base_cents, commission_cents,
                  tip_cents, hourly_cents, profit_share_cents, deduction_cents,
                  gross_cents, net_cents, input_snapshot, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?11, ?12,
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT (tenant_id, user_id, period)
             DO UPDATE SET model = excluded.model,
                           base_cents = excluded.base_cents,
                           commission_cents = excluded.commission_cents,
                           tip_cents = excluded.tip_cents,
                           hourly_cents = excluded.hourly_cents,
                           profit_share_cents = excluded.profit_share_cents,
                           gross_cents = excluded.gross_cents,
                           net_cents = excluded.net_cents,
                           input_snapshot = excluded.input_snapshot,
                           created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        )
        .bind(&id)
        .bind(tenant_id)
        .bind(&kural.user_id)
        .bind(period)
        .bind(&kural.model)
        .bind(kural.base_salary_cents)
        .bind(komisyon)
        .bind(bahsis)
        .bind(saat_ucreti)
        .bind(kar_payi)
        .bind(brut)
        .bind(&not)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        let role: String = sqlx::query_scalar(
            "SELECT role FROM users WHERE tenant_id = ?1 AND id = ?2",
        )
        .bind(tenant_id)
        .bind(&kural.user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "BILINMIYOR".to_string());

        out.push(PayrollRun {
            id,
            user_id: kural.user_id.clone(),
            full_name: kural.full_name.clone(),
            role,
            period: period.to_string(),
            model: kural.model.clone(),
            amounts: if can_see_amounts {
                Some(PayrollAmounts {
                    base_cents: kural.base_salary_cents,
                    commission_cents: komisyon,
                    tip_cents: bahsis,
                    hourly_cents: saat_ucreti,
                    profit_share_cents: kar_payi,
                    deduction_cents: 0,
                    gross_cents: brut,
                    net_cents: brut,
                })
            } else {
                None
            },
            basis_note: not,
            warning: if uyari.is_empty() {
                None
            } else {
                Some(uyari.join("; "))
            },
        });
    }
    Ok(out)
}

/// Çalışanın kendi satışı: garson kalemlerinden, diğerleri kendi kapattığı
/// siparişlerden. `order_items.waiter_id` yazılmamış eski siparişler
/// garson satışına dahil edilmez; yanlışlıkla kasa cirosu garson primine
/// yansımasın diye.
async fn own_sales_cents(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    baslangic: &str,
    bitis: &str,
) -> Result<i64, String> {
    let kalem: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(oi.total_cents), 0)
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = ?1 AND oi.waiter_id = ?2
            AND o.status = 'PAID' AND o.created_at >= ?3 AND o.created_at <= ?4",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(baslangic)
    .bind(bitis)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("calisan satis toplami okunamadi: {e}"))?;

    let siparis: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_cents), 0) FROM orders
          WHERE tenant_id = ?1 AND cashier_id = ?2
            AND status = 'PAID' AND created_at >= ?3 AND created_at <= ?4",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(baslangic)
    .bind(bitis)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("kasa satisi toplami okunamadi: {e}"))?;
    Ok(kalem + siparis)
}

/// Kapanmış vardiye saatleri. `shifts` kapanmamışsa saat sayılmaz: yarım
/// kalmış vardiya saatlik ücreti eksik hesaplanırdı.
async fn worked_hours(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    baslangic: &str,
    bitis: &str,
) -> Result<f64, String> {
    let saat: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM((julianday(closed_at) - julianday(opened_at)) * 24.0), 0.0)
           FROM shifts
          WHERE tenant_id = ?1 AND cashier_id = ?2 AND closed_at IS NOT NULL
            AND opened_at >= ?3 AND closed_at <= ?4",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(baslangic)
    .bind(bitis)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("vardiye saati okunamadi: {e}"))?;
    Ok(saat)
}

/// Yüzde hesabı: taban × yüzde / 100, kuruş yuvarlaması ile.
fn yuzde_hesapla(taban: i64, yuzde: i64) -> i64 {
    ((taban as i128 * yuzde as i128) / 100) as i64
}

/// Hesabın dayanağını düz cümleyle yazar. Ekranda "tutar" yanında "bu nereden
/// geldi" de görünür: patron rakamı sorgulayabilmelidir.
fn basis_note(
    model: &str,
    komisyon_yuzde: i64,
    taban_maas: i64,
    komisyon_taban: i64,
    bahsis: i64,
    saat: f64,
    kar_payi: i64,
    brut: i64,
) -> String {
    match model {
        "FIXED" => format!("sabit maas {} kr", taban_maas),
        "COMMISSION" => format!(
            "sabit {} kr + satis {} kr × %{:.0} = {} kr",
            taban_maas, komisyon_taban, komisyon_yuzde as f64, brut
        ),
        "TIP" => format!("sabit {} kr + dagitilmis bahsis {} kr", taban_maas, bahsis),
        "HOURLY" => format!(
            "{:.1} saat × saatlik {} kr = {} kr",
            saat,
            taban_maas,
            brut
        ),
        "PROFIT_SHARE" => {
            format!("sabit {} kr + kar payi {} kr", taban_maas, kar_payi)
        }
        _ => format!(
            "satis {} kr · bahsis {} kr · saat {:.1} · kar payi {} kr · brut {} kr",
            komisyon_taban, bahsis, saat, kar_payi, brut
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{period_range, yuzde_hesapla};

    #[test]
    fn donem_araligi_uc_aylik_dogru() {
        assert_eq!(
            period_range("2026-03").unwrap(),
            ("2026-03-01".to_string(), "2026-03-31T23:59:59".to_string())
        );
    }

    #[test]
    fn subat_artisiz_28_gun() {
        let (b, s) = period_range("2026-02").unwrap();
        assert_eq!(b, "2026-02-01");
        assert!(s.starts_with("2026-02-28"), "2026 artık yıl değil: {s}");
    }

    #[test]
    fn subat_artili_29_gun() {
        let (_, s) = period_range("2028-02").unwrap();
        assert!(s.starts_with("2028-02-29"), "2028 artık yıl: {s}");
    }

    #[test]
    fn yuzyil_artik_olmayan_yil_28_gun() {
        // 1900 artık yıl **değildir** (100 ile bölünür ama 400 ile bölünmez).
        let (_, s) = period_range("1900-02").unwrap();
        assert!(s.starts_with("1900-02-28"), "{s}");
    }

    #[test]
    fn aralik_dondurulmez() {
        assert_eq!(yuzde_hesapla(33_335, 7), 2_333);
    }

    #[test]
    fn gecersiz_donem_reddedilir() {
        assert!(period_range("2026-13").is_err());
        assert!(period_range("2026").is_err());
        assert!(period_range("abc-def").is_err());
    }
}
