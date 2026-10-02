//! `branch_service` testleri.
//!
//! Bellek içi SQLite kullanılır; şema `include_str!("../../migrations/schema.sql")`
//! ile aynı dosyadan okunur (production ile ayrışmasın diye kopya şema yok).

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Sqlite;
use std::str::FromStr;

use super::*;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");

/// Bellek içi tek bağlantılı havuz. `PoolConnection<Sqlite>` servis
/// fonksiyonlarına (`&mut SqliteConnection`) otomatik açılır.
type TestConn = sqlx::pool::PoolConnection<Sqlite>;

async fn conn() -> TestConn {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    let mut handle = pool.acquire().await.expect("bağlantı alınır");
    sqlx::raw_sql(SCHEMA)
        .execute(&mut *handle)
        .await
        .expect("şema uygulanır");
    handle
}

async fn seed_tenant(conn: &mut TestConn, id: &str) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(id)
        .bind(id)
        .execute(&mut **conn)
        .await
        .expect("tenant eklenir");
}

#[tokio::test]
async fn sube_ekler_ve_prefexli_kimlik_doner() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;

    let branch = create(&mut conn, "tnt_a", "br_000000000001", "Kadıköy", Some("Moda Cad. 12"))
        .await
        .expect("şube eklenir");

    assert_eq!(branch.id, "br_000000000001");
    assert_eq!(branch.tenant_id, "tnt_a");
    assert_eq!(branch.status, ACTIVE_STATUS);
    assert_eq!(branch.address.as_deref(), Some("Moda Cad. 12"));
}

#[tokio::test]
async fn bos_ad_reddedilir() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;

    let err = create(&mut conn, "tnt_a", "br_x", "   ", None)
        .await
        .expect_err("boş ad kabul edilmemeli");
    assert!(err.contains("INVALID_ARGUMENT"), "beklenmeyen hata: {}", err);
}

#[tokio::test]
async fn ayni_isimli_aktif_sube_acilamaz() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;
    create(&mut conn, "tnt_a", "br_1", "Kadıköy", None).await.unwrap();

    let err = create(&mut conn, "tnt_a", "br_2", "Kadıköy", None)
        .await
        .expect_err("aynı isim kabul edilmemeli");
    assert!(err.contains("CONFLICT"), "beklenmeyen hata: {}", err);

    // Arşivlenen isim yeniden kullanılabilir: geçmiş kayıt satırı silinmedi.
    create(&mut conn, "tnt_a", "br_3", "Şişli", None).await.unwrap();
    archive(&mut conn, "tnt_a", "br_1").await.expect("Kadıköy arşivlenir");
    let again = create(&mut conn, "tnt_a", "br_4", "Kadıköy", None)
        .await
        .expect("arşivlenen isim yeniden kullanılabilir");
    assert_eq!(again.name, "Kadıköy");

    let archived = load(&mut conn, "tnt_a", "br_1").await.unwrap();
    assert_eq!(archived.status, ARCHIVED_STATUS, "geçmiş satır korunmalı");
}

#[tokio::test]
async fn liste_yalnizca_kendi_tenant_inin_subelerini_doner() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;
    seed_tenant(&mut conn, "tnt_b").await;
    create(&mut conn, "tnt_a", "br_a1", "Kadıköy", None).await.unwrap();
    create(&mut conn, "tnt_b", "br_b1", "Beşiktaş", None).await.unwrap();

    let branches = list(&mut conn, "tnt_a", false).await.unwrap();
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].id, "br_a1");
    assert_eq!(branches[0].tenant_id, "tnt_a");
}

#[tokio::test]
async fn baska_tenantin_subesi_okunamaz_guncellenemez_arsivlenemez() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;
    seed_tenant(&mut conn, "tnt_b").await;
    create(&mut conn, "tnt_b", "br_b1", "Beşiktaş", None).await.unwrap();

    assert!(load(&mut conn, "tnt_a", "br_b1").await.is_err());
    assert!(update(&mut conn, "tnt_a", "br_b1", Some("Çalınan"), None)
        .await
        .is_err());
    assert!(archive(&mut conn, "tnt_a", "br_b1").await.is_err());

    // Hedef tenant'ın şubesi değişmemiş olmalı.
    let untouched = load(&mut conn, "tnt_b", "br_b1").await.unwrap();
    assert_eq!(untouched.name, "Beşiktaş");
    assert_eq!(untouched.status, ACTIVE_STATUS);
}

