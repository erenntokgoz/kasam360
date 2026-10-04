//! İmza testleri.
//!
//! HMAC doğrulaması **RFC 4231'in yayınlanmış test vektörleriyle** yapılır.
//! Kendi yazdığımız algoritmayı kendi yazdığımız testle doğrulamak anlamlı
//! değildir: iki hata birebir örtüşür ve test yeşil çıkar. Vektörler dışarıdan
//! geldiği için yeşil sonuç gerçekten bir şey ifade eder.
use super::super::super::security360::test_db::bellek;
use super::*;

async fn conn() -> SqliteConnection {
    bellek().await
}

#[test]
fn rfc4231_vektor_1() {
    // Test Case 1: 20 bayt 0x0b anahtarı, "Hi There" verisi.
    let anahtar = [0x0bu8; 20];
    let imza = hmac_sha256(&anahtar, b"Hi There");
    assert_eq!(
        hex::encode(imza),
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );
}

#[test]
fn rfc4231_vektor_2() {
    // Test Case 2: "Jefe" deyimine "what do ya want for nothing?".
    let imza = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
    assert_eq!(
        hex::encode(imza),
        "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    );
}

#[test]
fn rfc4231_vektor_3() {
    // Test Case 3: 20 bayt 0xaa anahtarı, 50 bayt 0xdd verisi.
    let imza = hmac_sha256(&[0xaau8; 20], &[0xddu8; 50]);
    assert_eq!(
        hex::encode(imza),
        "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe"
    );
}

#[test]
fn rfc4231_vektor_6() {
    // Test Case 6: **131 bayttan uzun** anahtar. Bu, "blok boyutundan uzun
    // anahtar önce özetlenir" dalını gerçekten çalıştırır; yanlış uygulama
    // (kırpmadan doğrudan XOR) yalnız bu vektörde yakalanır.
    let anahtar = [0xaau8; 131];
    let veri = b"Test Using Larger Than Block-Size Key - Hash Key First";
    let imza = hmac_sha256(&anahtar, veri);
    assert_eq!(
        hex::encode(imza),
        "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
    );
}

#[test]
fn rfc4231_vektor_7() {
    // Test Case 7: 131 bayt 0xaa anahtarı + **blok boyutundan uzun metin**.
    // Veri 0xdd tekrarı DEĞİLDİR (o, Test Case 4'ün verisidir); RFC'nin
    // uzun metnini birebir kullanmak gerekir.
    let anahtar = vec![0xaau8; 131];
    let veri = b"This is a test using a larger than block-size key and a larger \
                 than block-size data. The key needs to be hashed before being \
                 used by the HMAC algorithm.";
    let imza = hmac_sha256(&anahtar, veri);
    assert_eq!(
        hex::encode(imza),
        "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2"
    );
}

#[test]
fn rfc4231_vektor_4() {
    // Test Case 4: blok boyutundan **kısa ama 64'e yakın** anahtar + 50 bayt 0xcd.
    // Buradaki anahtar blok boyutuna tam *tam oturmaz*; sınır hatası (>= ile >)
    // yalnız bu vektörle yakalanır.
    let anahtar: Vec<u8> = (0x01u8..=0x19u8).collect();
    let imza = hmac_sha256(&anahtar, &[0xcdu8; 50]);
    assert_eq!(
        hex::encode(imza),
        "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b"
    );
}

#[test]
fn anahtar_kimligi_anahtari_sizdirmaz() {
    let anahtar = vec![7u8; ANAHTAR_BAYT];
    let kimlik = key_id(&anahtar);

    assert_eq!(kimlik.len(), KEY_ID_LEN);
    assert!(
        !kimlik.contains(&hex::encode(&anahtar)),
        "kimlik anahtarı içermemeli"
    );
    // Aynı anahtar -> aynı kimlik: dosya doğrulayıcısı anahtarı seçebilsin.
    assert_eq!(kimlik, key_id(&anahtar));
    // Farklı anahtar -> farklı kimlik.
    assert_ne!(kimlik, key_id(&[8u8; ANAHTAR_BAYT]));
}

// ---- anahtar üretimi ve saklanması ----

#[tokio::test]
async fn anahtar_uretildiginde_hepsi_ayni_anahtari_dondurur() {
    let mut conn = conn().await;
    let (kimlik, bayt) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("uret");
    let (kimlik2, bayt2) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("okur");

    assert_eq!(bayt.len(), ANAHTAR_BAYT);
    assert_eq!(kimlik, kimlik2);
    assert_eq!(bayt, bayt2, "anahtar her çağrıda yeniden üretilmemeli");
}

#[tokio::test]
async fn anahtar_kiracilar_arasinda_karismaz() {
    let mut conn = conn().await;
    let (_, a) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("a");
    let (_, b) = anahtar_al_veya_uret(&mut conn, "tenant_b")
        .await
        .expect("b");

    assert_ne!(a, b, "iki işletme aynı anahtarı taşıyamaz");
}

#[tokio::test]
async fn yenileme_eski_anahtari_gecersiz_kilar() {
    let mut conn = conn().await;
    let (_, eski) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("uret");
    let (_, yeni) = anahtar_yenile(&mut conn, "tenant_a").await.expect("yenile");

    assert_ne!(eski, yeni);
    let (_, sonraki) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("okur");
    assert_eq!(yeni, sonraki, "yenilenen anahtar kalici olmali");
}

#[tokio::test]
async fn bozuk_anahtar_sessizce_gecirilmez() {
    let mut conn = conn().await;
    sqlx::query("INSERT INTO external_signing_keys (tenant_id, key_hex, key_id) VALUES (?, ?, ?)")
        .bind("tenant_a")
        .bind("hex_degil_bu")
        .bind("0123456789abcdef")
        .execute(&mut conn)
        .await
        .expect("satir yazilir");

    // Anahtar okunamıyorsa hata yükselir: boş anahtarla imza üretmek, imzasız
    // dosyayı kabul etmekten daha kötüdür (sessiz sahte güvenlik).
    assert!(anahtar_al_veya_uret(&mut conn, "tenant_a").await.is_err());
}

// ---- imza doğrulama ----

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Ornek {
    ad: String,
    tutar_cents: i64,
}

#[test]
fn dogru_imzali_dokuman_gecer() {
    let anahtar = vec![1u8; ANAHTAR_BAYT];
    let kimlik = key_id(&anahtar);
    let govde = Ornek {
        ad: "Tedarikçi".into(),
        tutar_cents: 12_500,
    };

    let dokuman = imzala(&anahtar, &kimlik, govde.clone()).expect("imzalanir");
    let sonuc = dogrula(&anahtar, &kimlik, &dokuman).expect("gecer");

    assert_eq!(*sonuc, govde);
    assert_eq!(dokuman.key_id, kimlik);
}

#[test]
fn degistirilmis_govde_reddedilir() {
    let anahtar = vec![1u8; ANAHTAR_BAYT];
    let kimlik = key_id(&anahtar);
    let dokuman = imzala(
        &anahtar,
        &kimlik,
        Ornek {
            ad: "Tedarikçi".into(),
            tutar_cents: 12_500,
        },
    )
    .expect("imzalanir");

    // Saldırgan dosyadaki tutarı değiştirir, özeti **dokunmadan** bırakır.
    let mut sahte = dokuman.clone();
    sahte.govde.tutar_cents = 1;
    assert!(dogrula(&anahtar, &kimlik, &sahte).is_err());

    // Özeti de yeniden hesaplarsa elde edilen özet imzayı geçmez.
    let mut sahte2 = dokuman.clone();
    sahte2.govde.tutar_cents = 1;
    sahte2.govde_ozeti = hex::encode(Sha256::digest(
        serde_json::to_string(&sahte2.govde).unwrap().as_bytes(),
    ));
    assert!(dogrula(&anahtar, &kimlik, &sahte2).is_err());
}

#[test]
fn baska_anahtarla_imzalanmis_dokuman_reddedilir() {
    let anahtar_a = vec![1u8; ANAHTAR_BAYT];
    let anahtar_b = vec![2u8; ANAHTAR_BAYT];
    let kimlik_a = key_id(&anahtar_a);
    let kimlik_b = key_id(&anahtar_b);

    let dokuman = imzala(
        &anahtar_a,
        &kimlik_a,
        Ornek {
            ad: "X".into(),
            tutar_cents: 1,
        },
    )
    .expect("imzalanir");

    // B anahtarıyla imzalanmış gibi sunulan dosya reddedilir.
    assert!(dogrula(&anahtar_b, &kimlik_b, &dokuman).is_err());
}

#[test]
fn anahtar_kimligi_eskimis_dosyayi_karsilamaz() {
    let anahtar = vec![1u8; ANAHTAR_BAYT];
    let dokuman = imzala(
        &anahtar,
        &key_id(&anahtar),
        Ornek {
            ad: "X".into(),
            tutar_cents: 1,
        },
    )
    .expect("imzalanir");

    let hata = dogrula(&anahtar, "0123456789abcdef", &dokuman).expect_err("kimlik eskimis");
    assert!(hata.contains("başka bir anahtarla"));
}

#[test]
fn imza_alani_elle_degistirilirse_reddedilir() {
    let anahtar = vec![1u8; ANAHTAR_BAYT];
    let kimlik = key_id(&anahtar);
    let mut dokuman = imzala(
        &anahtar,
        &kimlik,
        Ornek {
            ad: "X".into(),
            tutar_cents: 1,
        },
    )
    .expect("imzalanir");

    dokuman.imza = "0".repeat(64);
    assert!(dogrula(&anahtar, &kimlik, &dokuman).is_err());
}

#[test]
fn imza_karsilastirma_uzunluk_farkinda_kisa_yol_vermez() {
    let anahtar = vec![1u8; ANAHTAR_BAYT];
    let kimlik = key_id(&anahtar);
    let mut dokuman = imzala(
        &anahtar,
        &kimlik,
        Ornek {
            ad: "X".into(),
            tutar_cents: 1,
        },
    )
    .expect("imzalanir");

    dokuman.imza = "00".to_string();
    assert!(dogrula(&anahtar, &kimlik, &dokuman).is_err());
}
