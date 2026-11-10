//! Patronun bugün ilgilenmesi gereken işler.
//!
//! Neden tek liste: uyarılar stok, personel, yasal belge ve yedek ekranlarına dağınıktı;
//! patron her ekranı gezmeden riski göremiyordu. Okunamayan kaynak "sorun yok" sayılmaz,
//! kendi uyarısını üretir: boş liste gerçekten sorun olmadığı anlamına gelmelidir.

use crate::services::staff360;
use serde::Serialize;
use sqlx::{Row, SqlitePool};

const STOCK_RUNWAY_DAYS: f64 = 3.0;
const SALES_WINDOW_DAYS: f64 = 7.0;
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

/// Yerel takvim günü (`YYYY-AA-GG`). Vade tarihi yerel gün metnidir; UTC anıyla kıyaslamak
/// vadesi bugün olan borcu gün başlangıcından itibaren "geçmiş" gösterirdi.
fn local_today(now: chrono::DateTime<chrono::Utc>, utc_offset_minutes: i64) -> String {
    (now + chrono::Duration::minutes(utc_offset_minutes))
        .format("%Y-%m-%d")
        .to_string()
}

async fn operation_alerts(
    pool: &SqlitePool,
    tenant: &str,
    today: &str,
) -> Result<Vec<Alert>, String> {
    let mut alerts = Vec::new();
    let debts = sqlx::query(
        "SELECT COUNT(*) AS debts, COALESCE(SUM(remaining_amount_cents), 0) AS amount
         FROM debts WHERE tenant_id = ?1 AND type = 'GIVEN' AND remaining_amount_cents > 0
           AND due_date IS NOT NULL AND date(due_date) < date(?2)",
    )
    .bind(tenant)
    .bind(today)
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
    let waiting: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM leave_requests WHERE tenant_id = ?1 AND status = 'Bekliyor'",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    if waiting > 0 {
        alerts.push(alert(
            "INFO",
            format!("{waiting} izin talebi onay bekliyor"),
            "Karar verilene kadar vardiya planı belirsiz kalır.".to_string(),
            "PAYROLL",
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
    utc_offset_minutes: i64,
) -> Vec<Alert> {
    let mut alerts = Vec::new();
    let mut add =
        |source: Result<Vec<Alert>, String>, area: &str, target: &'static str| match source {
            Ok(found) => alerts.extend(found),
            Err(reason) => alerts.push(unreadable(area, &reason, target)),
        };
    add(stock_alerts(pool, tenant).await, "Stok", "STOCK");
    let today = local_today(chrono::Utc::now(), utc_offset_minutes);
    add(
        operation_alerts(pool, tenant, &today).await,
        "Operasyon",
        "LOG",
    );
    let flags = match inclusive_radar_end(from, to) {
        Ok(Some(radar_to)) => staff360::suspicious_service::radar(pool, tenant, from, &radar_to)
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
            }),
        Ok(None) => Ok(Vec::new()),
        Err(reason) => Err(reason),
    };
    add(flags, "Şüpheli işlem radarı", "LOG");
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

/// Radar `datetime()` ile saniyeye kırparak karşılaştırır ve bitişi DAHİL sayar; pano ise
/// `[başlangıç, bitiş)` kullanır. Bitiş tam saniyeyse 1 saniye çıkarmak kırpılmış satırları
/// doğru böler (23:59:59.500 satırı 23:59:59 olur ve içeride kalır, ertesi gün 00:00:00 dışarıda).
/// Bitişte kesirli saniye varsa kırpılmış saniye zaten bitişin içindedir; çıkarmak o saniyedeki
/// kaydı yanlışlıkla dışlardı. Böyle aralıkta radar kesirli kısım kadar geniş okur (en çok 1 sn).
fn inclusive_radar_end(from: &str, to: &str) -> Result<Option<String>, String> {
    use chrono::Timelike;
    let parse = |value: &str| {
        chrono::DateTime::parse_from_rfc3339(value)
            .map_err(|_| "VALIDATION: radar tarihi RFC 3339 olmalıdır".to_string())
    };
    let (start, end) = (parse(from)?, parse(to)?);
    if end <= start {
        return Ok(None);
    }
    let truncated = end
        .with_nanosecond(0)
        .ok_or_else(|| "VALIDATION: radar bitişi aralık dışı".to_string())?;
    let inclusive = if truncated == end {
        end.checked_sub_signed(chrono::Duration::seconds(1))
            .ok_or_else(|| "VALIDATION: radar bitişi aralık dışı".to_string())?
    } else {
        truncated
    };
    if inclusive < start.with_nanosecond(0).unwrap_or(start) {
        return Ok(None);
    }
    Ok(Some(inclusive.to_rfc3339()))
}

