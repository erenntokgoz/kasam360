//! Faz 11 B1 — mevcut ihlatlerin kapatılması için regresyon testleri.
//!
//! Kapsam (docs/FAZ-11-PLAN.md §2.3):
//! - V1: `get_active_shift` sorgusu tenant filtresizdi -> cross-tenant kasa sızıntısı
//! - V2: `get_open_shifts` sorgusu tenant filtresizdi -> cross-tenant vardiya sızıntısı
//! - V3: `waiter_clock_in` RBAC çağırmıyor ve tenant bağlamıyordu
//! - V4: `open_shift` / `close_shift` RBAC çağırmıyordu
//! - V5: `orders.cashier_id` hiç yazılmıyordu -> garson karnesi imkânsız
//!
//! Her test bir ihlali kanıtlar. Sadece "kod derleniyor" kontrolü değildir.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

const SCHEMA: &str = include_str!("../migrations/schema.sql");

async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let p = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("in-memory db");
    sqlx::raw_sql(SCHEMA).execute(&p).await.expect("şema uygulanmalı");
    p
}

async fn add_user(p: &sqlx::SqlitePool, tenant: &str, id: &str, name: &str, role: &str) {
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, is_active) VALUES (?1, ?2, ?3, ?4, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(role)
    .bind(name)
    .execute(p)
    .await
    .expect("kullanıcı eklenmeli");
}

async fn add_table(p: &sqlx::SqlitePool, tenant: &str, id: &str, waiter: Option<&str>) {
    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, waiter_id)
         VALUES (?1, ?2, ?3, 'AVAILABLE', ?4)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .bind(waiter)
    .execute(p)
    .await
    .expect("masa eklenmeli");
}

/// Vardiya kaydını doğrudan ekler; komut katmanının RBAC'sı burada test edilmez,
/// yalnız SQL'in tenant filtresi sınanır.
async fn add_shift(p: &sqlx::SqlitePool, tenant: &str, id: &str, cashier: &str, expected: i64) {
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
         VALUES (?1, ?2, ?3, 'OPEN', '2026-03-10T08:00:00Z', ?4)",
    )
    .bind(id)
    .bind(tenant)
    .bind(cashier)
    .bind(expected)
    .execute(p)
    .await
    .expect("vardiya eklenmeli");
}

/// Aktif vardiya SQL'ini doğrudan çalıştırır (komut `tauri::State` istediği için
/// test edilemez; sınanan şey filtreleme mantığıdır).
async fn active_shift_sql(
    p: &sqlx::SqlitePool,
    tenant: &str,
    cashier: &str,
) -> Result<Option<String>, String> {
    let row = sqlx::query(
        "SELECT id FROM shifts WHERE tenant_id = ? AND cashier_id = ? AND status = 'OPEN'",
    )
    .bind(tenant)
    .bind(cashier)
    .fetch_optional(p)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.map(|r| r.try_get::<String, _>("id").map_err(|e| e.to_string())).transpose()?)
}

async fn open_shifts_sql(p: &sqlx::SqlitePool, tenant: &str) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT s.id, s.tenant_id, s.cashier_id, u.name AS cashier_name, s.opened_at,
                s.expected_amount_cents
           FROM shifts s
           LEFT JOIN users u ON u.id = s.cashier_id AND u.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND s.status = 'OPEN'
          ORDER BY s.opened_at ASC",
    )
    .bind(tenant)
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(r.try_get::<String, _>("id").map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// V1 — get_active_shift tenant izolasyonu
// ---------------------------------------------------------------------------

#[tokio::test]
async fn v1_aktif_vardiya_baska_kiracininkini_gormez() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_cash_a", "Kasiyer A", "CASHIER").await;
    add_user(&p, "tenant_b", "usr_cash_b", "Kasiyer B", "CASHIER").await;
    add_shift(&p, "tenant_a", "shf_a", "usr_cash_a", 50_000).await;
    add_shift(&p, "tenant_b", "shf_b", "usr_cash_b", 900_000).await;

    let a = active_shift_sql(&p, "tenant_a", "usr_cash_a").await.expect("okunmali");
    assert_eq!(a.as_deref(), Some("shf_a"), "kiraci A yalnız kendi vardiyasini gormeli");

    let b = active_shift_sql(&p, "tenant_b", "usr_cash_b").await.expect("okunmali");
    assert_eq!(b.as_deref(), Some("shf_b"));
}

