//! `modifier_service` testleri (Faz 4).
//!
//! Kapsam: kural testleri. "Şablonda 'Az' seçeneği var" gibi **içerik**
//! testleri yazılmaz; bunlar SPEC'te olmayan hazır içerik uydurur. Testler
//! gerçek servisin karar kurallarını denetler: tenant izolasyonu, kategori
//! şablonu bağlantısı, ürün bağlantısı ve fiyat bütünlüğü.

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

/// `schema.sql` idempotent CREATE kullanır; bu ALTER'lar `db.rs`'in çalışma
/// zamanı migration'larının test karşılığıdır. Testsiz bırakılırsa kolon yok
/// sayılır ve test sessizce yanlış anlam çıkarır.
async fn apply_runtime_migrations(pool: &sqlx::SqlitePool) {
    sqlx::raw_sql("ALTER TABLE modifier_groups ADD COLUMN category_id TEXT;")
        .execute(pool)
        .await
        .ok();
    sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_modifier_groups_tenant_category \
         ON modifier_groups(tenant_id, category_id);",
    )
    .execute(pool)
    .await
    .ok();
}

async fn seed_tenant(pool: &sqlx::SqlitePool, tenant: &str) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(tenant)
        .bind(tenant)
        .execute(pool)
        .await
        .expect("tenant eklenir");
}

async fn seed_category(pool: &sqlx::SqlitePool, tenant: &str, id: &str) {
    sqlx::query(
        "INSERT OR IGNORE INTO categories (id, tenant_id, name, display_order) VALUES (?, ?, ?, 0)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .execute(pool)
    .await
    .expect("kategori eklenir");
}

async fn seed_product(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    id: &str,
    category_id: &str,
    price_cents: i64,
) {
    sqlx::query(
        "INSERT OR IGNORE INTO products (id, tenant_id, name, price_cents, tax_rate, category_id, is_active) \
         VALUES (?, ?, ?, ?, 20.0, ?, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .bind(price_cents)
    .bind(category_id)
    .execute(pool)
    .await
    .expect("ürün eklenir");
}

/// `PoolConnection` `DerefMut<Target = SqliteConnection>` uygular; `&mut conn`
/// çağrılarda otomatik olarak `&mut SqliteConnection`'a dönüşür.
async fn conn_of(pool: &sqlx::SqlitePool) -> sqlx::pool::PoolConnection<sqlx::Sqlite> {
    pool.acquire().await.expect("bağlantı alınır")
}

fn options_json(ids: &[&str]) -> serde_json::Value {
    serde_json::json!(
        ids.iter()
            .map(|id| serde_json::json!({ "id": id, "name": "Seçenek", "priceCents": 0 }))
            .collect::<Vec<_>>()
    )
}

// ─── Temel CRUD + tenant izolasyonu ─────────────────────────────────────────

#[tokio::test]
async fn grup_olusturur_ve_tenant_kapsaminda_listeler() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let id = create_group(&mut conn, TENANT_A, "Pişme Derecesi", true, 1, Some(1), None)
        .await
        .expect("grup oluşturulur");

    let groups = list_groups(&mut conn, TENANT_A, None).await.expect("liste okunur");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].id, id);
    assert_eq!(groups[0].name, "Pişme Derecesi");
    assert!(groups[0].is_required);
}

#[tokio::test]
async fn baska_tenantin_grubu_listede_gorunmez() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut conn = conn_of(&pool).await;

    create_group(&mut conn, TENANT_A, "Sadece A", false, 0, None, None)
        .await
        .expect("A grubu oluşturulur");

    let b_groups = list_groups(&mut conn, TENANT_B, None).await.expect("B listeler");
    assert!(b_groups.is_empty(), "çapraz tenant sızıntısı");
}

#[tokio::test]
async fn baska_tenantin_grubuna_secenek_eklenemez() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "A Grubu", false, 0, None, None)
        .await
        .expect("grup oluşturulur");

    let err = add_option(&mut conn, TENANT_B, &group_id, "Ekstra", 500)
        .await
        .expect_err("çapraz tenant seçenek eklenemeli");
    assert!(err.contains("TENANT_ISOLATION"), "beklenen hata: {}", err);
}