#[cfg(test)]
mod tests {
    use super::inclusive_radar_end;
    use crate::services::staff360::suspicious_service::radar;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::SqlitePool;

    #[test]
    fn yerel_bugun_gece_yarisinda_degisir() {
        let at = |text: &str| {
            chrono::DateTime::parse_from_rfc3339(text)
                .expect("tarih")
                .with_timezone(&chrono::Utc)
        };
        // Yerel 23:59:59 hâlâ 10 Kasım, 00:00:00 11 Kasım.
        assert_eq!(
            super::local_today(at("2026-11-10T20:59:59Z"), 180),
            "2026-11-10"
        );
        assert_eq!(
            super::local_today(at("2026-11-10T21:00:00Z"), 180),
            "2026-11-11"
        );
    }

    async fn overdue_count(due: &str, today: &str) -> i64 {
        let pool = pool_with_base_orders().await;
        sqlx::raw_sql("INSERT INTO directories (id, tenant_id, name, type, credit_limit_cents) VALUES ('dir_v', 'tnt_a', 'Müşteri', 'CUSTOMER', 0)")
            .execute(&pool)
            .await
            .expect("cari");
        sqlx::query("INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents, remaining_amount_cents, status, is_cash, due_date) VALUES ('dbt_v', 'tnt_a', 'dir_v', 'GIVEN', 1000, 1000, 'PENDING', 0, ?)")
            .bind(due)
            .execute(&pool)
            .await
            .expect("borç");
        let alerts = super::operation_alerts(&pool, "tnt_a", today)
            .await
            .expect("uyarılar");
        alerts
            .iter()
            .filter(|item| item.title.contains("vadesi geçti"))
            .count() as i64
    }

    #[tokio::test]
    async fn vade_dun_gecti_bugun_ve_yarin_gecmedi() {
        assert_eq!(overdue_count("2026-11-09", "2026-11-10").await, 1);
        assert_eq!(overdue_count("2026-11-10", "2026-11-10").await, 0);
        assert_eq!(overdue_count("2026-11-11", "2026-11-10").await, 0);
        // Gece yarısı yerel gün değişince dünün vadesi geçmiş olur.
        assert_eq!(overdue_count("2026-11-10", "2026-11-11").await, 1);
    }

    const EKIM_BASI: &str = "2026-10-01T00:00:00+03:00";
    const KASIM_BASI: &str = "2026-11-01T00:00:00+03:00";

    #[test]
    fn radar_icin_son_dahil_saniyeyi_ve_bos_araligi_guvenle_donusturur() {
        assert_eq!(
            inclusive_radar_end(EKIM_BASI, KASIM_BASI).expect("tarih araligi"),
            Some("2026-10-31T23:59:59+03:00".to_string())
        );
        assert_eq!(
            inclusive_radar_end(KASIM_BASI, KASIM_BASI).expect("bos aralik"),
            None
        );
        assert_eq!(
            inclusive_radar_end(KASIM_BASI, EKIM_BASI).expect("ters aralik"),
            None
        );
        assert_eq!(
            inclusive_radar_end("2026-11-01T00:00:00+03:00", "2026-11-01T00:00:01+03:00")
                .expect("bir saniye"),
            Some("2026-11-01T00:00:00+03:00".to_string())
        );
        assert!(inclusive_radar_end("bozuk", KASIM_BASI).is_err());
    }

    #[test]
    fn kesirli_bitis_o_saniyedeki_kaydi_disarida_birakmaz() {
        assert_eq!(
            inclusive_radar_end("2026-11-01T00:00:00+03:00", "2026-11-01T00:00:00.500+03:00")
                .expect("kesirli bitis"),
            Some("2026-11-01T00:00:00+03:00".to_string())
        );
    }

