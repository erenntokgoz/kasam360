//! G2 · P0 — `login_attempts` kalıcılığı.
//!
//! Kaba kuvvet kilidi `login_attempts` tablosunda
//! durduğu için uygulama yeniden başlasa da
//! korunur. Kalıcılık **dosya tabanlı bir
//! veritabanıyla** kanıtlanır: bellek içi
//! (`sqlite::memory:`) bir bağlantı süreci
//! sona erdiğinde kaybolduğundan, restart
//! simülasyonu dosyadan yeni havuz açarak
//! yapılır.

use crate::services::security360::login_lockout::{
    basari_sifirla, hata_kaydet, kilit_kontrol, pin_kapsami,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;
use uuid::Uuid;

/// Geçici dizinde dosya tabanlı havuz kurar ve
/// şemayı uygular. Dönüş: (havuz, dosya yolu).
///
/// Neden dosya tabanlı: `sqlite::memory:` son
/// bağlantı kapanırken kaybolur; restart sonrası
/// kalıcılık ancak kalıcı bir dosyada ölçülebilir.
async fn dosya_havuzu() -> (SqlitePool, std::path::PathBuf) {
    let dosya = std::env::temp_dir().join(format!("kasam360_g2_lockout_{}.db", Uuid::new_v4()));
    let url = format!("sqlite://{}", dosya.to_string_lossy().replace('\\', "/"));
    let secenek = SqliteConnectOptions::from_str(&url)
        .expect("gecerli secenekler")
        .create_if_missing(true);
    let havuz = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(secenek)
        .await
        .expect("havuz acilir");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&havuz)
        .await
        .expect("sema uygulanir");
    (havuz, dosya)
}

/// Geçici veritabanı dosyasını kaldırır.
///
/// Neden retry: sqlx'in arka plan
/// bağlantı thread'leri dosya kilidini
/// drop'tan sonra birkaç saniye taşıyabilir;
/// silme kısa aralıklarla yeniden denenir
/// ve yoksa test failed eder.
fn dosya_sil(dosya: &std::path::Path) {
    for _ in 0..100 {
        match std::fs::remove_file(dosya) {
            Ok(()) => return,
            Err(hata) if hata.kind() == std::io::ErrorKind::NotFound => {
                return;
            }
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }
    panic!("gecici dosya silinemedi: {dosya:?}");
}

/// Aynı dosyadan yeni havuz açar (restart simülasyonu).
async fn yeniden_ac(dosya: &std::path::Path) -> SqlitePool {
    let url = format!("sqlite://{}", dosya.to_string_lossy().replace('\\', "/"));
    let secenek = SqliteConnectOptions::from_str(&url).expect("gecerli secenekler");
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(secenek)
        .await
        .expect("havuz yeniden acilir")
}

/// Kiracı kapsamına `MAX_HESAP_HATASI` hatalı
/// deneme yazar; beşincisi kilidi kurar.
async fn kilit_kur(havuz: &SqlitePool, kiraci: &str) {
    let mut conn = havuz.acquire().await.expect("baglanti");
    for _ in 0..crate::services::security360::MAX_HESAP_HATASI {
        hata_kaydet(&mut conn, kiraci, &pin_kapsami(kiraci))
            .await
            .expect("hata yazilir");
    }
}

/// Kilit, süreç yeniden başlayınca (yeni havuz,
/// aynı dosya) korunur.
///
/// Neden multi_thread: `Pool::close` arka
/// plan task'ı üzerinden bağlantıları
/// kapatır; current_thread runtime'da
/// `std::thread::sleep` bekleyişi o
/// task'ı çalıştırmaz ve dosya kilidi
/// çözülmez.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kilit_yeniden_baslatmada_kalir() {
    let (havuz, dosya) = dosya_havuzu().await;
    let kiraci = "tnt_kilitli";
    kilit_kur(&havuz, kiraci).await;

    // "Restart": havuzu kapat, aynı dosyadan yeni
    // havuz aç. Kilidin bellekte değil, tabloda
    // durduğunu kanıtlayan tek yol budur.
    havuz.close();
    drop(havuz);
    let ikinci = yeniden_ac(&dosya).await;

    // Bağlantı scoped block içinde tutulur: Windows'ta
    // dosya kilidi bağlantı kapanmadan kalkmadığından,
    // silme yalnızca blok sonrası yapılır.
    {
        let mut conn = ikinci.acquire().await.expect("baglanti");
        let hata = kilit_kontrol(&mut conn, &pin_kapsami(kiraci))
            .await
            .expect_err("kilit yeniden baslatmada korunmali");
        assert!(hata.starts_with("RATE_LIMIT_EXCEEDED"), "{hata}");
    }

    // `close()` arka plan task'ı üzerinden
    // bağlantıları kapatır; task'ın
    // çalışması için kısa bir bekleme.
    ikinci.close();
    std::thread::sleep(std::time::Duration::from_millis(300));
    drop(ikinci);
    dosya_sil(&dosya);
}

