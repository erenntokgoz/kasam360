//! Cihaz komutlarının yetki, kapsam ve kimlik testleri (Faz 15 B1).
//!
//! Testler komut yerine mantık yordamlarını çağırır; Tauri `State` test
//! ortamında kurulamaz. Bu yüzden `list_devices`, `record_heartbeat`,
//! `cihaz_kaydet` ve `cihaz_durum_degistir` dışa açıktır ve sarmalayıcılar
//! yalnızca yetki + denetim ekler.
//!
//! Kapsam testleri şu üç düzeyi kanıtlar: kiracı yalnız kendi cihazını görür,
//! MASTER tümünü görür, kapsam dışı cihaza **yazma** reddedilir.

use super::{cihaz_durum_degistir, cihaz_kaydet, list_devices, record_heartbeat, CihazKapsam};
use crate::id_generator::generate_id;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqliteConnection};
use std::str::FromStr;

const SEMA: &str = include_str!("../../../migrations/schema.sql");

const TENANT_A: &str = "ten_a";
const TENANT_B: &str = "ten_b";

async fn conn() -> SqliteConnection {
    let secenek = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı secenekleri")
        .create_if_missing(true);
    let havuz = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(secenek)
        .await
        .expect("havuz acilir");
    sqlx::raw_sql(SEMA).execute(&havuz).await.expect("sema");
    havuz.acquire().await.expect("baglanti").detach()
}

async fn tenant_ekle(conn: &mut SqliteConnection, tenant_id: &str) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(tenant_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .expect("tenant eklenir");
}