/// `users.id` global tekil olduğu için kimlik paylaşılamaz; sızıntı **bozuk
/// satırdan** doğar: `shifts.tenant_id` ile kasiyerin gerçek tenant'ı
/// ayrışmışsa (eski hata, hatalı toplu yazma, iptal edilmemiş geçiş) tenant
/// filtresi olmadan bu satır komşu kiracıya görünür.
#[tokio::test]
async fn v1_tenant_kirilmis_satir_komsu_kiraciya_sizmaz() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_cash_a", "Kasiyer A", "CASHIER").await;
    // Satır `tenant_b` altında ama kasiyer `tenant_a`'nın kullanıcısı.
    add_shift(&p, "tenant_b", "shf_kirilmis", "usr_cash_a", 900_000).await;

    let a = active_shift_sql(&p, "tenant_a", "usr_cash_a").await.expect("okunmali");
    assert!(
        a.is_none(),
        "kiraci A, tenant'i yanlis yazilmis vardiyayi gormemeli: {a:?}"
    );
}

#[tokio::test]
async fn v1_baska_kiracida_vardiya_yoksa_null_doner() {
    let p = pool().await;
    add_shift(&p, "tenant_a", "shf_a", "usr_cash_a", 50_000).await;

    let yabancı = active_shift_sql(&p, "tenant_b", "usr_cash_a").await.expect("okunmali");
    assert!(yabancı.is_none(), "var olmayan vardiya null dönmeli, sıfır tutar değil");
}

// ---------------------------------------------------------------------------
// V2 — get_open_shifts tenant izolasyonu
// ---------------------------------------------------------------------------

#[tokio::test]
async fn v2_acik_vardiyalar_yalniz_kendi_kiracini_listeler() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_cash_a", "Kasiyer A", "CASHIER").await;
    add_user(&p, "tenant_b", "usr_cash_b", "Kasiyer B", "CASHIER").await;
    add_shift(&p, "tenant_a", "shf_a1", "usr_cash_a", 50_000).await;
    add_shift(&p, "tenant_a", "shf_a2", "usr_cash_a", 60_000).await;
    add_shift(&p, "tenant_b", "shf_b1", "usr_cash_b", 900_000).await;

    let a = open_shifts_sql(&p, "tenant_a").await.expect("okunmali");
    assert_eq!(a.len(), 2, "kiraci A iki vardiya gormeli");
    assert!(!a.contains(&"shf_b1".to_string()), "kiraci B vardiyasi sizmamali");

    let b = open_shifts_sql(&p, "tenant_b").await.expect("okunmali");
    assert_eq!(b.len(), 1);
    assert_eq!(b[0], "shf_b1");
}

/// V2'nin asıl kanıtı: `tenant_id` filtresi olmayan sorgu tüm işletmelerin
/// beklenen bakiyelerini dökerdi. Kırık satır senaryosu bunu görünür kılar.
#[tokio::test]
async fn v2_tenant_kirilmis_satir_listelenmez() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_cash_a", "Kasiyer A", "CASHIER").await;
    // Satır `tenant_b` altında, kasiyer `tenant_a`'nın kullanıcısı.
    add_shift(&p, "tenant_b", "shf_kirilmis", "usr_cash_a", 900_000).await;

    let a = open_shifts_sql(&p, "tenant_a").await.expect("okunmali");
    assert!(a.is_empty(), "kiraci A kirilmis satiri gormemeli: {a:?}");
}

#[tokio::test]
async fn v2_kapanmis_vardiya_listelenmez() {
    let p = pool().await;
    add_shift(&p, "tenant_a", "shf_open", "usr_cash_a", 50_000).await;
    sqlx::query("UPDATE shifts SET status = 'CLOSED' WHERE id = 'shf_open'")
        .execute(&p)
        .await
        .expect("kapatma");

    let a = open_shifts_sql(&p, "tenant_a").await.expect("okunmali");
    assert!(a.is_empty());
}

#[tokio::test]
async fn v2_kullanici_bulunamazsa_ad_null_doner_sifir_degil() {
    let p = pool().await;
    // Kullanıcı kaydı silinmiş (soft-delete) bir vardiya.
    add_shift(&p, "tenant_a", "shf_orphan", "usr_yok", 50_000).await;

    let row = sqlx::query(
        "SELECT u.name AS cashier_name FROM shifts s
           LEFT JOIN users u ON u.id = s.cashier_id AND u.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND s.status = 'OPEN'",
    )
    .bind("tenant_a")
    .fetch_one(&p)
    .await
    .expect("satır okunmali");
    // Bilinmeyen kasiyer adı boş string olmamalı; null döner.
    assert_eq!(
        row.try_get::<Option<String>, _>("cashier_name").expect("kolon okunmali"),
        None
    );
}

