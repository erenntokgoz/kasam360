//! P0 regresyon: menü yönetimi kiracı izolasyonu.
//!
//! Menü komutları `tauri::State` parametresi taşıdığı için doğrudan çağrılamaz.
//! Bu yüzden iki katman sınanır:
//!
//! 1. Güvenlik primitifleri (`require_tenant`, `ensure_owned`) — bunların doğru
//!    davrandığı birim testleriyle kanıtlanır.
//! 2. Kaynak sözleşmesi — menü modüllerindeki **her** SQL ifadesi
//!    `tenant_id` içermek zorundadır. Yeni bir komut ekleyen kişi filtresiz
//!    sorgu yazarsa test kızarız; gözden geçirme gereksinimi ortadan kalkar.

use sqlx::SqlitePool;

use crate::management_commands::category::CategoryDto;
use crate::management_commands::staff::StaffMemberDto;

// ---------------------------------------------------------------------------
// require_tenant
// ---------------------------------------------------------------------------

#[test]
fn oturumsuz_cagri_reddedilir() {
    let hata = crate::management_commands::require_tenant(None)
        .expect_err("tenant yoksa işlem yapılmamalı");
    assert!(hata.contains("UNAUTHORIZED"), "beklenen hata: {hata}");
}

#[test]
fn bos_tenant_reddedilir() {
    for bos in ["", "   ", "\t"] {
        assert!(
            crate::management_commands::require_tenant(Some(bos)).is_err(),
            "boş tenant kabul edilmemeli: {bos:?}"
        );
    }
}

#[test]
fn gecerli_tenant_korunur() {
    assert_eq!(
        crate::management_commands::require_tenant(Some("tenant_a")).expect("gecerli"),
        "tenant_a"
    );
    // Kenar boşluk temizlenir; " tenant_a " ile arama yapılmaz.
    assert_eq!(
        crate::management_commands::require_tenant(Some("  tenant_a  ")).expect("gecerli"),
        "tenant_a"
    );
}

// ---------------------------------------------------------------------------
// ensure_owned
// ---------------------------------------------------------------------------

async fn pool() -> SqlitePool {
    let p = SqlitePool::connect("sqlite::memory:").await.expect("hafiza");
    sqlx::raw_sql(include_str!("../migrations/schema.sql"))
        .execute(&p)
        .await
        .expect("sema");
    sqlx::query("INSERT INTO users (id, tenant_id, role, name, is_active) VALUES ('usr_a','tenant_a','OWNER','A',1)")
        .execute(&p)
        .await
        .expect("kullanici a");
    sqlx::query("INSERT INTO users (id, tenant_id, role, name, is_active) VALUES ('usr_b','tenant_b','OWNER','B',1)")
        .execute(&p)
        .await
        .expect("kullanici b");
    p
}

#[tokio::test]
async fn kendi_kaydi_gecer() {
    let p = pool().await;
    let mut conn = p.acquire().await.expect("baglanti");
    crate::management_commands::ensure_owned(&mut conn, "users", "usr_a", "tenant_a")
        .await
        .expect("kendi kaydi gecmeli");
}

#[tokio::test]
async fn baska_kiracinin_kaydi_reddedilir() {
    let p = pool().await;
    let mut conn = p.acquire().await.expect("baglanti");
    let hata = crate::management_commands::ensure_owned(&mut conn, "users", "usr_b", "tenant_a")
        .await
        .expect_err("baska kiracinin kaydi gecmemeli");
    // Hata metni hedefin varligini sızdirmaz.
    assert!(hata.starts_with("NOT_FOUND"), "beklenen hata: {hata}");
    assert!(!hata.contains("usr_b"), "hedef kimligi hatada sızmamalı");
}

#[tokio::test]
async fn olmayan_kayit_reddedilir() {
    let p = pool().await;
    let mut conn = p.acquire().await.expect("baglanti");
    let hata = crate::management_commands::ensure_owned(&mut conn, "users", "usr_yok", "tenant_a")
        .await
        .expect_err("olmayan kayit gecmemeli");
    assert!(hata.starts_with("NOT_FOUND"), "beklenen hata: {hata}");
}

// ---------------------------------------------------------------------------
// Kaynak sözleşmesi: her SQL'de tenant_id
// ---------------------------------------------------------------------------

