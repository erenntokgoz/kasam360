//! Patronun bugün ilgilenmesi gereken işler.
//!
//! Neden tek liste: uyarılar stok, personel, yasal belge ve yedek ekranlarına dağınıktı;
//! patron her ekranı gezmeden riski göremiyordu. Okunamayan kaynak "sorun yok" sayılmaz,
//! kendi uyarısını üretir: boş liste gerçekten sorun olmadığı anlamına gelmelidir.

use crate::services::{budget_service, legal360, staff360};
use serde::Serialize;
use sqlx::{Row, SqlitePool};

const STOCK_RUNWAY_DAYS: f64 = 3.0;
const SALES_WINDOW_DAYS: f64 = 7.0;
const LEGAL_WINDOW_DAYS: i64 = 30;
const LONG_OPEN_MINUTES: i64 = 180;
const BACKUP_STALE_HOURS: i64 = 36;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    /// `CRITICAL`, `WARNING` veya `INFO`.
    pub severity: &'static str,
    pub title: String,
    pub detail: String,
    /// Uyarının çözüleceği yönetim sekmesi; ekranı yoksa boştur.
    pub target: &'static str,
}

fn alert(severity: &'static str, title: String, detail: String, target: &'static str) -> Alert {
    Alert {
        severity,
        title,
        detail,
        target,
    }
}

fn unreadable(area: &str, reason: &str, target: &'static str) -> Alert {
    alert(
        "WARNING",
        format!("{area} okunamadı"),
        reason.to_string(),
        target,
    )
}

fn money(cents: i64) -> String {
    format!("{},{:02} ₺", cents / 100, (cents % 100).abs())
}

/// Stokta biten ve son satış hızına göre birkaç güne bitecek ürünler.
async fn stock_alerts(pool: &SqlitePool, tenant: &str) -> Result<Vec<Alert>, String> {
    let rows = sqlx::query(
        "SELECT p.name, COALESCE(SUM(b.remaining_quantity), 0) AS left_quantity,
                (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
                 WHERE oi.tenant_id = p.tenant_id AND oi.product_id = p.id
                   AND oi.status != 'CANCELLED' AND oi.stock_source_id IS NOT NULL
                   AND oi.rowid IN (SELECT oi2.rowid FROM order_items oi2
                                    JOIN orders o ON o.id = oi2.order_id AND o.tenant_id = oi2.tenant_id
                                    WHERE o.tenant_id = p.tenant_id
                                      AND datetime(o.created_at) >= datetime('now', '-7 days'))) AS sold
         FROM products p
         JOIN inventory_batches b ON b.product_id = p.id AND b.tenant_id = p.tenant_id
         WHERE p.tenant_id = ?1 AND p.is_active = 1
         GROUP BY p.id",
    )
    .bind(tenant)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut alerts = Vec::new();
    for row in rows {
        let name: String = row.try_get("name").map_err(|e| e.to_string())?;
        let left: f64 = row.try_get("left_quantity").map_err(|e| e.to_string())?;
        let sold: f64 = row.try_get::<i64, _>("sold").map_err(|e| e.to_string())? as f64;
        if left <= 0.0 {
            alerts.push(alert(
                "CRITICAL",
                format!("{name} tükendi"),
                "Stokta parti kalmadı.".to_string(),
                "STOCK",
            ));
        } else if sold > 0.0 && left / (sold / SALES_WINDOW_DAYS) < STOCK_RUNWAY_DAYS {
            let days = left / (sold / SALES_WINDOW_DAYS);
            alerts.push(alert(
                "WARNING",
                format!("{name} yakında bitecek"),
                format!("Son 7 günün hızıyla yaklaşık {days:.0} gün yeter."),
                "STOCK",
            ));
        }
    }
    Ok(alerts)
}

async fn operation_alerts(pool: &SqlitePool, tenant: &str) -> Result<Vec<Alert>, String> {
    let mut alerts = Vec::new();
    let debts = sqlx::query(
        "SELECT COUNT(*) AS debts, COALESCE(SUM(remaining_amount_cents), 0) AS amount
         FROM debts WHERE tenant_id = ?1 AND type = 'GIVEN' AND remaining_amount_cents > 0
           AND due_date IS NOT NULL AND datetime(due_date) < datetime('now')",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let (count, amount): (i64, i64) = (
        debts.try_get("debts").map_err(|e| e.to_string())?,
        debts.try_get("amount").map_err(|e| e.to_string())?,
    );
    if count > 0 {
        alerts.push(alert(
            "WARNING",
            format!("{count} alacağın vadesi geçti"),
            format!("Toplam {}.", money(amount)),
            "DEBTS",
        ));
    }
    let long_open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE tenant_id = ?1 AND status IN ('OPEN', 'IN_PROGRESS')
           AND (julianday('now') - julianday(created_at)) * 1440 > ?2",
    )
    .bind(tenant)
    .bind(LONG_OPEN_MINUTES)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    if long_open > 0 {
        alerts.push(alert(
            "INFO",
            format!("{long_open} adisyon 3 saatten uzun açık"),
            "Kapatılmamış hesap gün sonunu durdurur.".to_string(),
            "LOG",
        ));
    }
    let unexplained: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM shifts s
         WHERE s.tenant_id = ?1 AND COALESCE(s.difference_cents, 0) != 0
           AND NOT EXISTS (SELECT 1 FROM audit_ledger a
                           WHERE a.tenant_id = ?1 AND a.resource_id = s.id
                             AND a.action = 'shift:difference_explained')",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    if unexplained > 0 {
        alerts.push(alert(
            "CRITICAL",
            format!("{unexplained} vardiyanın kasa farkı açıklanmadı"),
            "Açıklanmadan gün sonu kapanmaz.".to_string(),
            "LOG",
        ));
    }
    Ok(alerts)
}

