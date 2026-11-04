//! Elle tarife: tek açık tarife, kapsam, yuvarlama ve eklenmiş kalemin korunması.

use crate::services::inventory360::pricing::{
    active_tariff, delete_tariff, effective_price, save_tariff, set_active_tariff, PriceSource,
    TariffInput, TariffSchedule,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

const T: &str = "tnt_a";

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().in_memory(true))
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents) VALUES
            ('prd_1', 'tnt_a', 'cat_1', 'Çay', 1000), ('prd_2', 'tnt_a', 'cat_1', 'Tost', 3333);",
    )
    .execute(&pool)
    .await
    .expect("veri");
    pool
}

fn input(name: &str, kind: &str, percent: i64, products: Option<Vec<&str>>) -> TariffInput {
    TariffInput {
        id: None,
        name: name.to_string(),
        kind: kind.to_string(),
        percent,
        product_ids: products.map(|ids| ids.into_iter().map(str::to_string).collect()),
        schedule: None,
    }
}

async fn price(pool: &SqlitePool, product: &str) -> (i64, PriceSource) {
    let mut conn = pool.acquire().await.expect("bağlantı");
    let result = effective_price(&mut conn, T, product, None)
        .await
        .expect("fiyat");
    (result.final_price_cents, result.source)
}

#[tokio::test]
async fn kapali_tarife_fiyati_degistirmez_acilinca_tum_urunlere_uygulanir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = save_tariff(
        &mut conn,
        T,
        "usr_1",
        input("Canlı müzik", "CANLI_MUZIK", 20, None),
    )
    .await
    .expect("kayıt");
    drop(conn);
    assert_eq!(
        price(&pool, "prd_1").await,
        (1000, PriceSource::ProductPrice)
    );

    let mut conn = pool.acquire().await.expect("bağlantı");
    set_active_tariff(&mut conn, T, "usr_1", Some(&id))
        .await
        .expect("aç");
    drop(conn);
    assert_eq!(price(&pool, "prd_1").await, (1200, PriceSource::Tariff));
    // 3333 * 1,2 = 3999,6: kuruşun altı müşteri lehine atılır.
    assert_eq!(price(&pool, "prd_2").await, (3999, PriceSource::Tariff));

    let mut conn = pool.acquire().await.expect("bağlantı");
    set_active_tariff(&mut conn, T, "usr_1", None)
        .await
        .expect("kapat");
    drop(conn);
    assert_eq!(
        price(&pool, "prd_1").await,
        (1000, PriceSource::ProductPrice)
    );
}

#[tokio::test]
async fn secili_urun_indirimi_digerine_dokunmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = save_tariff(
        &mut conn,
        T,
        "usr_1",
        input("Gündüz", "GUNDUZ", -10, Some(vec!["prd_1"])),
    )
    .await
    .expect("kayıt");
    set_active_tariff(&mut conn, T, "usr_1", Some(&id))
        .await
        .expect("aç");
    drop(conn);
    assert_eq!(price(&pool, "prd_1").await, (900, PriceSource::Tariff));
    assert_eq!(
        price(&pool, "prd_2").await,
        (3333, PriceSource::ProductPrice)
    );
}

#[tokio::test]
async fn ayni_anda_tek_tarife_acik_kalir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let day = save_tariff(&mut conn, T, "usr_1", input("Gündüz", "GUNDUZ", -10, None))
        .await
        .expect("kayıt");
    let night = save_tariff(&mut conn, T, "usr_1", input("Gece", "GECE", 15, None))
        .await
        .expect("kayıt");
    set_active_tariff(&mut conn, T, "usr_1", Some(&day))
        .await
        .expect("aç");
    set_active_tariff(&mut conn, T, "usr_1", Some(&night))
        .await
        .expect("geç");
    let active = active_tariff(&mut conn, T)
        .await
        .expect("okuma")
        .expect("açık");
    assert_eq!(active.id, night);
    let direct = sqlx::query("UPDATE price_tariffs SET is_active = 1 WHERE id = ?")
        .bind(&day)
        .execute(&mut *conn)
        .await;
    assert!(direct.is_err(), "indeks ikinci açık tarifeyi reddeder");
}