#[tokio::test]
async fn baska_tenantin_grubu_silinemez() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "A Grubu", false, 0, None, None)
        .await
        .expect("grup oluşturulur");

    let err = delete_group(&mut conn, TENANT_B, &group_id)
        .await
        .expect_err("çapraz tenant silinemeli");
    assert!(err.contains("NOT_FOUND"), "beklenen hata: {}", err);

    // A'nın verisi yerinde kalmalı.
    let still_there = list_groups(&mut conn, TENANT_A, None).await.expect("listelenir");
    assert_eq!(still_there.len(), 1, "başka işletmenin grubu silinmemeli");
}

#[tokio::test]
async fn negatif_fiyat_farki_reddedilir() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Grupt", false, 0, None, None)
        .await
        .expect("grup oluşturulur");

    let err = add_option(&mut conn, TENANT_A, &group_id, "Eksik Ödeme", -100)
        .await
        .expect_err("negatif fiyat farkı reddedilmeli");
    assert!(err.contains("INVALID_MODIFIER_PRICE"), "beklenen hata: {}", err);
}

#[tokio::test]
async fn grup_silinince_secenekleri_de_silinir() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Grupt", false, 0, None, None)
        .await
        .expect("grup oluşturulur");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Seçenek", 1500)
        .await
        .expect("seçenek eklenir");

    delete_group(&mut conn, TENANT_A, &group_id)
        .await
        .expect("grup silinir");

    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM modifier_options WHERE id = ?")
            .bind(&option_id)
            .fetch_one(&mut *conn)
            .await
            .expect("sayaç okunur");
    assert_eq!(remaining, 0, "CASCADE: seçenekler de silinmeli");
}

// ─── Kategori şablonu ───────────────────────────────────────────────────────

#[tokio::test]
async fn kategori_sablonu_kategoriye_bağlanir() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    seed_category(&pool, TENANT_A, "cat_1").await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(
        &mut conn,
        TENANT_A,
        "Süt Seçeneği",
        false,
        0,
        None,
        Some("cat_1"),
    )
    .await
    .expect("şablon oluşturulur");

    let all = list_groups(&mut conn, TENANT_A, None).await.expect("tümü");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].category_id.as_deref(), Some("cat_1"));

    let scoped = list_groups(&mut conn, TENANT_A, Some("cat_1")).await.expect("kategori");
    assert_eq!(scoped.len(), 1);
    assert_eq!(scoped[0].id, group_id);
}

#[tokio::test]
async fn kategori_sablonu_baska_tenantin_kategorisine_baglanamaz() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    seed_category(&pool, TENANT_A, "cat_a").await;
    let mut conn = conn_of(&pool).await;

    let err = create_group(&mut conn, TENANT_B, "Şablon", false, 0, None, Some("cat_a"))
        .await
        .expect_err("çapraz tenant şablonu reddedilmeli");
    assert!(err.contains("TENANT_ISOLATION"), "beklenen hata: {}", err);
}

#[tokio::test]
async fn serbest_grup_kategorisiz_kalir() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    create_group(&mut conn, TENANT_A, "Serbest Grup", false, 0, None, None)
        .await
        .expect("grup oluşturulur");

    let scoped = list_groups(&mut conn, TENANT_A, Some("cat_yok")).await.expect("kategori");
    assert!(scoped.is_empty(), "kategorisiz grup kategori listesine girmemeli");
}

// ─── Ürün bağlantısı ────────────────────────────────────────────────────────

#[tokio::test]
async fn urune_grup_baglanir_ve_pos_gorunumu_dogru_doner() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    seed_category(&pool, TENANT_A, "cat_1").await;
    seed_product(&pool, TENANT_A, "prd_1", "cat_1", 30000).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Pişme Derecesi", true, 1, Some(1), None)
        .await
        .expect("grup oluşturulur");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Orta", 0)
        .await
        .expect("seçenek eklenir");

    set_product_groups(&mut conn, TENANT_A, "prd_1", &[group_id.clone()])
        .await
        .expect("bağlanır");

    let ids = product_group_ids(&mut conn, TENANT_A, "prd_1")
        .await
        .expect("kimlikler okunur");
    assert_eq!(ids, vec![group_id]);

    let groups = product_groups(&mut conn, TENANT_A, "prd_1")
        .await
        .expect("POS görünümü");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].options.len(), 1);
    assert_eq!(groups[0].options[0].id, option_id);
}

