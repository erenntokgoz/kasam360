//! Kâr/zarar dönem sınırı testleri: yerel gün sınırı ve defterin işlem zamanı.
//!
//! Ayrı dosya: ana P&L test dosyası başka değişikliklerle paylaşılıyor.

use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::pnl_service::financial_report_at;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");
const TENANT: &str = "tenant_a";
/// Türkiye saati: UTC+3.
const OFFSET: i64 = 180;

async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(SCHEMA)
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    pool
}

async fn sale(pool: &sqlx::SqlitePool, id: &str, utc_created_at: &str, total: i64, cogs: i64) {
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at)
         VALUES (?, ?, 'tbl_1', 'PAID', ?, ?)",
    )
    .bind(id)
    .bind(TENANT)
    .bind(total)
    .bind(utc_created_at)
    .execute(pool)
    .await
    .expect("sipariş");
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");
    // Defter zamanı yerel RFC 3339; `created_at` ise yazma anıdır (burada hep "şimdi").
    let local = chrono::DateTime::parse_from_str(
        &format!("{utc_created_at} +0000"),
        "%Y-%m-%d %H:%M:%S %z",
    )
    .expect("tarih")
    .with_timezone(&chrono::FixedOffset::east_opt(3 * 3600).expect("ofset"))
    .to_rfc3339();
    let ctx = AuditContext::new(
        TENANT.to_string(),
        "usr_1".to_string(),
        "OWNER".to_string(),
        category::ODEME,
        "payment:settled_fifo",
        format!("txn_{id}"),
        serde_json::json!({ "totalAmount": total, "cogsTotalCents": cogs, "orderClosed": true }),
        local,
    )
    .expect("bağlam");
    AuditService::append(&mut conn, &lock, &ctx)
        .await
        .expect("defter");
}

fn month(from: &str, to: &str) -> Option<(String, String)> {
    Some((from.to_string(), to.to_string()))
}

#[tokio::test]
async fn ay_siniri_yerel_geceyarisina_gore_ayrilir() {
    let p = pool().await;
    sqlx::raw_sql("PRAGMA foreign_keys = OFF;")
        .execute(&p)
        .await
        .expect("fk");
    // Yerel 31 Ekim 23:59:59 ve 1 Kasım 00:00:00 (UTC 20:59:59 / 21:00:00).
    sale(&p, "ord_oct", "2026-10-31 20:59:59", 5_000, 1_000).await;
    sale(&p, "ord_nov", "2026-10-31 21:00:00", 7_000, 2_000).await;

    let october = financial_report_at(&p, TENANT, &month("2026-10-01", "2026-10-31"), OFFSET)
        .await
        .expect("ekim");
    assert_eq!(october.total_sales_revenue_cents, 5_000);
    assert_eq!(october.total_cogs_cents, 1_000);

    let november = financial_report_at(&p, TENANT, &month("2026-11-01", "2026-11-30"), OFFSET)
        .await
        .expect("kasım");
    assert_eq!(
        november.total_sales_revenue_cents, 7_000,
        "00:00:00 Kasım'dır"
    );
    assert_eq!(november.total_cogs_cents, 2_000);
}

#[tokio::test]
async fn cogs_defterin_islem_zamanini_kullanir_yazma_anini_degil() {
    let p = pool().await;
    sqlx::raw_sql("PRAGMA foreign_keys = OFF;")
        .execute(&p)
        .await
        .expect("fk");
    // Eski satış bugün eşitlenmiş gibi yazıldı: `created_at` şimdi, işlem zamanı Ağustos.
    sale(&p, "ord_aug", "2026-08-10 09:00:00", 9_000, 3_000).await;

    let august = financial_report_at(&p, TENANT, &month("2026-08-01", "2026-08-31"), OFFSET)
        .await
        .expect("ağustos");
    assert_eq!(august.total_cogs_cents, 3_000);
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let now = financial_report_at(&p, TENANT, &month(&today, &today), OFFSET)
        .await
        .expect("bugün");
    assert_eq!(now.total_cogs_cents, 0, "yazma anı dönemi belirlemez");
}

#[tokio::test]
async fn aylik_trend_yerel_aya_gore_kovalanir() {
    let p = pool().await;
    sqlx::raw_sql("PRAGMA foreign_keys = OFF;")
        .execute(&p)
        .await
        .expect("fk");
    sale(&p, "ord_oct", "2026-10-31 20:59:59", 5_000, 0).await;
    sale(&p, "ord_nov", "2026-10-31 21:00:00", 7_000, 0).await;

    let report = financial_report_at(&p, TENANT, &None, OFFSET)
        .await
        .expect("tüm zaman");
    let revenue = |label: &str| {
        report
            .monthly_trend
            .iter()
            .find(|row| row.month == label)
            .map(|row| row.revenue_cents)
    };
    assert_eq!(revenue("2026-10"), Some(5_000));
    assert_eq!(revenue("2026-11"), Some(7_000));
}

#[tokio::test]
async fn gider_yerel_gune_gore_ayrilir_saatsiz_tarih_oldugu_gibi_kalir() {
    let p = pool().await;
    // Saatli gider UTC anıdır (yerel 1 Kasım 00:30); saatsiz elle girilen gider yerel gündür.
    for (id, when, amount) in [
        ("exp_gece", "2026-10-31 21:30:00", 1_000_i64),
        ("exp_elle", "2026-10-31", 2_000),
    ] {
        sqlx::query("INSERT INTO general_expenses (id, tenant_id, category, amount_cents, payment_method, actor_id, expense_date, created_at) VALUES (?, ?, 'RENT', ?, 'CASH', 'usr_1', ?, ?)")
            .bind(id)
            .bind(TENANT)
            .bind(amount)
            .bind(when)
            .bind(when)
            .execute(&p)
            .await
            .expect("gider");
    }
    let october = financial_report_at(&p, TENANT, &month("2026-10-01", "2026-10-31"), OFFSET)
        .await
        .expect("ekim");
    assert_eq!(october.total_expenses_cents, 2_000);
    let november = financial_report_at(&p, TENANT, &month("2026-11-01", "2026-11-30"), OFFSET)
        .await
        .expect("kasım");
    assert_eq!(november.total_expenses_cents, 1_000);
}

#[tokio::test]
async fn gecersiz_tarih_sessizce_bos_donmez() {
    let p = pool().await;
    let bozuk = financial_report_at(&p, TENANT, &month("ay-basi", "2026-10-31"), OFFSET).await;
    assert!(bozuk.is_err());
}
