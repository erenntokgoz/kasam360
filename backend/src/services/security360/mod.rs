//! Faz 15 — giriş güvenliği: kaba kuvvet kilidi ve kimlik politikası.
//!
//! Neden servis katmanı: `auth_commands` Tauri `State` taşıdığı için
//! doğrudan test edilemez. Buradaki yordamlar `&mut SqliteConnection` alır,
//! böylece kilit ve politikalar komut katmanından bağımsız sınanır.
//!
//! Tasarım kararı — **kapsam başına sayaç, global sayaç yok**:
//!
//! Önceden tek bir global sayaç vardı ve beş hatalı deneme **bütün personeli**
//! beş dakika kilitliyordu. Bu, saldırgan için bedava bir hizmettir: 5 yanlış
//! PIN ile bir işletmenin tüm kasaları durdurulur. Kilit artık hesap (veya
//! PIN için kiracı) bazlıdır; kimse başkasını kilitleyemez.
//!
//! Eşiğin seçimi onay PIN'i kilidiyle aynıdır (`approval_service`:
//! 5 deneme / 300 saniye). Farklı eşik kullanmak, iki onay yüzeyinin aynı
//! güvenlik seviyesini vaat etmesini bozardı.

pub mod login_lockout;
#[cfg(test)]
mod login_lockout_tests;
pub mod mask;
pub mod money_gate;
pub mod policy;
pub mod session;
pub mod threshold;
pub mod two_factor;

/// Üretilen parolaların harf dizisindeki karakterler.
///
/// Neden `OsRng`: `rand` çekirdeği değil, işletim çekirdeğinden gelen baytlar
/// kullanılır (`argon2` de aynı kaynağı kullanıyor — tek doğruluk noktası).
/// Karışık büyük/küçük harf + rakam gövdesi, kullanıcıya yazdırılıp elle yazıldığında
/// klavye düzenine göre tahmin edilebilirliği düşürür. `l`, `I`, `O`, `0` gibi
/// karışan karakterler çıkarıldı; `1`/`0` gibi belirsiz olanlar da yok.
const PAROLA_ABC: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
const PAROLA_ABC_BUYUK: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
const PAROLA_RAKAM: &[u8] = b"23456789";
const PAROLA_TUM: &[u8] = b"abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// Kriptografik rastgele parola üretir.
///
/// Neden `Uuid::new_v4()` değil: tek çağrıda 4,3 milyar olasılık sunar;
/// `uuid[..8]` ile kesildiğinde **32 bit** entropiye düşer. 20 karakterlik
/// gövde burada ~114 bit verir.
///
/// **Kurallar garanti edilir, deneme-yanlışa değil.** İlk üç konuma küçük
/// harf, büyük harf ve rakam sabit olarak konur. Rastgele seçimle üretilen bir
/// gövdenin rakamsız olma olasılığı 20 karakterde bile sıfır değildir (yaklaşık
/// 1/6000) ve bu durumda `parola_dogrula` çağıranı hata döndürür — üretici
/// çıktısının geçerli olduğu varsayımı bozulur. Sabit konumlar entropiyi
/// ihmal edilebilir biçimde azaltır (57^20 → 47·43·8·57^17).
///
/// **Reddetme örneklemesi**: `bayt % 57` yazılsaydı alfabenin ilk 28 harfi
/// orantısız sıklıkta çıkardı. Tahmin edilebilirlik %1'in altına inmesi için
/// `SINIR`'dan büyük baytlar reddedilir.
pub fn rastgele_parola(uzunluk: usize) -> String {
    use argon2::password_hash::rand_core::{OsRng, RngCore};

    // En az 4: üç sabit konum (küçük harf, büyük harf, rakam) + bir rastgele konum.
    let uzunluk = uzunluk.max(4);

    let mut karakterler: Vec<char> = vec![
        harf_sec(OsRng.next_u32(), PAROLA_ABC),
        harf_sec(OsRng.next_u32(), PAROLA_ABC_BUYUK),
        harf_sec(OsRng.next_u32(), PAROLA_RAKAM),
    ];

    for _ in 3..uzunluk {
        karakterler.push(harf_sec(OsRng.next_u32(), PAROLA_TUM));
    }

    karakterler.into_iter().collect()
}

/// Kriptografik rastgele bayt (0-255).
///
/// Neden ayrı yordam: TOTP sırrı gibi "N bayt iste, sonra alfabele eşle"
/// biçimindeki üreticiler `OsRng.next_u32()`'ı kendileri çağıramaz —
/// `OsRng` `RngCore` implementasyonunu `Rng`'in üzerinden sunar. Tek kaynak
/// burada toplanır.
pub fn rastgele_bayt() -> u8 {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    OsRng.next_u32() as u8
}

/// Reddetme örneklemesiyle bir alfabenin `u32` çıktısından karakter seçer.
///
/// Neden `u32`: `u8` tek çağrıda 8 bit verir ve her karakter için yeni `OsRng`
/// çağrısı gerektirir; `u32` tek çağrıda 32 bit verir.
///
/// Neden `pub(crate)`: 2FA sırı da harf seçer. İki ayrı örnekleyici
/// kullanırsak biri unutulur ve diğeri sessizce yanlış dağılım üretir.
pub(crate) fn harf_sec(uretilen: u32, alfabe: &[u8]) -> char {
    use argon2::password_hash::rand_core::{OsRng, RngCore};

    // 2^32, alfabe uzunluğunun katı olmayan en büyük değere kadar kırpılır.
    let sinir = (u32::MAX as u64 + 1) - ((u32::MAX as u64 + 1) % alfabe.len() as u64);
    let mut deger = uretilen as u64;
    while deger >= sinir {
        deger = OsRng.next_u32() as u64;
    }
    alfabe[(deger % alfabe.len() as u64) as usize] as char
}

/// Hesap bazlı kilit eşiği.
pub const MAX_HESAP_HATASI: i64 = 5;

/// Kilit süresi (saniye).
pub const KILIT_SURESI_SN: i64 = 300;

/// Kalan hakkı bu değerin altına düşünce kullanıcıya uyarı gösterilir.
pub const UYARI_ESIGI: i64 = 2;

/// Unix saniyesini döner.
///
/// Neden tek yerden: kilit hesabı testte de üretilir; iki çağrı yeri ayrı
/// zaman kaynağı kullanırsa test bir gün, üretim başka bir gün kapanır.
pub fn simdi_sn() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Testler için bellek içi bağlantı + şema.
///
/// Neden tek yer: her test modülü kendi bağlantısını kurarsa şema N kez
/// uygulanır ve her modülde `include_str` yolu ayrı ayrı bozulabilir. Yeni
/// tablo eklendiğinde tek nokta güncellenir.
#[cfg(test)]
pub(crate) mod test_db {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::SqliteConnection;
    use std::str::FromStr;

    pub async fn bellek() -> SqliteConnection {
        let secenek = SqliteConnectOptions::from_str("sqlite::memory:")
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

        havuz.acquire().await.expect("baglanti").detach()
    }
}