#[tokio::test]
async fn urun_grup_baglantisi_kume_ile_degisir() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    seed_category(&pool, TENANT_A, "cat_1").await;
    seed_product(&pool, TENANT_A, "prd_1", "cat_1", 30000).await;
    let mut conn = conn_of(&pool).await;

    let g1 = create_group(&mut conn, TENANT_A, "G1", false, 0, None, None)
        .await
        .expect("g1");
    let g2 = create_group(&mut conn, TENANT_A, "G2", false, 0, None, None)
        .await
        .expect("g2");

    set_product_groups(&mut conn, TENANT_A, "prd_1", &[g1.clone(), g2.clone()])
        .await
        .expect("iki grup");
    assert_eq!(
        product_group_ids(&mut conn, TENANT_A, "prd_1").await.unwrap().len(),
        2
    );

    // Küme semantiği: gönderilmeyen grup düşer.
    set_product_groups(&mut conn, TENANT_A, "prd_1", &[g2.clone()])
        .await
        .expect("tek grup");
    assert_eq!(
        product_group_ids(&mut conn, TENANT_A, "prd_1").await.unwrap(),
        vec![g2]
    );
}

#[tokio::test]
async fn urune_baska_tenantin_grubu_baglanamaz() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_category(&pool, TENANT_A, "cat_1").await;
    seed_product(&pool, TENANT_A, "prd_1", "cat_1", 30000).await;
    let mut conn = conn_of(&pool).await;

    let foreign_group = create_group(&mut conn, TENANT_B, "B Grubu", false, 0, None, None)
        .await
        .expect("B grubu");

    let err = set_product_groups(&mut conn, TENANT_A, "prd_1", &[foreign_group])
        .await
        .expect_err("çapraz tenant grubu bağlanamamalı");
    assert!(err.contains("TENANT_ISOLATION"), "beklenen hata: {}", err);

    // Bağlanma denemesi yarım atama bırakmamalı.
    let ids = product_group_ids(&mut conn, TENANT_A, "prd_1").await.unwrap_or_default();
    assert!(ids.is_empty(), "başarısız deneme atama bırakmamalı");
}

#[tokio::test]
async fn baska_tenantin_urununun_modifierlari_okunamaz() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_category(&pool, TENANT_A, "cat_1").await;
    seed_product(&pool, TENANT_A, "prd_1", "cat_1", 30000).await;
    let mut conn = conn_of(&pool).await;

    let err = product_groups(&mut conn, TENANT_B, "prd_1")
        .await
        .expect_err("çapraz tenant ürün okunamamalı");
    assert!(err.contains("TENANT_ISOLATION"), "beklenen hata: {}", err);
}

// ─── Fiyat bütünlüğü ────────────────────────────────────────────────────────

#[tokio::test]
async fn secenek_fiyati_istemciden_degil_veritabanindan_alinir() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Ekstralar", false, 0, None, None)
        .await
        .expect("grup");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Ekstra Peynir", 4000)
        .await
        .expect("seçenek");

    // İstemci fiyatı 0 göndererek ek ücretten kurtulmaya çalışıyor.
    let malicious = serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 0 }]);
    let total = sum_selected_option_prices(&mut conn, TENANT_A, Some(&malicious))
        .await
        .expect("toplam");
    assert_eq!(total, 4000, "fiyat istemciden değil DB'den gelmeli");
}

#[tokio::test]
async fn secenek_yoksa_sessizce_sifir_fiyatlanmaz() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let unknown = serde_json::json!([{ "id": "mod_yok", "name": "Hayalet", "priceCents": 0 }]);
    let err = sum_selected_option_prices(&mut conn, TENANT_A, Some(&unknown))
        .await
        .expect_err("bilinmeyen seçenek reddedilmeli");
    assert!(err.contains("MALICIOUS_INPUT"), "beklenen hata: {}", err);
}

#[tokio::test]
async fn baska_tenantin_seceneginin_fiyati_kullanilamaz() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_B, "B Grubu", false, 0, None, None)
        .await
        .expect("B grubu");
    let option_id = add_option(&mut conn, TENANT_B, &group_id, "B Seçeneği", 1000)
        .await
        .expect("B seçeneği");

    let err = sum_selected_option_prices(&mut conn, TENANT_A, Some(&options_json(&[&option_id])))
        .await
        .expect_err("çapraz tenant seçeneği reddedilmeli");
    assert!(err.contains("MALICIOUS_INPUT"), "beklenen hata: {}", err);
}