async fn legal_alerts(pool: &SqlitePool, tenant: &str) -> Result<Vec<Alert>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let mut alerts = Vec::new();
    for document in
        legal360::legal::list_upcoming_reminders(&mut conn, tenant, LEGAL_WINDOW_DAYS).await?
    {
        alerts.push(alert(
            "WARNING",
            format!("{} süresi doluyor", document.title),
            format!("Son tarih {}.", document.expiry_date),
            "",
        ));
    }
    for policy in
        legal360::insurance::get_expiring_policies(&mut conn, tenant, LEGAL_WINDOW_DAYS).await?
    {
        alerts.push(alert(
            "WARNING",
            format!("{} poliçesi doluyor", policy.insurance_company),
            format!("Son tarih {}.", policy.expiry_date),
            "",
        ));
    }
    for license in
        legal360::music_license::get_expiring_licenses(&mut conn, tenant, LEGAL_WINDOW_DAYS).await?
    {
        alerts.push(alert(
            "WARNING",
            format!("{} lisansı doluyor", license.license_type),
            format!("Son tarih {}.", license.expiry_date),
            "",
        ));
    }
    Ok(alerts)
}

async fn freshness_alerts(pool: &SqlitePool, tenant: &str) -> Result<Vec<Alert>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let report =
        crate::services::inventory360::shelf_life::expiring_batches(&mut conn, tenant).await?;
    let mut alerts = Vec::new();
    if !report.expired.is_empty() {
        alerts.push(alert(
            "CRITICAL",
            format!("{} partinin tarihi geçti", report.expired.len()),
            "Satıştan çekip fire yazın.".to_string(),
            "STOCK",
        ));
    }
    if !report.expiring_soon.is_empty() {
        alerts.push(alert(
            "WARNING",
            format!("{} parti bozulmak üzere", report.expiring_soon.len()),
            format!(
                "Risk altındaki maliyet {}.",
                money(report.at_risk_cost_cents)
            ),
            "STOCK",
        ));
    }
    Ok(alerts)
}

fn backup_alert(last_backup_at: Option<&str>) -> Option<Alert> {
    let stale = match last_backup_at {
        None => true,
        Some(text) => chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
            .map(|at| (chrono::Utc::now().naive_utc() - at).num_hours() > BACKUP_STALE_HOURS)
            .unwrap_or(true),
    };
    stale.then(|| {
        alert(
            "CRITICAL",
            "Güncel yedek yok".to_string(),
            "Cihaz bozulursa veri geri gelmez. Ayarlar'dan yedek alın.".to_string(),
            "SETTINGS",
        )
    })
}

/// Kaynaklar birbirinden bağımsızdır: biri okunamazsa diğerleri yine görünür.
pub async fn collect(
    pool: &SqlitePool,
    tenant: &str,
    from: &str,
    to: &str,
    last_backup: Result<Option<String>, String>,
) -> Vec<Alert> {
    let mut alerts = Vec::new();
    let mut add =
        |source: Result<Vec<Alert>, String>, area: &str, target: &'static str| match source {
            Ok(found) => alerts.extend(found),
            Err(reason) => alerts.push(unreadable(area, &reason, target)),
        };
    add(stock_alerts(pool, tenant).await, "Stok", "STOCK");
    add(
        freshness_alerts(pool, tenant).await,
        "Son kullanma tarihleri",
        "STOCK",
    );
    add(operation_alerts(pool, tenant).await, "Operasyon", "LOG");
    add(
        legal_alerts(pool, tenant).await,
        "Yasal belgeler",
        "SETTINGS",
    );
    let flags = staff360::suspicious_service::radar(pool, tenant, from, to)
        .await
        .map(|flags| {
            flags
                .into_iter()
                .map(|flag| {
                    let severity = if flag.severity.eq_ignore_ascii_case("HIGH") {
                        "CRITICAL"
                    } else {
                        "WARNING"
                    };
                    alert(
                        severity,
                        format!("{}: şüpheli işlem", flag.full_name),
                        flag.detail,
                        "LOG",
                    )
                })
                .collect()
        });
    add(flags, "Şüpheli işlem radarı", "LOG");
    let budgets = budget_service::budget_status(pool, tenant, None)
        .await
        .map(|rows| {
            rows.into_iter()
                .filter(|row| row.is_exceeded)
                .map(|row| {
                    alert(
                        "WARNING",
                        format!("{} bütçesi aşıldı", row.category),
                        format!(
                            "{} harcandı, sınır {}.",
                            money(row.spent_cents),
                            money(row.monthly_limit_cents)
                        ),
                        "PROFIT",
                    )
                })
                .collect()
        });
    add(budgets, "Bütçe", "PROFIT");
    match last_backup {
        Ok(at) => alerts.extend(backup_alert(at.as_deref())),
        Err(reason) => alerts.push(unreadable("Yedek durumu", &reason, "SETTINGS")),
    }
    let rank = |severity: &str| match severity {
        "CRITICAL" => 0,
        "WARNING" => 1,
        _ => 2,
    };
    alerts.sort_by_key(|item| rank(item.severity));
    alerts
}
