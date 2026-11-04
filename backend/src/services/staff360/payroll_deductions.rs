//! Bordro kesintileri: dönem avansları ve ücretsiz izin.
//!
//! Yasal kesinti (SGK, gelir vergisi, damga) burada yoktur: oranlar mevzuata bağlıdır ve
//! mali müşavir hesabının yerine geçmemelidir. Bordronun neti "yasal kesinti öncesi
//! ödenecek"tir.

use sqlx::SqliteConnection;

/// Türkiye bordro uygulamasındaki ay bölücü: ücretsiz izin günü aylık/30 kesilir.
const PAYROLL_MONTH_DAYS: i64 = 30;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Deductions {
    pub advance_cents: i64,
    pub unpaid_days: i64,
    pub unpaid_leave_cents: i64,
}

impl Deductions {
    pub fn total_cents(&self) -> i64 {
        self.advance_cents + self.unpaid_leave_cents
    }
}

/// Onaylı ücretsiz iznin dönemin içinde kalan gün sayısı.
async fn unpaid_days(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    from: &str,
    to: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(
             CAST(julianday(MIN(end_date, date(?4))) - julianday(MAX(start_date, date(?3))) AS INTEGER) + 1
         ), 0)
         FROM leave_requests
         WHERE tenant_id = ?1 AND user_id = ?2 AND kind = 'UCRETSIZ' AND status = 'Onaylandi'
           AND start_date <= date(?4) AND end_date >= date(?3)",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(from)
    .bind(to)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| format!("ücretsiz izin okunamadı: {e}"))
}

/// Kişi kartındaki dönem özeti: verilen avanslar ve dağıtılan bahşiş.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffMoneySummary {
    pub advances: Vec<StaffAdvance>,
    pub tip_cents: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffAdvance {
    pub id: String,
    pub expense_id: String,
    pub amount_cents: i64,
    pub created_at: String,
}

pub async fn money_summary(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    period: &str,
) -> Result<StaffMoneySummary, String> {
    let rows: Vec<(String, String, i64, String)> = sqlx::query_as(
        "SELECT id, expense_id, amount_cents, created_at FROM staff_advances
         WHERE tenant_id = ? AND user_id = ? AND period = ? ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(period)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| format!("avans okunamadı: {e}"))?;
    let tip_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM tip_distributions
         WHERE tenant_id = ? AND user_id = ? AND period = ?",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(period)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| format!("bahşiş okunamadı: {e}"))?;
    Ok(StaffMoneySummary {
        advances: rows
            .into_iter()
            .map(|(id, expense_id, amount_cents, created_at)| StaffAdvance {
                id,
                expense_id,
                amount_cents,
                created_at,
            })
            .collect(),
        tip_cents,
    })
}

/// Tarih aralığında dağıtılan bahşiş: günlük ve haftalık hakediş bunu okur.
pub async fn tips_between(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    from: &str,
    to: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM tip_distributions
         WHERE tenant_id = ? AND user_id = ? AND date(created_at) BETWEEN date(?) AND date(?)",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(from)
    .bind(to)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| format!("bahşiş okunamadı: {e}"))
}

pub async fn for_user(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    period: &str,
    from: &str,
    to: &str,
    base_salary_cents: i64,
    period_days: i64,
) -> Result<Deductions, String> {
    // Avans ay etiketi taşır; kısa dönemde etiket kullanılsa aynı avans her hesapta düşerdi.
    let advance_cents: i64 = if period_days == PAYROLL_MONTH_DAYS {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM staff_advances
             WHERE tenant_id = ? AND user_id = ? AND period = ?",
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(period)
        .fetch_one(&mut *conn)
        .await
    } else {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM staff_advances
             WHERE tenant_id = ? AND user_id = ? AND date(created_at) BETWEEN date(?) AND date(?)",
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(from)
        .bind(to)
        .fetch_one(&mut *conn)
        .await
    }
    .map_err(|e| format!("avans okunamadı: {e}"))?;
    let unpaid_days = unpaid_days(conn, tenant_id, user_id, from, to).await?;
    let unpaid_leave_cents = i64::try_from(
        i128::from(base_salary_cents) * i128::from(unpaid_days.min(period_days))
            / i128::from(period_days),
    )
    .map_err(|_| "OVERFLOW: izin kesintisi taştı".to_string())?;
    Ok(Deductions {
        advance_cents,
        unpaid_days,
        unpaid_leave_cents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn conn() -> sqlx::pool::PoolConnection<sqlx::Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("havuz");
        sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("şema");
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .expect("yabancı anahtar");
        pool.acquire().await.expect("bağlantı")
    }

    async fn leave(
        conn: &mut SqliteConnection,
        id: &str,
        kind: &str,
        from: &str,
        to: &str,
        status: &str,
    ) {
        sqlx::query(
            "INSERT INTO leave_requests
                 (id, tenant_id, user_id, kind, start_date, end_date, status, created_at)
             VALUES (?, 'tnt_a', 'usr_a', ?, ?, ?, ?, '2026-01-01')",
        )
        .bind(id)
        .bind(kind)
        .bind(from)
        .bind(to)
        .bind(status)
        .execute(&mut *conn)
        .await
        .expect("izin");
    }

    #[tokio::test]
    async fn ucretsiz_izin_yalniz_donem_icindeki_onayli_gun_kadar_kesilir() {
        let mut conn = conn().await;
        // Ay sınırını taşan izin: Ekim'e yalnız 2 gün düşer.
        leave(
            &mut conn,
            "lve_1",
            "UCRETSIZ",
            "2026-10-30",
            "2026-11-02",
            "Onaylandi",
        )
        .await;
        leave(
            &mut conn,
            "lve_2",
            "UCRETSIZ",
            "2026-10-10",
            "2026-10-11",
            "Bekliyor",
        )
        .await;
        leave(
            &mut conn,
            "lve_3",
            "YILLIK",
            "2026-10-12",
            "2026-10-13",
            "Onaylandi",
        )
        .await;
        let result = for_user(
            &mut conn,
            "tnt_a",
            "usr_a",
            "2026-10",
            "2026-10-01",
            "2026-10-31T23:59:59",
            3_000_000,
            30,
        )
        .await
        .expect("kesinti");
        assert_eq!(result.unpaid_days, 2);
        assert_eq!(result.unpaid_leave_cents, 200_000);
    }

    #[tokio::test]
    async fn avans_yalniz_kendi_donemi_ve_kiracisindan_duser() {
        let mut conn = conn().await;
        sqlx::raw_sql(
            "INSERT INTO staff_advances (id, tenant_id, user_id, period, amount_cents, expense_id, actor_id)
             VALUES ('adv_1', 'tnt_a', 'usr_a', '2026-10', 1500, 'exp_1', 'usr_a'),
                    ('adv_2', 'tnt_a', 'usr_a', '2026-09', 900, 'exp_2', 'usr_a'),
                    ('adv_3', 'tnt_b', 'usr_a', '2026-10', 700, 'exp_3', 'usr_a');",
        )
        .execute(&mut *conn)
        .await
        .expect("avans");
        let result = for_user(
            &mut conn,
            "tnt_a",
            "usr_a",
            "2026-10",
            "2026-10-01",
            "2026-10-31T23:59:59",
            0,
            30,
        )
        .await
        .expect("kesinti");
        assert_eq!(result.advance_cents, 1500);
        assert_eq!(result.total_cents(), 1500);
    }
}