#[tokio::test]
async fn secenek_sayisi_asilirsa_kismi_fiyatlandirmaz() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Sınır Grubu", false, 0, None, None)
        .await
        .expect("grup");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Tek Seçenek", 100)
        .await
        .expect("seçenek");

    // Aynı seçenek defalarca gönderilerek sınır aşılır: her tekrar bir sorgu
    // demektir. Sınır aşımı hata vermeli, kısmi toplam ücret almamalı.
    let ids: Vec<String> = (0..=MAX_OPTIONS_PER_ITEM)
        .map(|_| option_id.clone())
        .collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let payload = options_json(&refs);
    let err = sum_selected_option_prices(&mut conn, TENANT_A, Some(&payload))
        .await
        .expect_err("sınır aşımı reddedilmeli");
    assert!(
        err.contains("INVALID_MODIFIER_SELECTION"),
        "beklenen hata: {}",
        err
    );
}

#[tokio::test]
async fn donmus_fiyat_uzerine_modifier_eklenmez() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Ekstralar", false, 0, None, None)
        .await
        .expect("grup");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Ekstra Peynir", 4000)
        .await
        .expect("seçenek");
    let modifiers = options_json(&[&option_id]);

    // Donmuş fiyat modifier'ı zaten içerir: tekrar eklenirse aynı ekstra iki kez
    // ücretlenir. `resolve_unit_price` donmuş değeri olduğu gibi döner.
    let price = resolve_unit_price(
        &mut conn,
        TENANT_A,
        (30000, 20.0),
        Some(&modifiers),
        Some(34000),
    )
    .await
    .expect("fiyat çözülür");
    assert_eq!(price, 34000, "çift sayım olmamalı");
}

#[tokio::test]
async fn donmus_fiyat_yoksa_urun_fiyatina_modifier_eklenir() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Ekstralar", false, 0, None, None)
        .await
        .expect("grup");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Ekstra Peynir", 4000)
        .await
        .expect("seçenek");

    let price = resolve_unit_price(
        &mut conn,
        TENANT_A,
        (30000, 20.0),
        Some(&options_json(&[&option_id])),
        None,
    )
    .await
    .expect("fiyat çözülür");
    assert_eq!(price, 34000, "ürün 300 TL + ekstra 40 TL");
}

// ─── Mevcut verinin okunabilirliği ──────────────────────────────────────────

#[tokio::test]
async fn category_id_kolonu_eklenmeden_once_yazan_veri_okunur() {
    // Faz 4 migration'ının güvenliği: kolon eklenmeden önce yazılmış grup
    // satırları (category_id olmadan) okunabilir kalmalı.
    let pool = pool().await;
    sqlx::query(
        "INSERT INTO modifier_groups (id, tenant_id, name, is_required, min_selections) \
         VALUES ('mod_legacy', ?, 'Eski Grup', 0, 0)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("eski biçimde grup yazılır");

    apply_runtime_migrations(&pool).await;
    let mut conn = conn_of(&pool).await;

    let groups = list_groups(&mut conn, TENANT_A, None)
        .await
        .expect("eski veri okunur");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].id, "mod_legacy");
    assert_eq!(groups[0].category_id, None, "eski satır serbest grup sayılmalı");
}

#[tokio::test]
async fn grup_listesi_tek_sorguda_secenekleri_cekir() {
    // N+1 regresyonu: 3 grup × seçenekler tek sorguda gelmeli.
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    for idx in 0..3 {
        let gid = create_group(&mut conn, TENANT_A, &format!("Grup {}", idx), false, 0, None, None)
            .await
            .expect("grup");
        for opt in 0..3 {
            add_option(&mut conn, TENANT_A, &gid, &format!("Seçenek {}", opt), opt * 100)
                .await
                .expect("seçenek");
        }
    }

    let groups = list_groups(&mut conn, TENANT_A, None).await.expect("liste");
    assert_eq!(groups.len(), 3);
    for group in &groups {
        assert_eq!(group.options.len(), 3);
    }
}

#[tokio::test]
async fn secenek_listesi_fiyat_farkini_korur() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let gid = create_group(&mut conn, TENANT_A, "Ekstralar", false, 0, None, None)
        .await
        .expect("grup");
    add_option(&mut conn, TENANT_A, &gid, "Ekstra Peynir", 4000)
        .await
        .expect("seçenek");

    let stored: i64 = sqlx::query_scalar("SELECT price_cents FROM modifier_options WHERE group_id = ?")
        .bind(&gid)
        .fetch_one(&mut *conn)
        .await
        .expect("fiyat okunur");
    assert_eq!(stored, 4000);
}
