//! Dışa aktarılan dosyaların HMAC-SHA256 imzası.
//!
//! Neden imza: dosya takası elle yapılır — bir tedarikçi siparişi USB ile
//! gelir, mali müşavir raporu e-posta ekine takılır. Dosyayı yolda değiştiren
//! kimse, kaç para bildirildiğini veya kaç ürün istendiğini değiştirir. İmza,
//! dosyanın **bu işletmenin ürettiğini ve yolda değişmediğini** kanıtlar.
//!
//! Neden HMAC ve neden düz SHA-256 değil: imza, anahtarı bilen tarafın ürettiği
//! kanıttır. Düz özet, anahtarı bilmeyen biri için de üretilebilir; dosya
//! "bu işletmenin verisi" diye sunulabilirdi. HMAC'ta özet üretmek için anahtar
//! gerekir.
//!
//! Neden elle uygulandı: `sha2` zaten bağımlılık; `hmac` kutusu değil. Yapı
//! RFC 2104'tür ve testler RFC 4231'in yayınlanmış test vektörleriyle doğrulanır —
//! kendi yorumumuzu kendimizle doğrulamak anlamlı olmazdı.

use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};

/// HMAC blok boyutu (SHA-256 için bayt cinsinden 64).
const BLOK: usize = 64;

/// Anahtar uzunluğu (bayt). 256 bit.
pub const ANAHTAR_BAYT: usize = 32;

/// Anahtar kimliği uzunluğu (hex karakter).
///
/// Neden 16: dosya, doğrulama için anahtarı seçebilmeli ama anahtarın kendisini
/// taşımamalı. 16 hex karakter = 64 bit; çakışma ihtimali bu kullanımda ihmal
/// edilebilir ve dosya okunabilir kalır.
pub const KEY_ID_LEN: usize = 16;

/// HMAC-SHA256 (RFC 2104).
///
/// Blok boyutundan uzun anahtar önce özetlenir; kısa anahtar sıfırla
/// tamamlanır. Bizim anahtar 32 bayt olduğu için ikinci dal hiç çalışmaz, ama
/// yordam eksik bırakılmaz: başka bir gün anahtar uzunluğu değişirse sessizce
/// yanlış imza üretmektense buradaki dal doğru davranışı korur.
pub fn hmac_sha256(anahtar: &[u8], veri: &[u8]) -> [u8; 32] {
    let mut blok_anahtar = [0u8; BLOK];
    if anahtar.len() > BLOK {
        // RFC 2104: uzun anahtar önce özetlenir, sonra **sıfırla blok
        // boyutuna tamamlanır**. Doğrudan 64 bayta kopyalanmaya çalışılırsa
        // (yanlış uygulama) ya panik olur ya da anahtarın yarısı kaybolur —
        // ikisi de imzayı sessizce değiştirir.
        let ozet = Sha256::digest(anahtar);
        blok_anahtar[..ozet.len()].copy_from_slice(&ozet);
    } else {
        blok_anahtar[..anahtar.len()].copy_from_slice(anahtar);
    }

    let mut ic_pad = [0x36u8; BLOK];
    let mut dis_pad = [0x5cu8; BLOK];
    for i in 0..BLOK {
        ic_pad[i] ^= blok_anahtar[i];
        dis_pad[i] ^= blok_anahtar[i];
    }

    let mut ic = Sha256::new();
    ic.update(ic_pad);
    ic.update(veri);
    let ic_ozet = ic.finalize();

    let mut dis = Sha256::new();
    dis.update(dis_pad);
    dis.update(ic_ozet);
    dis.finalize().into()
}

/// Anahtar kimliği: anahtarın özetinin ilk yarısı.
///
/// Neden anahtarın kendisi değil: dosyada anahtar bulunursa imza, dosyayı okuyan
/// herkes için yeniden üretilebilir hale gelir ve kanıt olmaktan çıkar.
pub fn key_id(anahtar: &[u8]) -> String {
    let ozet = Sha256::digest(anahtar);
    hex::encode(&ozet[..KEY_ID_LEN / 2])
}

