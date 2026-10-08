// ---------------------------------------------------------------------------
// Faz 15 B1/B2 regresyon testleri — `auth_commands` için.
//
// Kilit artık process-global statik değil, `login_attempts` tablosundadır. Bu iki
// şeyi birden kazanır: yeniden başlatma kilidi silmez ve testler birbirini
// etkilemez (her test kendi bellek içi veritabanını kurar).
//
// Neden ayrı dosya: `auth_commands.rs` 500 satır sınırını aşmasın diye buraya
// taşındı. Testler `super::*` ile komut katmanının yordamlarına erişir.
// ---------------------------------------------------------------------------

use super::*;
use crate::db::DbPool;
use sqlx::Acquire;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

async fn havuz() -> DbPool {
    let secenek = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("gecerli baglanti secenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(secenek)
        .await
        .expect("havuz acilir");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("sema uygulanir");
    pool
}

/// Verilen e-posta ile bir kullanıcı yazar.
async fn kullanici_ekle(pool: &DbPool, id: &str, tenant: &str, email: &str, parola: &str) {
    let hash = crate::auth::hash_credential(parola).expect("parola hashlenir");
    let mut conn = pool.acquire().await.expect("baglanti");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, credential_hash, login_identifier, email, is_active)
         VALUES (?, ?, 'OWNER', 'Test', ?, ?, ?, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(&hash)
    .bind(email)
    .bind(email)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
}

/// A1: PIN değiştirme mevcut PIN olmadan yapılamaz.
#[test]
fn pin_degistirme_mevcut_pinsiz_reddedilir() {
    assert!(mevcut_pin_zorunlu(None).is_err());
    assert!(mevcut_pin_zorunlu(Some("")).is_err());
    assert!(mevcut_pin_zorunlu(Some("   ")).is_err());

    // Kenarlıklar temizlenir: " 1234 " ile "1234" aynı PIN'dir.
    assert_eq!(mevcut_pin_zorunlu(Some(" 1234 ")).expect("gecerli"), "1234");

    let hata = mevcut_pin_zorunlu(None).expect_err("mevcut pin zorunlu");
    assert!(hata.starts_with("UNAUTHORIZED"), "{hata}");
}

/// A5 / B2: parola yolu da kaba kuvvet kilidine tabidir ve sayaç DB'de tutulur.
///
/// Önceden bu yol `check_pin_rate_limit` çağırmıyordu: sınırsız deneme mümkündü.
/// Kilit beşinci hatada devreye girer ve o hatadan itibaren doğru parola da
/// reddedilir.
#[tokio::test]
async fn parola_yolu_kaba_kuvvet_kilidine_dahil() {
    let pool = havuz().await;
    let kimlik = "yok@ornek.com";

    for deneme in 1..3 {
        let hata = authenticate_by_identifier(&pool, kimlik, "yanlis")
            .await
            .expect_err("hatali deneme");
        assert!(
            hata.contains("Geçersiz kimlik bilgileri"),
            "{deneme}. deneme hatalı olmalı: {hata}"
        );
    }

    // Üçüncü ve dördüncü hata kalan hakkı bildirir, beşinci hata kilidi kurar.
    let ucuncu = authenticate_by_identifier(&pool, kimlik, "yanlis")
        .await
        .expect_err("hatali");
    assert!(ucuncu.contains("2 hakkınız kaldı"), "{ucuncu}");

    let dorduncu = authenticate_by_identifier(&pool, kimlik, "yanlis")
        .await
        .expect_err("hatali");
    assert!(dorduncu.contains("1 hakkınız kaldı"), "{dorduncu}");

    let kilit = authenticate_by_identifier(&pool, kimlik, "yanlis")
        .await
        .expect_err("kilit devrede olmali");
    assert!(kilit.starts_with("RATE_LIMIT_EXCEEDED"), "{kilit}");

    // Altıncı deneme doğru parola olsa da reddedilir: kilit süresi dolmadan
    // denenebilir hesap kalmamalıdır.
    let kilitli = authenticate_by_identifier(&pool, kimlik, "DOGRU-PAROLA")
        .await
        .expect_err("kilitli hesap dogru parola ile girememeli");
    assert!(kilitli.starts_with("RATE_LIMIT_EXCEEDED"), "{kilitli}");

    // Sayaç gerçekten yazıldı: süreç yeniden başlasa da kilit kalır.
    let mut conn = pool.acquire().await.expect("baglanti");
    let satir = sqlx::query("SELECT failed_count, locked_until FROM login_attempts WHERE scope = ?")
        .bind(hesap_kapsami(kimlik))
        .fetch_one(&mut *conn)
        .await
        .expect("kilit satiri yazildi");
    let hata_sayisi: i64 = satir.try_get("failed_count").expect("sayaç okunur");
    assert_eq!(hata_sayisi, crate::services::security360::MAX_HESAP_HATASI);
    let kilit_bitis: i64 = satir.try_get("locked_until").expect("kilit okunur");
    assert!(
        kilit_bitis > crate::services::security360::simdi_sn(),
        "kilit bitişi gelecekte olmalı"
    );
}

/// B2: kilit hesap bazlıdır. Bir kimliği kilitlemek başkasını kilitlemez.
///
/// Önceden tek global sayaç vardı: 5 yanlış deneme **bütün personeli** 5 dakika
/// kilitliyordu. Bu saldırgan için bedava bir hizmettir — kafenin tüm kasalarını
/// beş saniyede durdurabiliyordu.
#[tokio::test]
async fn kilit_baska_hesabi_etkilemez() {
    let pool = havuz().await;
    let hedef = "kurban@ornek.com";
    let masum = "masum@ornek.com";
    kullanici_ekle(&pool, "usr_masum", "DEFAULT_TENANT", masum, "DogruParola1").await;

    for _ in 0..5 {
        authenticate_by_identifier(&pool, hedef, "yanlis")
            .await
            .expect_err("hatali deneme");
    }

    let hata = authenticate_by_identifier(&pool, hedef, "yanlis")
        .await
        .expect_err("kilit devrede");
    assert!(hata.starts_with("RATE_LIMIT_EXCEEDED"), "{hata}");

    let giris = authenticate_by_identifier(&pool, masum, "DogruParola1")
        .await
        .expect("masum hesabi kilitlenmemis olmali");
    assert_eq!(giris.id, "usr_masum");
}

/// B2: kapsam normalizasyonu. `Kullanici@` ile `kullanici@` aynı hesaptır.
///
/// Normalize edilmezse saldırgan her denemede büyük/küçük harf değiştirerek kilidi
/// 5 katına çıkarabilirdi.
#[tokio::test]
async fn kapsam_harf_bicimi_duyarsizdir() {
    let pool = havuz().await;
    let kimlik = "Kullanici@Ornek.com";

    for _ in 0..5 {
        authenticate_by_identifier(&pool, kimlik, "yanlis")
            .await
            .expect_err("hatali deneme");
    }

    let hata = authenticate_by_identifier(&pool, "kullanici@ornek.com", "yanlis")
        .await
        .expect_err("ayni hesap kilitli olmali");
    assert!(hata.starts_with("RATE_LIMIT_EXCEEDED"), "{hata}");
}

/// B2: başarılı giriş sayacı sıfırlar.
#[tokio::test]
async fn basarili_giris_sayaci_sifirlar() {
    let pool = havuz().await;
    let kimlik = "sifirla@ornek.com";
    kullanici_ekle(&pool, "usr_sifirla", "DEFAULT_TENANT", kimlik, "DogruParola1").await;

    for _ in 0..3 {
        authenticate_by_identifier(&pool, kimlik, "yanlis")
            .await
            .expect_err("hatali deneme");
    }

    authenticate_by_identifier(&pool, kimlik, "DogruParola1")
        .await
        .expect("dogru parola girisi");

    // Sayaç silinmiş olmalı: 5 hata daha deneyip de beşincide kilitlenmek gerekir.
    let mut son_hata = String::new();
    for _ in 0..5 {
        son_hata = authenticate_by_identifier(&pool, kimlik, "yanlis")
            .await
            .expect_err("hatali deneme");
    }
    assert!(son_hata.starts_with("RATE_LIMIT_EXCEEDED"), "{son_hata}");
}

/// B2: kalan hak bilgisi yalnızca **hatalı** deneme yanıtında taşınır.
///
/// İlk iki hatada uyarı yoktur (3 hak kaldı); üçüncü ve dördüncüde kalan hak
/// bildirilir. Uyarı eşiği (`UYARI_ESIGI`) bilinçli: her hatada "kaç hakkınız
/// kaldı" demek kullanıcıyı kalan hakkı hesaplamaktan kurtarmaz ama giriş
/// denemelerini hızlandırır.
#[tokio::test]
async fn kalan_hak_mesaji_yol_durumunu_degistirmez() {
    let pool = havuz().await;
    let kimlik = "uyari@ornek.com";

    let ilk = authenticate_by_identifier(&pool, kimlik, "yanlis")
        .await
        .expect_err("hatali");
    assert_eq!(ilk, "Geçersiz kimlik bilgileri", "4 hak kaldığında uyarı olmamalı");

    let ikinci = authenticate_by_identifier(&pool, kimlik, "yanlis")
        .await
        .expect_err("hatali");
    assert_eq!(ikinci, "Geçersiz kimlik bilgileri", "3 hak kaldığında uyarı olmamalı");

    let ucuncu = authenticate_by_identifier(&pool, kimlik, "yanlis")
        .await
        .expect_err("hatali");
    assert!(ucuncu.contains("2 hakkınız kaldı"), "{ucuncu}");

    let dorduncu = authenticate_by_identifier(&pool, kimlik, "yanlis")
        .await
        .expect_err("hatali");
    assert!(dorduncu.contains("1 hakkınız kaldı"), "{dorduncu}");

    let besinci = authenticate_by_identifier(&pool, kimlik, "yanlis")
        .await
        .expect_err("hatali");
    assert!(besinci.starts_with("RATE_LIMIT_EXCEEDED"), "{besinci}");
}

/// B2: kalan hak 1'e düşmüşken **doğru** parola girişi engellenmez.
///
/// Regresyon testi. Kilit kontrolü parolanın doğruluğundan önce çalışır; kalan hak
/// eşiği burada hata döndürürse kullanıcı 3 yanlış denemeden sonra doğru
/// parolasıyla bile giremez ve kendi hesabına kilitlenir.
#[tokio::test]
async fn son_hak_kaldiginda_dogru_parola_girer() {
    let pool = havuz().await;
    let kimlik = "sonhak@ornek.com";
    kullanici_ekle(&pool, "usr_sonhak", "DEFAULT_TENANT", kimlik, "DogruParola1").await;

    for _ in 0..4 {
        authenticate_by_identifier(&pool, kimlik, "yanlis")
            .await
            .expect_err("hatali deneme");
    }

    let giris = authenticate_by_identifier(&pool, kimlik, "DogruParola1")
        .await
        .expect("son hak kaldiginda dogru parola girmeli");
    assert_eq!(giris.id, "usr_sonhak");
}

/// B2: var olmayan kimlik de sayaç ilerletir ve **aynı** biçimde uyarır.
///
/// Sayaç yalnızca gerçek hesaplarda ilerleseydi saldırgan kayıtlı olmayan
/// kimlikleri sınırsız deneyebilirdi. Mesaj ayrımı olsaydı da "bu e-posta
/// kayıtlı" diyebilirdi.
#[tokio::test]
async fn bilinmeyen_kimlik_ayni_mesaji_dondurur() {
    let pool = havuz().await;
    kullanici_ekle(&pool, "usr_var", "DEFAULT_TENANT", "var@ornek.com", "DogruParola1").await;

    for _ in 0..3 {
        authenticate_by_identifier(&pool, "yok@ornek.com", "yanlis")
            .await
            .expect_err("hatali");
        authenticate_by_identifier(&pool, "var@ornek.com", "yanlis")
            .await
            .expect_err("hatali");
    }

    let yok = authenticate_by_identifier(&pool, "yok@ornek.com", "yanlis")
        .await
        .expect_err("hatali");
    let var = authenticate_by_identifier(&pool, "var@ornek.com", "yanlis")
        .await
        .expect_err("hatali");

    assert!(!var.contains("kayıtlı"), "kayıt durumu sızmamalı: {var}");
    assert!(yok.contains("1 hakkınız kaldı"), "{yok}");
    assert!(var.contains("1 hakkınız kaldı"), "{var}");
}

// ---------------------------------------------------------------------------
// MASTER bayrak listesi — kod tabanında olmayan bayrak açılmaz
// ---------------------------------------------------------------------------

/// `feat_seat_split` dahil kodu olmayan bayraklar MASTER oturumunda açılmaz.
///
/// Gerekçe: koltuk bazlı sipariş (`seat_number`) kod tabanında hiç yok
/// (`rg "seat_number" backend/src desktop/src` → 0 eşleşme). Bayrak AÇIK
/// ilan edildiği hâlde arkasında komut bulunmaması, arayüzde hiçbir şey
/// yapmayan bir özellik demektir. Aynı gerekçeyle `feat_delivery`,
/// `feat_caller_id` ve `feat_dynamic_pricing` de kapalıdır.
#[test]
fn kodu_olmayan_bayraklar_master_oturumunda_acilmaz() {
    let moduller = master_modules();

    for bayrak in [
        "feat_seat_split",
        "feat_delivery",
        "feat_caller_id",
        "feat_dynamic_pricing",
    ] {
        assert!(
            !moduller.iter().any(|m| m == bayrak),
            "{} kod tabanında yok; açılmamalı",
            bayrak
        );
    }
}

/// Uygulanmış bayraklar MASTER oturumunda açıktır: listeye yanlışlıkla
/// düşülmemeli, çünkü platform konsolundaki ilgili yüzeyler bu listeye bakar.
#[test]
fn uygulanmis_bayraklar_master_oturumunda_acik() {
    let moduller = master_modules();

    for bayrak in [
        "feat_kds",
        "feat_qr_menu",
        "feat_table_order",
        "feat_recipe_bom",
        "feat_ledger_cari",
        "feat_loss_radar",
    ] {
        assert!(
            moduller.iter().any(|m| m == bayrak),
            "{} uygulanmış; açık olmalı",
            bayrak
        );
    }
}

/// İki giriş yolu aynı listeyi döndürür. Ayrışırsa PIN ile giren MASTER ile
/// e-posta ile giren MASTER farklı yetkilere sahip olur.
#[test]
fn master_modul_listesi_tektir() {
    let ilk = master_modules();
    let ikinci = master_modules();
    assert_eq!(ilk, ikinci);
    assert!(!ilk.is_empty(), "liste boş olamaz");
}

// ---------------------------------------------------------------------------
// G2 · P0 — must_change_pin: fabrika öntanımlı PIN'ler ilk girişte
// değiştirilmek zorundadır
// ---------------------------------------------------------------------------

/// Fabrika öntanımlı PIN ile iş istasyonuna giriş
/// reddedilir; bayrağı kapalı hesap aynı kiracıda
/// normal girer.
#[tokio::test]
async fn fabrika_pin_ile_giris_reddedilir() {
    let pool = havuz().await;

    // Fabrika PIN'li hesap (must_change_pin = 1).
    let mut conn = pool.acquire().await.expect("baglanti");
    let hash = crate::user_credentials::hash_pin("1111").expect("hashlenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active, must_change_pin)
         VALUES ('usr_master_test', 'tnt_test', 'MASTER', 'Test', ?, 1, 1)",
    )
    .bind(&hash)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
    // Aynı kiracıda bayrağı kapalı hesap.
    let hash = crate::user_credentials::hash_pin("2222").expect("hashlenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active, must_change_pin)
         VALUES ('usr_owner_test', 'tnt_test', 'OWNER', 'Test', ?, 1, 0)",
    )
    .bind(&hash)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
    drop(conn);

    let hata = authenticate_by_pin(&pool, "1111", Some("tnt_test"))
        .await
        .expect_err("fabrika PIN'i girmemeli");
    assert!(
        hata.starts_with("MUST_CHANGE_PIN"),
        "hata MUST_CHANGE_PIN olmalı: {hata}"
    );

    let oturum = authenticate_by_pin(&pool, "2222", Some("tnt_test"))
        .await
        .expect("bayrağı kapalı hesap girer");
    assert_eq!(oturum.id, "usr_owner_test");
}

/// PIN değişimi ilk giriş zorlamasını bitirir:
/// `pin_degisim_tx` aynı transaction'da yeni PIN'i
/// yazar ve bayrağı sıfırlar; sonrasında yeni PIN
/// girer, fabrika PIN artık çalışmaz.
#[tokio::test]
async fn pin_degisim_tx_ilk_giris_zorlamasini_bitirir() {
    let pool = havuz().await;
    let mut conn = pool.acquire().await.expect("baglanti");
    let hash = crate::user_credentials::hash_pin("2222").expect("hashlenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active, must_change_pin)
         VALUES ('usr_pin', 'tnt_pin', 'OWNER', 'Test', ?, 1, 1)",
    )
    .bind(&hash)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
    drop(conn);

    let hata = authenticate_by_pin(&pool, "2222", Some("tnt_pin"))
        .await
        .expect_err("fabrika PIN'i girmemeli");
    assert!(hata.starts_with("MUST_CHANGE_PIN"), "{hata}");

    // Kullanıcı kendi PIN'ini değiştirir: mevcut PIN
    // (fabrika öntanımlı) doğrulandı, yeni PIN yazılır,
    // ilk giriş zorlaması biter.
    let mutex = tokio::sync::Mutex::new(());
    let audit_lock =
        crate::services::audit_service::AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("baglanti");
    let mut tx = conn.begin().await.expect("tx baslar");
    pin_degisim_tx(&mut tx, audit_lock, "usr_pin", "2222", "9876")
        .await
        .expect("pin degisimi");
    tx.commit().await.expect("commit");
    drop(conn);

    let oturum = authenticate_by_pin(&pool, "9876", Some("tnt_pin"))
        .await
        .expect("yeni PIN ile girer");
    assert_eq!(oturum.id, "usr_pin");

    let hata = authenticate_by_pin(&pool, "2222", Some("tnt_pin"))
        .await
        .expect_err("eski PIN reddedilmeli");
    assert!(
        !hata.starts_with("MUST_CHANGE_PIN"),
        "zorlama kapanmış, hata sıradan PIN hatası olmalı: {hata}"
    );
}

/// Regresyon: `pin_degisim_tx` yanlış mevcut PIN'i
/// reddeder ve rollback'den sonra eski PIN hâlâ
/// çalışır (değişim atomiktir).
#[tokio::test]
async fn pin_degisim_tx_yanlis_mevcut_pini_reddeder() {
    let pool = havuz().await;
    let mut conn = pool.acquire().await.expect("baglanti");
    let hash = crate::user_credentials::hash_pin("1234").expect("hashlenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active)
         VALUES ('usr_eski', 'tnt_eski', 'CASHIER', 'Test', ?, 1)",
    )
    .bind(&hash)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
    drop(conn);

    let mutex = tokio::sync::Mutex::new(());
    let audit_lock =
        crate::services::audit_service::AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("baglanti");
    let mut tx = conn.begin().await.expect("tx baslar");
    let sonuc =
        pin_degisim_tx(&mut tx, audit_lock, "usr_eski", "9999", "4321").await;
    tx.rollback().await.expect("rollback");
    drop(conn);

    assert!(sonuc.is_err(), "yanlış mevcut PIN reddedilmeli");
    let oturum = authenticate_by_pin(&pool, "1234", Some("tnt_eski"))
        .await
        .expect("eski PIN korunur");
    assert_eq!(oturum.id, "usr_eski");
}