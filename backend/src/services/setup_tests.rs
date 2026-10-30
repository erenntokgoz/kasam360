//! Temiz kurulum, yarım kalan kurulum ve mevcut veritabanı yükseltmesi.

use super::*;
use crate::commands::{authenticate_by_pin, unlock_session};
use crate::db::init_db;
use crate::services::audit_service::AuditLock;
use tokio::sync::Mutex;

const PIN: &str = "4827";

fn file_url(label: &str) -> (std::path::PathBuf, String) {
    let dir = std::env::temp_dir().join(format!("kasam360_setup_{label}_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dizin");
    let path = dir.join("app.db");
    let url = format!("sqlite://{}", path.display());
    (path, url)
}

fn input(pin: &str) -> NewBusinessInput {
    NewBusinessInput {
        business_name: "Deniz Lokantası".to_string(),
        tax_id: "1234567890".to_string(),
        phone: String::new(),
        address: String::new(),
        owner_name: "Ayşe Yılmaz".to_string(),
        pin: pin.to_string(),
        pin_confirm: pin.to_string(),
    }
}

async fn finish(pool: &SqlitePool, pin: &str) -> Result<String, String> {
    let setup = input(pin);
    validate_owner_pin(&setup.pin, &setup.pin_confirm)?;
    let hash = crate::user_credentials::hash_pin(&setup.pin)?;
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let tenant = complete_new_business(&mut tx, &lock, &setup, &hash).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(tenant)
}

async fn count(pool: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_one(pool)
        .await
        .expect("sayım")
}

#[tokio::test]
async fn temiz_veritabani_is_kaydi_ve_fabrika_kullanicisi_acmaz() {
    let pool = init_db("sqlite::memory:").await.expect("veritabanı");
    assert_eq!(count(&pool, "users").await, 0);
    assert_eq!(count(&pool, "tenants").await, 0);
    assert_eq!(count(&pool, "categories").await, 0);
    assert!(require_complete(&pool).await.is_err());
    for pin in ["1111", "2222", "3333", "4444", "5555", "6666"] {
        assert!(
            authenticate_by_pin(&pool, pin, None).await.is_err(),
            "{pin} kurulum öncesi giriş açtı"
        );
    }
}

#[tokio::test]
async fn kurulum_owner_acar_pin_argon2_saklanir_yeniden_acilista_korunur() {
    let (_path, url) = file_url("yeni");
    let pool = init_db(&url).await.expect("veritabanı");
    let tenant = finish(&pool, PIN).await.expect("kurulum");
    let row: (String, String, i64) =
        sqlx::query_as("SELECT role, pin_hash, must_change_pin FROM users WHERE tenant_id = ?")
            .bind(&tenant)
            .fetch_one(&pool)
            .await
            .expect("sahip");
    assert_eq!(row.0, "OWNER");
    assert!(row.1.starts_with("$argon2id$"));
    assert_ne!(row.1, PIN);
    assert_eq!(row.2, 0, "kullanıcının seçtiği PIN yeniden sorulmaz");
    assert_eq!(count(&pool, "tenants").await, 1);
    assert_eq!(count(&pool, "tenant_modules").await, 6);
    assert_eq!(count(&pool, "categories").await, 1);
    assert_eq!(count(&pool, "audit_ledger").await, 1);
    pool.close().await;

    let reopened = init_db(&url).await.expect("yeniden açılış");
    assert_eq!(
        count(&reopened, "users").await,
        1,
        "fabrika hesabı eklenmez"
    );
    assert_eq!(count(&reopened, "tenants").await, 1);
    require_complete(&reopened).await.expect("kurulum kalıcı");
    let session = authenticate_by_pin(&reopened, PIN, None)
        .await
        .expect("giriş");
    assert_eq!(session.role, "OWNER");
    assert!(authenticate_by_pin(&reopened, "2222", None).await.is_err());
}

#[tokio::test]
async fn yarim_kalan_kurulum_taslakla_surer_ve_sir_saklamaz() {
    let (path, url) = file_url("yarim");
    let pool = init_db(&url).await.expect("veritabanı");
    let draft = SetupDraft {
        business_name: "Deniz".to_string(),
        owner_name: "Ayşe".to_string(),
        ..SetupDraft::default()
    };
    {
        let mut conn = pool.acquire().await.expect("bağlantı");
        save_draft(&mut conn, Some("NEW"), &draft)
            .await
            .expect("taslak");
    }
    pool.close().await;

    let reopened = init_db(&url).await.expect("yeniden açılış");
    let mut conn = reopened.acquire().await.expect("bağlantı");
    let state = load_state(&mut conn).await.expect("durum");
    assert_eq!(state.status, "PENDING");
    assert_eq!(state.mode.as_deref(), Some("NEW"));
    assert_eq!(state.draft, draft);
    assert!(save_draft(&mut conn, Some("BASKA"), &draft).await.is_err());
    drop(conn);
    assert_eq!(count(&reopened, "users").await, 0);
    let raw = std::fs::read(&path).expect("dosya");
    assert!(!raw.windows(4).any(|window| window == PIN.as_bytes()));
}

#[tokio::test]
async fn yarida_kesilen_kurulum_kayit_birakmaz_ikinci_tamamlama_reddedilir() {
    let pool = init_db("sqlite::memory:").await.expect("veritabanı");
    let setup = input(PIN);
    let hash = crate::user_credentials::hash_pin(PIN).expect("hash");
    let mutex = Mutex::new(());
    {
        let lock = AuditLock::new(mutex.lock().await);
        let mut tx = pool.begin().await.expect("tx");
        complete_new_business(&mut tx, &lock, &setup, &hash)
            .await
            .expect("kurulum");
        tx.rollback().await.expect("kesinti");
    }
    assert_eq!(count(&pool, "users").await, 0);
    assert_eq!(count(&pool, "tenants").await, 0);
    assert!(require_complete(&pool).await.is_err());

    finish(&pool, PIN).await.expect("yeniden deneme");
    assert_eq!(count(&pool, "tenants").await, 1);
    let second = finish(&pool, "7392").await.expect_err("ikinci kurulum");
    assert!(second.starts_with("CONFLICT"), "{second}");
    assert_eq!(count(&pool, "users").await, 1);
}

#[tokio::test]
async fn mevcut_isletme_yukseltmede_kuruluma_dusmez_ve_verisini_korur() {
    let (_path, url) = file_url("yukseltme");
    let pool = init_db(&url).await.expect("veritabanı");
    sqlx::raw_sql(
        "DELETE FROM app_setup;
         INSERT INTO tenants (id, name, status) VALUES ('tnt_eski', 'Kasam360 Merkez İşletme', 'ACTIVE');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_eski', 'tnt_eski', 'Ana');",
    )
    .execute(&pool)
    .await
    .expect("eski kayıtlar");
    let factory = crate::user_credentials::hash_pin("2222").expect("hash");
    let custom = crate::user_credentials::hash_pin("8351").expect("hash");
    for (id, hash) in [("usr_owner", &factory), ("usr_kendi", &custom)] {
        sqlx::query(
            "INSERT INTO users (id, tenant_id, role, name, pin_hash) VALUES (?, 'tnt_eski', 'OWNER', 'Patron', ?)",
        )
        .bind(id)
        .bind(hash)
        .execute(&pool)
        .await
        .expect("eski kullanıcı");
    }
    pool.close().await;

    let upgraded = init_db(&url).await.expect("yükseltme");
    require_complete(&upgraded).await.expect("kurulum sorulmaz");
    assert_eq!(count(&upgraded, "users").await, 2, "yeni hesap eklenmez");
    assert_eq!(count(&upgraded, "categories").await, 1);
    let tenant = crate::db::merkez_tenant_id(&upgraded)
        .await
        .expect("kiracı");
    assert_eq!(tenant, "tnt_eski");
    let forced: Vec<String> =
        sqlx::query_scalar("SELECT id FROM users WHERE must_change_pin = 1 ORDER BY id")
            .fetch_all(&upgraded)
            .await
            .expect("bayrak");
    assert_eq!(forced, vec!["usr_owner".to_string()]);
    let session = authenticate_by_pin(&upgraded, "8351", None)
        .await
        .expect("mevcut PIN çalışır");
    assert_eq!(session.tenant_id, "tnt_eski");
}

#[tokio::test]
async fn kullanicisiz_eski_kurulum_kiraciyi_devralir_ikinci_isletme_acmaz() {
    let (_path, url) = file_url("kiraci");
    let pool = init_db(&url).await.expect("veritabanı");
    sqlx::raw_sql(
        "DELETE FROM app_setup;
         INSERT INTO tenants (id, name, status) VALUES ('tnt_eski', 'Kasam360 Merkez İşletme', 'ACTIVE');",
    )
    .execute(&pool)
    .await
    .expect("eski kiracı");
    pool.close().await;

    let upgraded = init_db(&url).await.expect("yükseltme");
    assert!(require_complete(&upgraded).await.is_err());
    let tenant = finish(&upgraded, PIN).await.expect("kurulum");
    assert_eq!(tenant, "tnt_eski");
    assert_eq!(count(&upgraded, "tenants").await, 1);
}

#[tokio::test]
async fn kilit_yalniz_oturum_sahibinin_piniyle_acilir() {
    let pool = init_db("sqlite::memory:").await.expect("veritabanı");
    let tenant = finish(&pool, PIN).await.expect("kurulum");
    let other = crate::user_credentials::hash_pin("6194").expect("hash");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash) VALUES ('usr_baska', ?, 'CASHIER', 'Can', ?)",
    )
    .bind(&tenant)
    .bind(other)
    .execute(&pool)
    .await
    .expect("personel");
    let owner: String = sqlx::query_scalar("SELECT id FROM users WHERE role = 'OWNER'")
        .fetch_one(&pool)
        .await
        .expect("sahip");

    assert!(unlock_session(&pool, &tenant, &owner, "6194")
        .await
        .is_err());
    unlock_session(&pool, &tenant, &owner, PIN)
        .await
        .expect("kilit açılır");
    assert!(
        unlock_session(&pool, "tnt_baska", &owner, PIN)
            .await
            .is_err(),
        "başka kiracının oturumu açılmaz"
    );
    for _ in 0..5 {
        let _ = unlock_session(&pool, &tenant, &owner, "0000").await;
    }
    assert!(
        unlock_session(&pool, &tenant, &owner, PIN).await.is_err(),
        "beş hatadan sonra doğru PIN de beklemeli"
    );
}

