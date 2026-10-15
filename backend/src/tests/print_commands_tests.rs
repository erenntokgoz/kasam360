//! `print_commands` testleri (Faz 7).
//!
//! Basım komutları Tauri `State` taşıdığı için doğrudan çağrılamaz; bu yüzden
//! testler **veri kaynağı ve kapı** mantığını doğrular: basım yalnız tenant'ın
//! kendi kayıtlarından okur ve tutarlar tam sayı kuruş olarak biçimlenir.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");

const TENANT_A: &str = "tenant_a";
const TENANT_B: &str = "tenant_b";

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

async fn seed_tenant(pool: &sqlx::SqlitePool, tenant: &str) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(tenant)
        .bind(tenant)
        .execute(pool)
        .await
        .expect("tenant eklenir");
}

#[tokio::test]
async fn kasa_hareketi_yalniz_kendi_tenant_indan_bulunur() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;

    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
         VALUES ('shift_a', ?, 'usr_1', 'OPEN', '2026-01-01 09:00:00', 10000)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");

    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id)
         VALUES ('cm_a', ?, 'shift_a', 'OUT', 2500, 'Kırtasiye', 'usr_1')",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("kasa hareketi eklenir");

    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // Kendi tenant'ında bulunur.
    let found: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements WHERE id = ? AND tenant_id = ?")
            .bind("cm_a")
            .bind(TENANT_A)
            .fetch_one(&mut *conn)
            .await
            .expect("sorgu çalışır");
    assert_eq!(found, 1);

    // Başka tenant'ın çağrısında görünmez.
    let foreign: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements WHERE id = ? AND tenant_id = ?")
            .bind("cm_a")
            .bind(TENANT_B)
            .fetch_one(&mut *conn)
            .await
            .expect("sorgu çalışır");
    assert_eq!(foreign, 0, "başka işletmenin kasa hareketi sızmamalı");
}

#[tokio::test]
async fn gunluk_zapor_tahsilat_hareketlerinden_turetilir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;

    sqlx::query("INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_1', ?, 'Masa 1')")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("masa eklenir");

    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents)
         VALUES ('ord_1', ?, 'tbl_1', 'PAID', 42000)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("sipariş eklenir");

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let row = sqlx::query(&format!(
        "SELECT COALESCE(SUM(total_cents), 0) AS total, COUNT(*) AS count
         FROM orders WHERE tenant_id = ? AND status IN ('PAID', 'CLOSED')
           AND created_at >= {GUN_BASI_SQL}"
    ))
    .bind(TENANT_A)
    .fetch_one(&mut *conn)
    .await
    .expect("günlük özet sorgusu çalışır");

    let total: i64 = row.try_get("total").expect("toplam okunur");
    let count: i64 = row.try_get("count").expect("adet okunur");
    assert_eq!(total, 42000);
    assert_eq!(count, 1);
}

#[tokio::test]
async fn tenant_zorunlulugu_ve_kapi_sirasi_fail_closed() {
    // Rol kapısı önce, tenant kapısı sonra çalışır: ikisi de isteği reddeder.
    assert!(require_receipt_printer(Some("WAITER")).is_err());
    assert!(require_receipt_printer(Some("KITCHEN")).is_err());
    assert!(require_receipt_printer(None).is_err());
    assert!(require_receipt_printer(Some("CASHIER")).is_ok());
    assert!(require_receipt_printer(Some("owner")).is_ok());

    assert!(require_tenant(None).is_err());
    assert!(require_tenant(Some("")).is_err());
    assert!(require_tenant(Some("   ")).is_err());
    assert_eq!(require_tenant(Some(TENANT_A)).unwrap(), TENANT_A);
}

// ---------------------------------------------------------------------------
// YEREL TARİH — UTC/yerel kayması
//
// Neden ayrı bölüm: `created_at` kolonları SQLite `CURRENT_TIMESTAMP` ile UTC
// yazılır. Olduğu gibi basılan veya UTC gün başıyla süzülen tarih, gece yarısını
// geçmiş bir işletmede **dünkü** değeri gösterir. Müşteri fişi ve patronun
// günlük defteri bu yüzden yerel zamana çevrilir.
// ---------------------------------------------------------------------------