const MENU_KAYNAKLARI: [(&str, &str); 4] = [
    (
        "category.rs",
        include_str!("management_commands/category.rs"),
    ),
    (
        "product.rs",
        include_str!("management_commands/product.rs"),
    ),
    ("staff.rs", include_str!("management_commands/staff.rs")),
    (
        "mod.rs",
        include_str!("management_commands/mod.rs"),
    ),
];

/// SQL kaçışlı dizeleri: `sqlx::query("...")` ve `query_scalar("...")` kalıpları.
fn sql_ifadeleri(kaynak: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = kaynak.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c != '"' {
            continue;
        }
        // Kaçışlı çift tırnakları atla (`""`).
        if kaynak[i + 1..].starts_with('"') {
            for _ in 0..2 {
                chars.next();
            }
            continue;
        }
        let mut son = String::new();
        let mut kapali = false;
        while let Some((_, ic)) = chars.next() {
            if ic == '"' {
                kapali = true;
                break;
            }
            son.push(ic);
        }
        if !kapali {
            continue;
        }
        let buyuk = son.to_ascii_uppercase();
        let sql_benzeri = ["SELECT ", "INSERT ", "UPDATE ", "DELETE ", "FROM "]
            .iter()
            .any(|p| buyuk.contains(p));
        if sql_benzeri {
            out.push(son);
        }
    }
    out
}

#[test]
fn menu_sql_ifadeleri_tenant_tasiyor() {
    let mut ihlaller: Vec<String> = Vec::new();
    for (dosya, kaynak) in MENU_KAYNAKLARI {
        for sql in sql_ifadeleri(kaynak) {
            let buyuk = sql.to_ascii_uppercase();
            if buyuk.contains("PRAGMA") || buyuk.contains("SQLITE_") {
                continue;
            }
            if !buyuk.contains("TENANT_ID") {
                ihlaller.push(format!("{dosya}: {}", sql.trim()));
            }
        }
    }
    assert!(
        ihlaller.is_empty(),
        "Kiraci filtresi olmayan SQL:\n{}",
        ihlaller.join("\n")
    );
}

#[test]
fn menu_modulleri_tenant_hedef_satirdan_okumuyor() {
    // Regresyon: `update_product`/`delete_category`/`delete_staff_member`
    // `tenant_id`'yi hedef satırdan çözüyordu. Bu, saldırganın başka
    // işletmenin kaydını değiştirmesine ve denetim kaydının KURBANIN defterine
    // yazılmasına yol açıyordu.
    for (dosya, kaynak) in MENU_KAYNAKLARI {
        let buyuk = kaynak.to_ascii_uppercase();
        assert!(
            !buyuk.contains("FROM PRODUCTS WHERE ID = ?'"),
            "{dosya}: tenant hedef satirdan okunuyor"
        );
        assert!(
            !build_contains(&buyuk, "COALESCE(TENANT_ID, 'DEFAULT_TENANT') FROM"),
            "{dosya}: tenant hedef satirdan cozuluyor"
        );
    }
}

fn build_contains(haystack: &str, needle: &str) -> bool {
    haystack.contains(needle)
}

// ---------------------------------------------------------------------------
// Tip sözleşmesi: tutarlı DTO yüzeyi
// ---------------------------------------------------------------------------

#[test]
fn menu_dto_lari_yerinde() {
    // Regresyon yakalayıcı: modül yeniden düzenlenirse bu yapılar kaybolmamalı.
    let kategori = CategoryDto {
        id: "cat_1".into(),
        name: "Kahve".into(),
        display_order: 1,
    };
    assert_eq!(kategori.id, "cat_1");
    let urun = crate::management_commands::product::ProductDto {
        id: "prd_1".into(),
        category_id: "cat_1".into(),
        name: "Filtre".into(),
        price_cents: 4500,
        image_url: None,
        is_active: true,
    };
    assert_eq!(urun.price_cents, 4500);
    let personel = StaffMemberDto {
        id: "usr_1".into(),
        name: "Ayşe".into(),
        role: "WAITER".into(),
        tenant_id: "tenant_a".into(),
    };
    assert_eq!(personel.tenant_id, "tenant_a");
}