#[tokio::test]
async fn arsivlenen_sube_listede_gorunmez_istendiginde_gorunur() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;
    create(&mut conn, "tnt_a", "br_1", "Kadıköy", None).await.unwrap();
    create(&mut conn, "tnt_a", "br_2", "Şişli", None).await.unwrap();
    archive(&mut conn, "tnt_a", "br_2").await.unwrap();

    let visible = list(&mut conn, "tnt_a", false).await.unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].id, "br_1");

    let all = list(&mut conn, "tnt_a", true).await.unwrap();
    assert_eq!(all.len(), 2);
}

#[tokio::test]
async fn son_aktif_sube_arsivlenemez() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;
    create(&mut conn, "tnt_a", "br_1", "Kadıköy", None).await.unwrap();

    let err = archive(&mut conn, "tnt_a", "br_1")
        .await
        .expect_err("son aktif şube arşivlenemeli");
    assert!(err.contains("CONFLICT"), "beklenmeyen hata: {}", err);
    assert_eq!(active_count(&mut conn, "tnt_a").await.unwrap(), 1);
}

#[tokio::test]
async fn iki_sube_varken_birisi_arsivlenebilir() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;
    create(&mut conn, "tnt_a", "br_1", "Kadıköy", None).await.unwrap();
    create(&mut conn, "tnt_a", "br_2", "Şişli", None).await.unwrap();

    let archived = archive(&mut conn, "tnt_a", "br_2").await.unwrap();
    assert_eq!(archived.status, ARCHIVED_STATUS);
    assert_eq!(active_count(&mut conn, "tnt_a").await.unwrap(), 1);

    // Aynı şube ikinci kez arşivlenemez.
    assert!(archive(&mut conn, "tnt_a", "br_2").await.is_err());
}

#[tokio::test]
async fn ad_gunceller_cakisma_yeniden_denetlenir() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;
    create(&mut conn, "tnt_a", "br_1", "Kadıköy", None).await.unwrap();
    create(&mut conn, "tnt_a", "br_2", "Şişli", None).await.unwrap();

    let err = update(&mut conn, "tnt_a", "br_2", Some("Kadıköy"), None)
        .await
        .expect_err("çakışan ad kabul edilmemeli");
    assert!(err.contains("CONFLICT"), "beklenmeyen hata: {}", err);

    let renamed = update(&mut conn, "tnt_a", "br_2", Some("Beşiktaş"), Some("Levent Cd. 3"))
        .await
        .unwrap();
    assert_eq!(renamed.name, "Beşiktaş");
    assert_eq!(renamed.address.as_deref(), Some("Levent Cd. 3"));
}

#[tokio::test]
async fn adres_verilmezse_korunur() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;
    create(&mut conn, "tnt_a", "br_1", "Kadıköy", Some("Moda Cad. 12")).await.unwrap();

    let updated = update(&mut conn, "tnt_a", "br_1", None, None).await.unwrap();
    assert_eq!(updated.name, "Kadıköy");
    assert_eq!(updated.address.as_deref(), Some("Moda Cad. 12"));
}

#[tokio::test]
async fn olmayan_sube_not_found_doner() {
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;

    let err = load(&mut conn, "tnt_a", "br_yok")
        .await
        .expect_err("olmayan şube hata vermeli");
    assert!(err.contains("NOT_FOUND"), "beklenmeyen hata: {}", err);
}

#[tokio::test]
async fn subeler_sql_de_tenant_filtresiyle_sorgulanir() {
    // Sorgu metni tenant filtresi taşımazsa liste sessizce tüm işletmeleri döner.
    let mut conn = conn().await;
    seed_tenant(&mut conn, "tnt_a").await;
    seed_tenant(&mut conn, "tnt_b").await;
    create(&mut conn, "tnt_a", "br_a1", "A Şubesi", None).await.unwrap();
    create(&mut conn, "tnt_b", "br_b1", "B Şubesi", None).await.unwrap();

    let raw: Vec<String> = sqlx::query_scalar("SELECT tenant_id FROM branches")
        .fetch_all(&mut *conn)
        .await
        .unwrap();
    assert_eq!(raw.len(), 2, "tablo iki tenant'a ait satır içermeli");

    let only_a = list(&mut conn, "tnt_a", true).await.unwrap();
    assert!(
        only_a.iter().all(|b| b.tenant_id == "tnt_a"),
        "tenant filtresi uygulanmadı"
    );
}