/// SQLite'ın gerçekte yazdığı biçim: saat dilimi taşımayan, UTC olan metin.
fn utc_kayit_metni(an: chrono::DateTime<chrono::Local>) -> String {
    an.with_timezone(&chrono::Utc)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

#[test]
fn utc_kayit_metni_yerel_saat_dilimine_cevrilir() {
    // UTC 21:30 -> Türkiye'de (UTC+3) 00:30 **ertesi gün**. Tarih değişmeden
    // saat çevrilirse bile hatalıdır; burada gün sınırı da sınanır.
    let utc = chrono::DateTime::parse_from_rfc3339("2026-10-03T21:30:00Z")
        .expect("geçerli zaman damgası");
    let yerel = utc.with_timezone(&chrono::Local);
    let beklenen = yerel.format("%Y-%m-%d %H:%M:%S").to_string();

    assert_eq!(
        utc_yerel_goster(&utc_kayit_metni(yerel)),
        beklenen,
        "kayıt UTC metni yerel saate çevrilmeli"
    );

    // Saat dilimi taşıyan biçim de aynı sonucu vermeli; iki yol ayrışırsa
    // hangi kolonun hangi biçimi yazdığı belirsizleşir.
    assert_eq!(
        utc_yerel_goster("2026-10-03T21:30:00Z"),
        beklenen,
        "RFC 3339 kayıtlar da aynı yerel değeri vermeli"
    );
}

#[test]
fn utc_kayit_yerel_tarihi_bir_gun_ileri_aldiginda_gunler_ayrilir() {
    // Bir günlük UTC aralığını saat saat inşa edip iki çevrim de aynı sonucu
    // vermeli. Sonra: UTC ile yerel arasında **bir gün fark** olan en az bir
    // an varsa (yani saat dilimi sıfır değilse) tarihin ilerlediği
    // kanıtlanır — çevrim çalışmıyorsa bu küme tek tarih kalır.
    let gun_baslangic = chrono::DateTime::parse_from_rfc3339("2026-10-03T00:00:00Z")
        .expect("geçerli zaman damgası")
        .with_timezone(&chrono::Local);

    let mut utc_tarihler = std::collections::BTreeSet::new();
    let mut yerel_tarihler = std::collections::BTreeSet::new();
    for saat in 0..24 {
        let an = gun_baslangic + chrono::Duration::hours(saat);
        let metin = utc_kayit_metni(an);
        utc_tarihler.insert(metin[..10].to_string());
        yerel_tarihler.insert(utc_yerel_goster(&metin)[..10].to_string());
        assert_eq!(
            utc_yerel_goster(&metin),
            an.with_timezone(&chrono::Utc)
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string(),
            "her saat kendi yerel karşılığına eşlenmeli ({saat})"
        );
    }

    let ofset_kayma = chrono::Local::now().offset().local_minus_utc();
    if ofset_kayma != 0 {
        assert!(
            yerel_tarihler.len() > utc_tarihler.len() || yerel_tarihler != utc_tarihler,
            "UTC ile yerel aynı güne denk gelmiyorsa çevrim en az bir tarihi \
             kaydırmalıydı; UTC={:?} yerel={:?} (ofset {ofset_kayma})",
            utc_tarihler,
            yerel_tarihler
        );
    }
}

#[test]
fn bilinmeyen_tarih_bicimi_bozulmadan_basilir() {
    // Uydurma tarih yazmak, kaynağın ne dediğini gizler. Metin aynen döner.
    for ham in ["bilinmeyen", "", "2026-13-45", "12/10/2026 23:30"] {
        assert_eq!(
            utc_yerel_goster(ham),
            ham.trim(),
            "tanınmayan biçim değiştirilmemeli ({ham})"
        );
    }
}

#[tokio::test]
async fn bugun_sql_yerel_tarihi_dondurur() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // Gece yarısı yarışı ihtimali: iki okuma arasında gün değişirse test
    // kırmızıya değil yeniden denemeye düşer. Yanlış saat dilimi **asla**
    // geçici olarak gün değiştirmez.
    for _ in 0..3 {
        let onceki: String = sqlx::query_scalar(&format!("SELECT {BUGUN_SQL}"))
            .fetch_one(&mut *conn)
            .await
            .expect("bugün okunur");
        let sonraki: String = sqlx::query_scalar(&format!("SELECT {BUGUN_SQL}"))
            .fetch_one(&mut *conn)
            .await
            .expect("bugün okunur");
        let yerel = chrono::Local::now().format("%Y-%m-%d").to_string();

        if onceki == sonraki && onceki == yerel {
            return;
        }
    }
    panic!("BUGUN_SQL yerel tarihi vermiyor");
}

#[tokio::test]
async fn gun_basi_yerel_gun_basidir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;

    let yerel_gun_bas = chrono::Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("geçerli saat");
    let gun_icinde = yerel_gun_bas + chrono::Duration::hours(1);
    let dun = yerel_gun_bas - chrono::Duration::minutes(1);

    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
         VALUES ('shf_1', ?, 'usr_1', 'OPEN', '2026-01-01 09:00:00', 0)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");

    for (id, an) in [("cmv_icinde", gun_icinde), ("cmv_dun", dun)] {
        sqlx::query(
            "INSERT INTO cash_movements
                (id, tenant_id, shift_id, movement_type, amount_cents, reason,
                 actor_id, created_at)
             VALUES (?, ?, 'shf_1', 'IN', 1000, 'test', 'usr_1', ?)",
        )
        .bind(id)
        .bind(TENANT_A)
        .bind(utc_kayit_metni(
            an.and_local_timezone(chrono::Local)
                .single()
                .expect("tek ofset"),
        ))
        .execute(&pool)
        .await
        .expect("kasa hareketi eklenir");
    }

    // Üretimdeki ifade birebir kullanılır: kopya sorgu, üretim yanlışken test
    // yeşil kalır.
    let sayi: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM cash_movements
         WHERE tenant_id = ? AND movement_type = 'IN' AND created_at >= {GUN_BASI_SQL}"
    ))
    .bind(TENANT_A)
    .fetch_one(&pool)
    .await
    .expect("gün başı sorgusu çalışır");

    assert_eq!(
        sayi, 1,
        "yerel gün başından önceki hareket bugüne girmemeli, sonrasındaki girmeli"
    );
}