    async fn pool_with_base_orders() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .in_memory(true)
                    .foreign_keys(true),
            )
            .await
            .expect("havuz");
        sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("şema");
        // 5 sipariş, 1 iptal (%20): eşik altı. Sınır siparişi iptal olarak eklenince
        // yalnız içerideyse 2/6 (%33) eşiği aşar; bayrak = sınır kaydı kapsama girdi.
        sqlx::raw_sql(
            "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
             INSERT INTO tables (id, tenant_id, name, status) VALUES ('tbl_1', 'tnt_a', 'Masa 1', 'AVAILABLE');
             INSERT INTO users (id, tenant_id, role, name) VALUES ('usr_1', 'tnt_a', 'CASHIER', 'Ayşe');
             INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at, cashier_id) VALUES
               ('ord_1','tnt_a','tbl_1','PAID',100,'2026-10-10 10:00:00','usr_1'),
               ('ord_2','tnt_a','tbl_1','PAID',100,'2026-10-11 10:00:00','usr_1'),
               ('ord_3','tnt_a','tbl_1','PAID',100,'2026-10-12 10:00:00','usr_1'),
               ('ord_4','tnt_a','tbl_1','PAID',100,'2026-10-13 10:00:00','usr_1'),
               ('ord_5','tnt_a','tbl_1','VOID',100,'2026-10-14 10:00:00','usr_1'),
               ('ord_6','tnt_a','tbl_1','PAID',100,'2026-11-03 10:00:00','usr_1'),
               ('ord_7','tnt_a','tbl_1','PAID',100,'2026-11-04 10:00:00','usr_1'),
               ('ord_8','tnt_a','tbl_1','PAID',100,'2026-11-05 10:00:00','usr_1'),
               ('ord_9','tnt_a','tbl_1','PAID',100,'2026-11-06 10:00:00','usr_1'),
               ('ord_10','tnt_a','tbl_1','VOID',100,'2026-11-07 10:00:00','usr_1');",
        )
        .execute(&pool)
        .await
        .expect("kayıt");
        pool
    }

    /// Sınır kaydı pano aralığına girdiyse radar bayrağı üretir.
    async fn boundary_counted(created_at: &str, from: &str, to: &str) -> bool {
        let pool = pool_with_base_orders().await;
        sqlx::query(
            "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at, cashier_id)
             VALUES ('ord_edge','tnt_a','tbl_1','VOID',100,?1,'usr_1')",
        )
        .bind(created_at)
        .execute(&pool)
        .await
        .expect("sınır kaydı");
        let Some(radar_to) = inclusive_radar_end(from, to).expect("dönüşüm") else {
            return false;
        };
        let flags = radar(&pool, "tnt_a", from, &radar_to).await.expect("radar");
        flags
            .iter()
            .any(|flag| flag.detail == "2 iptal / 6 siparis")
    }

    #[tokio::test]
    async fn radar_sinirlari_gercek_saniye_hassasiyetinde_ve_yari_acik_calisir() {
        // Yerel 23:59:59 ay içindedir (UTC 20:59:59).
        assert!(boundary_counted("2026-10-31 20:59:59", EKIM_BASI, KASIM_BASI).await);
        // Yerel 23:59:59.500: datetime() saniyeye kırpar, içeride kalır.
        assert!(boundary_counted("2026-10-31T20:59:59.500Z", EKIM_BASI, KASIM_BASI).await);
        // Ertesi gün yerel 00:00:00 yarı açık bitişte dışarıdadır; kesirli de dışarıdadır.
        assert!(!boundary_counted("2026-10-31 21:00:00", EKIM_BASI, KASIM_BASI).await);
        assert!(!boundary_counted("2026-10-31T21:00:00.250Z", EKIM_BASI, KASIM_BASI).await);
        assert!(!boundary_counted("2026-11-01T00:00:00+03:00", EKIM_BASI, KASIM_BASI).await);
        // Başlangıç dahildir, bir saniye öncesi değildir.
        assert!(boundary_counted("2026-09-30 21:00:00", EKIM_BASI, KASIM_BASI).await);
        assert!(!boundary_counted("2026-09-30 20:59:59", EKIM_BASI, KASIM_BASI).await);
    }

    #[tokio::test]
    async fn acik_ay_bugune_kadar_bos_ve_ters_aralik_sorgusuz_kalir() {
        // Açık ay: bitiş yarının 00:00'ıdır; bugün 23:59:59 dahil, yarın 00:00:00 hariç.
        let open_to = "2026-11-11T00:00:00+03:00";
        assert!(boundary_counted("2026-11-10 20:59:59", KASIM_BASI, open_to).await);
        assert!(!boundary_counted("2026-11-10 21:00:00", KASIM_BASI, open_to).await);
        // Boş ve ters aralık radara hiç gitmez.
        assert!(!boundary_counted("2026-11-01 10:00:00", KASIM_BASI, KASIM_BASI).await);
        assert!(!boundary_counted("2026-11-01 10:00:00", KASIM_BASI, EKIM_BASI).await);
    }
}