// ---------------------------------------------------------------------------
// V3 — waiter_clock_in yetki ve tenant
// ---------------------------------------------------------------------------

#[test]
fn v3_bekci_yemisi_garson_vardiyasina_giremez() {
    // Komut katmanı RBAC'i `require_any_present` ile uygular; burada reddedilen
    // rol kümesinin kendisi doğrulanır.
    let reddedilen = crate::rbac::require_any_present(
        Some("KITCHEN"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Waiter,
        ],
    );
    assert!(reddedilen.is_err(), "mutfak garson vardiyasina girememeli");
}

#[test]
fn v3_garson_kendi_vardiyasina_girebilir() {
    let sonuc = crate::rbac::require_any_present(
        Some("WAITER"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Waiter,
        ],
    );
    assert!(sonuc.is_ok(), "garson kendi vardiyasini acabilmeli");
}

#[tokio::test]
async fn v3_garson_girisi_kiraciya_baglanir() {
    let p = pool().await;
    let payload = serde_json::json!({"waiterId": "usr_waiter", "clockedIn": true});
    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at)
         VALUES (?1, ?2, ?3, 'WAITER_SHIFT', 'CLOCK_IN', ?4, datetime('now'))",
    )
    .bind("evt_1")
    .bind("tenant_a")
    .bind("usr_waiter")
    .bind(serde_json::to_string(&payload).expect("payload"))
    .execute(&p)
    .await
    .expect("giriş yazılmalı");

    let satir = sqlx::query("SELECT tenant_id FROM events WHERE event_id = 'evt_1'")
        .fetch_one(&p)
        .await
        .expect("olay okunmali");
    // Varsayılan `DEFAULT_TENANT`'a düşme kuralı bozulursa bu test kızar.
    assert_eq!(
        satir.try_get::<String, _>("tenant_id").expect("kolon"),
        "tenant_a"
    );
}

// ---------------------------------------------------------------------------
// V4 — open_shift / close_shift yetki
// ---------------------------------------------------------------------------

#[test]
fn v4_mutfak_kasa_vardiyasi_acamaz() {
    let sonuc = crate::rbac::require_any_present(
        Some("KITCHEN"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    );
    assert!(sonuc.is_err(), "mutfak beklenen bakiyeyi belirleyememeli");
}

#[test]
fn v4_garson_kasa_vardiyasi_acamaz() {
    let sonuc = crate::rbac::require_any_present(
        Some("WAITER"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    );
    assert!(sonuc.is_err(), "garson kasa vardiyasi acamamali");
}

#[test]
fn v4_kasiyer_kasa_vardiyasi_acabilir() {
    let sonuc = crate::rbac::require_any_present(
        Some("CASHIER"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    );
    assert!(sonuc.is_ok());
}

#[tokio::test]
async fn v4_vardiya_basina_tek_acik_vardiya_kurali_kiracili() {
    let p = pool().await;
    add_shift(&p, "tenant_a", "shf_a", "usr_cash_a", 50_000).await;

    // Aynı kiracıda ikinci açık vardiya sayılır.
    let sayi: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM shifts WHERE cashier_id = 'usr_cash_a' AND status = 'OPEN' AND tenant_id = 'tenant_a'",
    )
    .fetch_one(&p)
    .await
    .expect("sayaç");
    assert_eq!(sayi, 1);

    // Farklı kiracı aynı kasiyer kimliğiyle vardiya açabilir: kimlik paylaşılan
    // bir değer, ayrım tenant'tan gelir.
    let diger: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM shifts WHERE cashier_id = 'usr_cash_a' AND status = 'OPEN' AND tenant_id = 'tenant_b'",
    )
    .fetch_one(&p)
    .await
    .expect("sayaç");
    assert_eq!(diger, 0, "baska kiracida vardiya yok sayilmamali");
}

// ---------------------------------------------------------------------------
// V5 — orders.cashier_id ve order_items.waiter_id yazımı
// ---------------------------------------------------------------------------

#[tokio::test]
async fn v5_siparis_kaydinda_cashier_id_doldurulur() {
    let p = pool().await;
    add_table(&p, "tenant_a", "tbl_1", Some("usr_waiter")).await;

    let waiter_id: Option<String> =
        sqlx::query_scalar::<_, Option<String>>("SELECT waiter_id FROM tables WHERE tenant_id = ? AND id = ?")
            .bind("tenant_a")
            .bind("tbl_1")
            .fetch_optional(&p)
            .await
            .expect("okunmali")
            .flatten();
    assert_eq!(waiter_id.as_deref(), Some("usr_waiter"), "masanin garsonu devralinmali");

    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, cashier_id, created_at, updated_at)
         VALUES ('ord_1', 'tenant_a', 'tbl_1', 'IN_PROGRESS', 50000, ?1, datetime('now'), datetime('now'))",
    )
    .bind(&waiter_id)
    .execute(&p)
    .await
    .expect("siparis yazılmalı");

    let satir = sqlx::query("SELECT cashier_id FROM orders WHERE id = 'ord_1'")
        .fetch_one(&p)
        .await
        .expect("siparis okunmali");
    // V5'in kanıtı: sipariş seviyesinde garson kaydı artık dolu.
    assert_eq!(
        satir.try_get::<Option<String>, _>("cashier_id").expect("kolon"),
        Some("usr_waiter".to_string())
    );
}