async fn cihaz_ekle(conn: &mut SqliteConnection, tenant_id: &str, ad: &str) -> String {
    let id = generate_id("dev");
    sqlx::query(
        "INSERT INTO devices (id, tenant_id, name, device_type, status)
         VALUES (?, ?, ?, 'POS', 'ACTIVE')",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(ad)
    .execute(&mut *conn)
    .await
    .expect("cihaz eklenir");
    id
}

// ---------------------------------------------------------------------------
// Kapsam çözümü
// ---------------------------------------------------------------------------

#[test]
fn kapsam_cozumune_gore_roller_ayrilir() {
    // MASTER platform genelini görür; kiracı kimliği vermesi gerekmez.
    assert_eq!(
        CihazKapsam::coz("MASTER", None).expect("master kapsamı"),
        CihazKapsam::Platform
    );
    // İşletme sahibi kendi kiracısına sınırlıdır.
    assert_eq!(
        CihazKapsam::coz("OWNER", Some(TENANT_A)).expect("owner kapsamı"),
        CihazKapsam::Tenant(TENANT_A.to_string())
    );
    assert_eq!(
        CihazKapsam::coz("MANAGER", Some(TENANT_A)).expect("manager kapsamı"),
        CihazKapsam::Tenant(TENANT_A.to_string())
    );
}

#[test]
fn kapsam_belirtilmeden_kiraci_sorgusu_yapilamaz() {
    // Fail-closed: kapsamı bilinmeyen sorgu "tüm veriyi getir" olmaz.
    let hata = CihazKapsam::coz("OWNER", None).expect_err("kiracı kapsamı zorunlu");
    assert!(hata.starts_with("UNAUTHORIZED"), "{hata}");

    let bos = CihazKapsam::coz("OWNER", Some("   ")).expect_err("bos kapsam reddedilmeli");
    assert!(bos.starts_with("UNAUTHORIZED"), "{bos}");
}

#[test]
fn yetkisiz_rol_kapsam_cozemez() {
    // KASSAYER ve GARSOn cihaz envanterini göremez.
    for rol in ["CASHIER", "WAITER", "KITCHEN", "BILINMEYEN", ""] {
        let hata = CihazKapsam::coz(rol, Some(TENANT_A)).expect_err("rol reddedilmeli");
        assert!(
            !matches!(hata, _ if hata.is_empty()),
            "{rol} bos hata dondurmemeli"
        );
    }
}

// ---------------------------------------------------------------------------
// Kiracı izolasyonu
// ---------------------------------------------------------------------------

#[tokio::test]
async fn kiraci_yalniz_kendi_cihazlarini_gorur() {
    let mut conn = conn().await;
    tenant_ekle(&mut conn, TENANT_A).await;
    tenant_ekle(&mut conn, TENANT_B).await;
    cihaz_ekle(&mut conn, TENANT_A, "A Kasa").await;
    cihaz_ekle(&mut conn, TENANT_B, "B Kasa").await;

    let a = list_devices(&mut conn, &CihazKapsam::Tenant(TENANT_A.to_string()))
        .await
        .expect("liste okunur");
    assert_eq!(a.len(), 1, "A yalniz kendi cihazini gormeli");
    assert_eq!(a[0].name, "A Kasa");

    let platform = list_devices(&mut conn, &CihazKapsam::Platform)
        .await
        .expect("platform listesi okunur");
    assert_eq!(platform.len(), 2, "MASTER tum isletmeleri gormeli");
}

#[tokio::test]
async fn kiraci_baska_kiracinin_cihazina_yazamaz() {
    let mut conn = conn().await;
    tenant_ekle(&mut conn, TENANT_A).await;
    tenant_ekle(&mut conn, TENANT_B).await;
    let b_cihaz = cihaz_ekle(&mut conn, TENANT_B, "B Kasa").await;

    // B'nin cihazına A kapsamıyla atış yazılamaz.
    let hata = record_heartbeat(
        &mut conn,
        &CihazKapsam::Tenant(TENANT_A.to_string()),
        &b_cihaz,
    )
    .await
    .expect_err("capraz kiraci yazmasi reddedilmeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    let satir = sqlx::query("SELECT last_heartbeat FROM devices WHERE id = ?")
        .bind(&b_cihaz)
        .fetch_one(&mut conn)
        .await
        .expect("cihaz okunur");
    let atis: Option<String> = satir.try_get("last_heartbeat").expect("kolon okunur");
    assert_eq!(atis, None, "reddedilen yazma durumu degistirmemeli");
}

#[tokio::test]
async fn kiraci_kendi_cihazina_yazabilir() {
    let mut conn = conn().await;
    tenant_ekle(&mut conn, TENANT_A).await;
    let a_cihaz = cihaz_ekle(&mut conn, TENANT_A, "A Kasa").await;

    record_heartbeat(
        &mut conn,
        &CihazKapsam::Tenant(TENANT_A.to_string()),
        &a_cihaz,
    )
    .await
    .expect("kendi cihazina yazabilmeli");

    let atis: Option<String> =
        sqlx::query_scalar("SELECT last_heartbeat FROM devices WHERE id = ?")
            .bind(&a_cihaz)
            .fetch_one(&mut conn)
            .await
            .expect("sorgu calisir");
    assert!(atis.is_some(), "atis zamani yazilmis olmali");
}

#[tokio::test]
async fn olmayan_cihaz_erisimi_sessiz_gecmez() {
    let mut conn = conn().await;
    tenant_ekle(&mut conn, TENANT_A).await;

    // Eskiden bu komut yetkisizdi ve sıfır satır güncellendiği halde başarı
    // döndürüyordu: izleme ekranı "çalışıyor" derken kayıt hiç güncellenmiyordu.
    let hata = record_heartbeat(&mut conn, &CihazKapsam::Platform, "dev_yok_boyle_bir_kayit")
        .await
        .expect_err("olmayan cihaz hatasi vermeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");
}

// ---------------------------------------------------------------------------
// Kayıt
// ---------------------------------------------------------------------------

#[tokio::test]
async fn kayit_edilen_cihaz_pref_ulid_alir() {
    let mut conn = conn().await;
    tenant_ekle(&mut conn, TENANT_A).await;

    let dto = cihaz_kaydet(&mut conn, TENANT_A, "  Kasa 1  ", " POS ")
        .await
        .expect("cihaz kaydedilir");

    // AGENTS.md §2: AUTOINCREMENT/UUID değil, pref ULID.
    assert!(dto.id.starts_with("dev_"), "{}", dto.id);
    assert_eq!(
        dto.id.len(),
        4 + 24,
        "pref + 24 karakter beklenir: {}",
        dto.id
    );
    // Kenarlıklar temizlenir; boşluk veritabanına yazılmaz.
    assert_eq!(dto.name, "Kasa 1");
    assert_eq!(dto.device_type, "POS");
    assert_eq!(dto.status, "ACTIVE");
    assert_eq!(dto.tenant_id, TENANT_A);
}

#[tokio::test]
async fn bos_alanli_kayit_reddedilir() {
    let mut conn = conn().await;
    tenant_ekle(&mut conn, TENANT_A).await;

    for (ad, tur, bekle) in [("   ", "POS", "cihaz adi"), ("Kasa 1", "  ", "cihaz turu")] {
        let hata = cihaz_kaydet(&mut conn, TENANT_A, ad, tur)
            .await
            .expect_err("bos alan reddedilmeli");
        assert!(hata.starts_with("VALIDATION"), "{bekle}: {hata}");
    }

    let hata = cihaz_kaydet(&mut conn, "  ", "Kasa", "POS")
        .await
        .expect_err("bos tenant reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

// ---------------------------------------------------------------------------
// Durum değiştirme
// ---------------------------------------------------------------------------

#[tokio::test]
async fn durum_degisimi_tek_yonlu_donus_yapar() {
    let mut conn = conn().await;
    tenant_ekle(&mut conn, TENANT_A).await;
    let id = cihaz_ekle(&mut conn, TENANT_A, "Kasa").await;

    let pasif = cihaz_durum_degistir(&mut conn, &id)
        .await
        .expect("durum degistirilir");
    assert_eq!(pasif.status, "INACTIVE");

    let aktif = cihaz_durum_degistir(&mut conn, &id)
        .await
        .expect("durum geri alinir");
    assert_eq!(aktif.status, "ACTIVE");

    let hata = cihaz_durum_degistir(&mut conn, "dev_yok")
        .await
        .expect_err("olmayan cihaz hatasi vermeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");
}