#[tokio::test]
async fn acik_tarife_duzenlenemez_ve_silinemez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = save_tariff(&mut conn, T, "usr_1", input("Gece", "GECE", 15, None))
        .await
        .expect("kayıt");
    set_active_tariff(&mut conn, T, "usr_1", Some(&id))
        .await
        .expect("aç");
    let mut changed = input("Gece", "GECE", 50, None);
    changed.id = Some(id.clone());
    let error = save_tariff(&mut conn, T, "usr_1", changed)
        .await
        .unwrap_err();
    assert!(error.starts_with("CONFLICT"), "{error}");
    let error = delete_tariff(&mut conn, T, &id).await.unwrap_err();
    assert!(error.starts_with("CONFLICT"), "{error}");
}

#[tokio::test]
async fn gecersiz_oran_tur_ve_baska_isletme_urunu_reddedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    for bad in [
        input("A", "GECE", 0, None),
        input("A", "GECE", -91, None),
        input("A", "GECE", 201, None),
        input("A", "HAFTASONU", 10, None),
        input(" ", "GECE", 10, None),
        input("A", "GECE", 10, Some(vec!["prd_yok"])),
    ] {
        assert!(save_tariff(&mut conn, T, "usr_1", bad).await.is_err());
    }
    let id = save_tariff(&mut conn, T, "usr_1", input("Gece", "GECE", 15, None))
        .await
        .expect("kayıt");
    assert!(set_active_tariff(&mut conn, "tnt_b", "usr_1", Some(&id))
        .await
        .is_err());
}

#[tokio::test]
async fn fiyat_dondurma_tarifeden_gucludur() {
    let pool = pool().await;
    sqlx::query(
        "INSERT INTO price_freezes (id, tenant_id, product_id, frozen_price_cents, valid_from, valid_to, is_active, created_by)
         VALUES ('frz_1', 'tnt_a', 'prd_1', 777, '2000-01-01', '2999-01-01', 1, 'usr_1')",
    )
    .execute(&pool)
    .await
    .expect("dondurma");
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = save_tariff(&mut conn, T, "usr_1", input("Gece", "GECE", 15, None))
        .await
        .expect("kayıt");
    set_active_tariff(&mut conn, T, "usr_1", Some(&id))
        .await
        .expect("aç");
    drop(conn);
    assert_eq!(price(&pool, "prd_1").await, (777, PriceSource::Frozen));
}

fn at(text: &str) -> chrono::DateTime<chrono::Local> {
    use chrono::TimeZone;
    let naive = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").expect("tarih");
    chrono::Local
        .from_local_datetime(&naive)
        .earliest()
        .expect("yerel saat")
}

#[tokio::test]
async fn zamanli_tarife_gece_yarisini_asar_ve_durdurulabilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let mut draft = input("Cuma gecesi", "OZEL", 20, None);
    let mut plan = TariffSchedule {
        enabled: true,
        start_time: Some("22:00".into()),
        end_time: Some("02:00".into()),
        days_of_week: vec![5],
        ..Default::default()
    };
    draft.schedule = Some(plan.clone());
    let id = save_tariff(&mut conn, T, "usr_1", draft)
        .await
        .expect("kayıt");

    // 2026-11-06 Cuma; Cumartesi 01:00 hâlâ Cuma gecesidir.
    for (time, cents) in [
        ("2026-11-06 21:59", 1000),
        ("2026-11-06 23:00", 1200),
        ("2026-11-07 01:00", 1200),
        ("2026-11-07 23:00", 1000),
    ] {
        let price = effective_price(&mut conn, T, "prd_1", Some(at(time)))
            .await
            .expect("fiyat");
        assert_eq!(price.final_price_cents, cents, "{time}");
    }

    plan.enabled = false;
    let mut paused = input("Cuma gecesi", "OZEL", 20, None);
    paused.id = Some(id);
    paused.schedule = Some(plan);
    save_tariff(&mut conn, T, "usr_1", paused)
        .await
        .expect("durdur");
    let price = effective_price(&mut conn, T, "prd_1", Some(at("2026-11-06 23:00")))
        .await
        .expect("fiyat");
    assert_eq!(price.final_price_cents, 1000);
}