/// Kısmi sayaç da restart sonrası korunur: iki
/// hatalı deneme yazılıp temizlenmemişse, yeniden
/// başlatmadan sonra üçüncü hata "2 hak kaldı"
/// bildirir.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kismi_sayac_yeniden_baslatmada_kalir() {
    let (havuz, dosya) = dosya_havuzu().await;
    let kiraci = "tnt_kismi";
    {
        let mut conn = havuz.acquire().await.expect("baglanti");
        for _ in 0..2 {
            hata_kaydet(&mut conn, kiraci, &pin_kapsami(kiraci))
                .await
                .expect("hata yazilir");
        }
    }

    havuz.close();
    drop(havuz);
    let ikinci = yeniden_ac(&dosya).await;

    {
        let mut conn = ikinci.acquire().await.expect("baglanti");
        // Kilit hâlâ sürmüyor; yeni hata mevcut
        // sayıyı üzerine ekler.
        let durum = hata_kaydet(&mut conn, kiraci, &pin_kapsami(kiraci))
            .await
            .expect("hata yazilir");
        assert!(!durum.kilitli);
        assert_eq!(
            durum.kalan_hak,
            Some(2),
            "iki önceki hata korunmali: {:?}",
            durum
        );
    }

    ikinci.close();
    std::thread::sleep(std::time::Duration::from_millis(300));
    drop(ikinci);
    dosya_sil(&dosya);
}

/// Başarılı girişin sayacı temizlemesi de
/// restart sonrası kalır (silinen satır geri
/// gelmez).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn basarili_sifirlama_yeniden_baslatmada_kalir() {
    let (havuz, dosya) = dosya_havuzu().await;
    let kiraci = "tnt_temiz";
    {
        let mut conn = havuz.acquire().await.expect("baglanti");
        for _ in 0..3 {
            hata_kaydet(&mut conn, kiraci, &pin_kapsami(kiraci))
                .await
                .expect("hata yazilir");
        }
        basari_sifirla(&mut conn, &pin_kapsami(kiraci))
            .await
            .expect("sayaç temizlenir");
    }

    havuz.close();
    drop(havuz);
    let ikinci = yeniden_ac(&dosya).await;

    {
        let mut conn = ikinci.acquire().await.expect("baglanti");
        kilit_kontrol(&mut conn, &pin_kapsami(kiraci))
            .await
            .expect("temizlenen sayaç kilitlememeli");
        // Sıfırlanmış kapsamda yeni hata yeni turdan
        // başlar: dört hak kalır.
        let durum = hata_kaydet(&mut conn, kiraci, &pin_kapsami(kiraci))
            .await
            .expect("hata yazilir");
        assert_eq!(durum.kalan_hak, Some(4));
    }

    ikinci.close();
    std::thread::sleep(std::time::Duration::from_millis(300));
    drop(ikinci);
    dosya_sil(&dosya);
}