/// Kaynak işletmeyi kurar ve katılım onayını üretir.
async fn grant_from(
    source: &SqlitePool,
    tenant: &str,
) -> crate::services::lan_sync::pairing::JoinGrant {
    sqlx::raw_sql(&format!(
        "INSERT INTO modifier_groups (id, tenant_id, name) VALUES ('grp_1', '{tenant}', 'Sos');
         INSERT INTO modifier_options (id, group_id, name, price_cents) VALUES ('opt_1', 'grp_1', 'Acı', 500);
         INSERT INTO login_attempts (scope, tenant_id, failed_count) VALUES ('pin:x', '{tenant}', 3);"
    ))
    .execute(source)
    .await
    .expect("kaynak kayıtlar");
    let mut conn = source.acquire().await.expect("bağlantı");
    let snapshot = crate::services::lan_sync::pairing::export_snapshot(&mut conn, tenant)
        .await
        .expect("görüntü");
    crate::services::lan_sync::pairing::JoinGrant {
        tenant_id: tenant.to_string(),
        cluster_id: "cls_1".to_string(),
        authority_id: "dev_a".to_string(),
        term: 1,
        base_index: 4,
        base_term: 1,
        base_members: Vec::new(),
        snapshot,
    }
}

#[tokio::test]
async fn yeni_cihaz_ayni_kiraciya_katilir_ikinci_isletme_veya_hesap_acmaz() {
    let source = init_db("sqlite::memory:").await.expect("kaynak");
    let tenant = finish(&source, PIN).await.expect("kurulum");
    let grant = grant_from(&source, &tenant).await;

    let target = init_db("sqlite::memory:").await.expect("hedef");
    let mut tx = target.begin().await.expect("tx");
    ensure_local_device(&mut tx, PROVISIONAL_TENANT)
        .await
        .expect("cihaz");
    crate::services::lan_sync::pairing::accept_grant(&mut tx, PROVISIONAL_TENANT, &grant, 9)
        .await
        .expect("katılım");
    mark_joined(&mut tx, &grant.tenant_id)
        .await
        .expect("kurulum");
    tx.commit().await.expect("commit");

    require_complete(&target).await.expect("kurulum kapanır");
    assert_eq!(count(&target, "tenants").await, 1);
    assert_eq!(count(&target, "users").await, 1);
    assert_eq!(count(&target, "tenant_modules").await, 6);
    assert_eq!(count(&target, "categories").await, 1);
    assert_eq!(count(&target, "modifier_options").await, 1);
    assert_eq!(
        count(&target, "audit_ledger").await,
        1,
        "denetim zinciri taşınır"
    );
    assert_eq!(
        count(&target, "login_attempts").await,
        0,
        "cihaz verisi taşınmaz"
    );
    let session = authenticate_by_pin(&target, PIN, None)
        .await
        .expect("sahibin PIN'i yeni cihazda çalışır");
    assert_eq!(session.tenant_id, tenant);
    assert!(authenticate_by_pin(&target, "2222", None).await.is_err());
    let local: String = sqlx::query_scalar("SELECT tenant_id FROM local_device_identity")
        .fetch_one(&target)
        .await
        .expect("cihaz kimliği");
    assert_eq!(local, tenant);
}

#[tokio::test]
async fn kurulumlu_cihaz_baska_isletmeye_katilamaz() {
    let source = init_db("sqlite::memory:").await.expect("kaynak");
    let tenant = finish(&source, PIN).await.expect("kaynak kurulum");
    let grant = grant_from(&source, &tenant).await;
    let target = init_db("sqlite::memory:").await.expect("hedef");
    let own = finish(&target, "7392").await.expect("hedef kurulum");
    let mut tx = target.begin().await.expect("tx");
    let error = crate::services::lan_sync::pairing::accept_grant(&mut tx, &own, &grant, 9)
        .await
        .expect_err("red");
    assert!(error.starts_with("CONFLICT"), "{error}");
}

#[test]
fn zayif_ve_uyusmayan_pin_reddedilir() {
    assert!(validate_owner_pin("4827", "4827").is_ok());
    assert!(validate_owner_pin("4827", "4828").is_err());
    assert!(validate_owner_pin("2222", "2222").is_err());
    assert!(validate_owner_pin("12a4", "12a4").is_err());
    assert!(validate_owner_pin("123", "123").is_err());
}