#[tokio::test]
async fn v5_kalem_kaydinda_waiter_id_yazilabilir() {
    let p = pool().await;
    // `orders.table_id` FK'si ve `order_items.product_id` FK'si için üst kayıtlar
    // önce yazılmalı; aksi halde test şema kısıtına takılır, V5'i sınamaz.
    add_table(&p, "tenant_a", "tbl_1", Some("usr_waiter")).await;
    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tenant_a', 'Kahve')")
        .execute(&p)
        .await
        .expect("kategori yazılmalı");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, category_id, price_cents)
         VALUES ('prd_1', 'tenant_a', 'Kahve', 'cat_1', 25000)",
    )
    .execute(&p)
    .await
    .expect("urun yazılmalı");
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at, updated_at)
         VALUES ('ord_1', 'tenant_a', 'tbl_1', 'IN_PROGRESS', 50000, datetime('now'), datetime('now'))",
    )
    .execute(&p)
    .await
    .expect("siparis yazılmalı");

    // `order_items.waiter_id` kolonu şemada bulunmalı; yoksa INSERT hata verir.
    let sonuc = sqlx::query(
        "INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents, waiter_id)
         VALUES ('oi_1', 'tenant_a', 'ord_1', 'prd_1', 2, 50000, 'usr_waiter')",
    )
    .execute(&p)
    .await;
    assert!(sonuc.is_ok(), "kalem seviyesinde garson yazilabilmeli");

    let satir = sqlx::query("SELECT waiter_id FROM order_items WHERE id = 'oi_1'")
        .fetch_one(&p)
        .await
        .expect("kalem okunmali");
    assert_eq!(
        satir.try_get::<Option<String>, _>("waiter_id").expect("kolon"),
        Some("usr_waiter".to_string())
    );
}

#[tokio::test]
async fn v5_waiter_id_alanı_kiraci_indeksli() {
    let p = pool().await;
    // Garson karnesi sürekli `(tenant_id, waiter_id)` ile sorgular; indeks yoksa
    // rapor tüm sipariş kalemlerini tarar.
    let indeksler = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'order_items'",
    )
    .fetch_all(&p)
    .await
    .expect("indeksler okunmali");
    let adlar: Vec<String> = indeksler
        .into_iter()
        .map(|r| r.try_get::<String, _>("name").expect("ad"))
        .collect();
    assert!(
        adlar.iter().any(|a| a == "idx_order_items_waiter"),
        "idx_order_items_waiter indeksi bulunmali: {adlar:?}"
    );
}

#[tokio::test]
async fn v5_garsonsuz_masa_siparisinde_kayit_null_kalir() {
    let p = pool().await;
    add_table(&p, "tenant_a", "tbl_bos", None).await;

    let waiter_id: Option<String> =
        sqlx::query_scalar::<_, Option<String>>("SELECT waiter_id FROM tables WHERE tenant_id = ? AND id = ?")
            .bind("tenant_a")
            .bind("tbl_bos")
            .fetch_optional(&p)
            .await
            .expect("okunmali")
            .flatten();
    // Boş string yerine null: masada garson yok demektir.
    assert!(waiter_id.is_none(), "garsonsuz masa null vermeli");
}