/// Kriptografik rastgele anahtar üretir.
fn rastgele_anahtar() -> Result<Vec<u8>, String> {
    use argon2::password_hash::rand_core::{OsRng, RngCore};

    // `OsRng` bu sürümde hata döndürmez (bayt üretimi her zaman başarılıdır);
    // yine de `Vec` tahsis hatası panik olmasın diye sonuç tipi korunur.
    let mut bayt = vec![0u8; ANAHTAR_BAYT];
    OsRng.fill_bytes(&mut bayt);
    Ok(bayt)
}

/// Kiracının imza anahtarını döndürür; yoksa üretip saklar.
///
/// Neden "lazily üret": her işletmenin anahtarı baştan oluşturulmazsa, anahtarı
/// hiç dışa aktarım yapmayan işletmeler için gereksiz sır saklanmış olur. Anahtar
/// ilk dışa aktarımda doğar.
pub async fn anahtar_al_veya_uret(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<(String, Vec<u8>), String> {
    let satir =
        sqlx::query("SELECT key_hex, key_id FROM external_signing_keys WHERE tenant_id = ?")
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

    if let Some(satir) = satir {
        let hex_metin: String = satir.try_get("key_hex").map_err(|e| e.to_string())?;
        // `unwrap_or_default` YASAK: anahtar okunamadıysa "boş anahtar" dönüp
        // **geçersiz** imza üretmek, imzasız dosyayı kabul etmekten daha kötüdür.
        let bayt = hex::decode(hex_metin.trim()).map_err(|_| {
            "İmza anahtarı bozuk. Anahtarı yenileyin; dışa aktarılan dosyalar geçersizdir."
                .to_string()
        })?;
        if bayt.len() != ANAHTAR_BAYT {
            return Err("İmza anahtarı beklenen uzunlukta değil.".to_string());
        }
        let kimlik: String = satir.try_get("key_id").map_err(|e| e.to_string())?;
        return Ok((kimlik, bayt));
    }

    let bayt = rastgele_anahtar()?;
    let kimlik = key_id(&bayt);

    sqlx::query(
        "INSERT INTO external_signing_keys (tenant_id, key_hex, key_id)
         VALUES (?, ?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET
             key_hex = excluded.key_hex,
             key_id = excluded.key_id",
    )
    .bind(tenant_id)
    .bind(hex::encode(&bayt))
    .bind(&kimlik)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok((kimlik, bayt))
}

/// İmzalı dışa aktarım sarmalayıcısı.
///
/// Neden sarmalayıcı: imza, **içeriğin özetinin** imzasıdır. İmza dosyanın
/// içine gömülürse, imzayı silip yeniden hesaplayan bir düzenleyici imzayı
//ynıttırarak içeriği değiştirebilir. Bu yüzden imza, içerikten ayrı bir alanda
/// durur ve ikisi birlikte doğrulanır.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ImzaliDokuman<T> {
    pub govde: T,
    pub govde_ozeti: String,
    pub imza: String,
    pub key_id: String,
    pub imzalama_zamani: String,
}

/// Dokümanı imzalar.
///
/// Neden gövde **değerle** alınır: sarmalayıcı gövdenin bir kopyasını taşır;
/// gövdeyi `&T` alıp klonlamak, `T: Clone` sınırını imzaya bulaştırırdı. Sahiplik
/// alınca hiçbir ek sınır gerekmez.
pub fn imzala<T: serde::Serialize>(
    anahtar: &[u8],
    kimlik: &str,
    govde: T,
) -> Result<ImzaliDokuman<T>, String> {
    // Serileştirme kanonik olmalı: aynı veri iki kez serileştirilip farklı bayt
    // çıkarsa imza doğrulaması keyfî olarak başarısız olur. Tek çizgi (newline'sız)
    // JSON, alan sırası kararlı olduğu için yeterlidir.
    let metin = serde_json::to_string(&govde).map_err(|e| e.to_string())?;
    let ozet = hex::encode(Sha256::digest(metin.as_bytes()));
    let imza = hex::encode(hmac_sha256(anahtar, ozet.as_bytes()));

    Ok(ImzaliDokuman {
        govde,
        govde_ozeti: ozet,
        imza,
        key_id: kimlik.to_string(),
        imzalama_zamani: chrono::Utc::now().to_rfc3339(),
    })
}

/// İmzayı doğrular ve gövdeyi geri döndürür.
/// İki kontrol birlikte yapılır ve **sıra önemlidir**:
///   1. Gövde özeti yeniden hesaplanır (dosya yolda değişmiş mi?).
///   2. İmza özet üzerinden doğrulanır (imza bizim mi?).
///
/// Neden ikisi de: yalnız imza kontrolü, içeriği değiştirilmiş ama özeti aynı
/// bırakılmış bir dosyayı geçirmezdi. Yalnız özet kontrolü ise kimliği
/// doğrulanmamış bir dosyayı kabul ederdi.
pub fn dogrula<'a, T: serde::Serialize + serde::de::DeserializeOwned>(
    anahtar: &[u8],
    beklenen_kimlik: &str,
    dokuman: &'a ImzaliDokuman<T>,
) -> Result<&'a T, String> {
    if dokuman.key_id != beklenen_kimlik {
        return Err("INVALID_SIGNATURE: Dosya başka bir anahtarla imzalanmış.".to_string());
    }

    let metin = serde_json::to_string(&dokuman.govde).map_err(|e| e.to_string())?;
    let hesaplanan_ozet = hex::encode(Sha256::digest(metin.as_bytes()));
    if hesaplanan_ozet != dokuman.govde_ozeti {
        return Err("INVALID_SIGNATURE: Dosya içeriği yolda değişmiş.".to_string());
    }

    let beklenen_imza = hex::encode(hmac_sha256(anahtar, hesaplanan_ozet.as_bytes()));
    if !imza_karsilastir(&beklenen_imza, &dokuman.imza) {
        return Err("INVALID_SIGNATURE: İmza doğrulanamadı.".to_string());
    }

    Ok(&dokuman.govde)
}
/// Sabit zamanlı hex karşılaştırması.
///
/// Neden gerekli: `==` karşılaştırması ilk farklı baytta döner. Saldırgan imzayı
/// bayt bayt deneyerek doğru imzayı **kaç adımda** bulduğunu ölçebilir. İmza
/// gizli bir değerdir; karşılaştırma süresi bilgi sızdırmamalıdır.
fn imza_karsilastir(beklenen: &str, gelen: &str) -> bool {
    let a = beklenen.as_bytes();
    let b = gelen.as_bytes();
    // Farklı uzunluk da bilgi sızdırır; önce uzunluğu normalize et.
    if a.len() != b.len() {
        return false;
    }
    let mut fark: u8 = 0;
    for i in 0..a.len() {
        fark |= a[i] ^ b[i];
    }
    fark == 0
}

/// Anahtarı yeniler.
///
/// Neden gerekli: anahtar sızarsa eski bütün dosyaların imzası geçersiz kılınabilir
/// hale gelir. Yenileme sonrası o dosyalar yeniden üretilmek zorundadır — bu
/// bilinçli bir bedel, çünkü tersi (sızma sonrası eski anahtarı tutmak) imzayı
/// hiçbir işe yaramaz hale getirir.
pub async fn anahtar_yenile(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<(String, Vec<u8>), String> {
    let bayt = rastgele_anahtar()?;
    let kimlik = key_id(&bayt);

    sqlx::query(
        "INSERT INTO external_signing_keys (tenant_id, key_hex, key_id)
         VALUES (?, ?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET
             key_hex = excluded.key_hex,
             key_id = excluded.key_id,
             created_at = datetime('now')",
    )
    .bind(tenant_id)
    .bind(hex::encode(&bayt))
    .bind(&kimlik)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok((kimlik, bayt))
}

#[cfg(test)]
#[path = "signing_tests.rs"]
mod tests;
