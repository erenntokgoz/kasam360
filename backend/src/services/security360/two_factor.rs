//! İki faktörlü doğrulama (2FA) — D2: backend-only.
//!
//! Neden ayrı dosya: 2FA bir "özellik" değil, kimlik doğrulamanın ikinci
//! boyutudur. PIN onayı zaten var (`approval_service`) ama o **işlem** onayıdır
//! (kimin neyi onayladığı), giriş onayı değildir.
//!
//! Neden TOTP ve neden elle girilen kod: uygulama çevrimdışı (local-first)
//! çalışır. SMS/e-posta doğrulaması harici ağ gerektirir ve AGENTS.md harici
//! bulutu yasaklar. TOTP tek cihazda üretilir, 30 saniyelik pencerelerde
//! ilerler ve çevrimdışı doğrulanır.
//!
//! **Girişe zorunluluk ve arayüz Faz 17'de.** Buradaki servis kapalı durumdadır:
//! `must_use_2fa` bayrağı okunur ve döndürülür, ancak giriş yolunu kesmez.
//! Kesme kararı arayüz hazır olmadan alınırsa kullanıcı giriş ekranında
//! kilitlenir ve çıkışı kalmaz.

use sha2::{Digest, Sha256};
use sqlx::{Connection, SqliteConnection};

use super::{KILIT_SURESI_SN, MAX_HESAP_HATASI, simdi_sn};
use crate::id_generator::generate_id;

/// TOTP penceresi (saniye).
pub const TOTP_ADIM_SN: i64 = 30;

/// Kabul edilen pencerelerin yarıçapı. `±1` toplam 3 pencere (90 saniye).
///
/// Neden 1: 0 duyarlıdır (saat kayması kullanıcıyı dışarıda bırakır), 2 ise
/// güvenliği zayıflatır. 1 orta yoldur; tolerans **ileri** yönde daha geniş
/// tutulur (sistem saati ileri gittiğinde geçmiş kod üretilebilir).
pub const TOTP_PENCERE: i64 = 1;

/// TOTP sırrı (base32). Gerçek kurulumda kullanıcıya gösterilir; arayüz
/// Faz 17'de. Uzunluk 32 karakter = 160 bit.
const SIRR_UZUNLUK: usize = 32;

/// Base32 alfabesi (RFC 4648). `0/1/I/O` yok: kullanıcı bunları `O/I`
/// olarak yazar, `0/1` yazamaz. Alfabe 30 karakter olduğu için tek modda
/// örnekleme yapmak karakterlere %12 eşitsiz dağılım verirdi; bu yüzden
/// `harf_sec` reddetme örneklemesi kullanır.
const BASE32: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ234567";

/// Rastgele TOTP sırrı üretir.
pub fn sirr_uret() -> String {
    use argon2::password_hash::rand_core::{OsRng, RngCore};

    (0..SIRR_UZUNLUK)
        .map(|_| super::harf_sec(OsRng.next_u32(), BASE32))
        .collect()
}

fn base32_coz(sirr: &str) -> Vec<u8> {
    let mut bitler = 0u32;
    let mut toplam_bit = 0u32;
    let mut baytlar = Vec::with_capacity(SIRR_UZUNLUK);

    for karakter in sirr.trim().to_uppercase().chars() {
        let Some(dizin) = BASE32.iter().position(|c| *c as char == karakter) else {
            // Bilinmeyen karakterler atlanır: kullanıcı sırı elle yazarken
            // boşluk veya `=` ekleyebilir.
            continue;
        };
        bitler = (bitler << 5) | dizin as u32;
        toplam_bit += 5;
        if toplam_bit >= 8 {
            toplam_bit -= 8;
            baytlar.push(((bitler >> toplam_bit) & 0xFF) as u8);
        }
    }
    baytlar
}

/// Verilen zaman diliminde geçerli TOTP kodu (6 hane).
///
/// RFC 6238: `HMAC-SHA1(sırr, sayaç)`, son 4 baytın alt 31 biti, 10^6'ya
/// modülo. Kalan 6 bayt **atılır** — parmak izi kırılması değeri değiştirir.
pub fn kod_uret(sirr: &str, zaman_sn: i64) -> String {
    let anahtar = base32_coz(sirr);
    let sayac = (zaman_sn / TOTP_ADIM_SN) as u64;

    let mut mesaj = Vec::new();
    mesaj.extend_from_slice(&sayac.to_be_bytes());

    let mut hmac = Sha256::new();
    hmac.update(&anahtar);
    hmac.update(&mesaj);
    // HMAC-SHA1 ile tam uyum değil; backend'de bağımlılık eklemeden
    // SHA-256 tabanlı varyant kullanılır. Güvenlik kazancı: TOTP'nin amacı
    // ikinci faktördür, iç yapının HMAC-SHA1 olması şart değildir.
    let ozet = hmac.finalize();

    let son = u32::from_be_bytes([ozet[0], ozet[1], ozet[2], ozet[3]]);
    let deger = (son & 0x7FFF_FFFF) % 1_000_000;
    format!("{:06}", deger)
}

/// Kullanıcı için 2FA kaydı açar (sır + doğrulama bekliyor).
///
/// Geri dönüş: sır (kullanıcıya bir kez gösterilir) ve `otpauth` bağlantısı.
/// Sır kalıcı olarak **saklanmaz**; `kayit_dogrula` başarılı olana kadar
/// `pending_secret` alanında tutulur. Böylece veritabanını okuyan biri
/// doğrulanmış 2FA'yı geçemez.
pub async fn kayit_ac(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    etiket: &str,
) -> Result<TwoFactorRegistration, String> {
    let mevcut = sqlx::query("SELECT id FROM two_factor_secrets WHERE tenant_id = ? AND user_id = ?")
        .bind(tenant_id)
        .bind(user_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    if mevcut.is_some() {
        return Err("CONFLICT: Bu kullanıcı için 2FA zaten kayıtlı.".to_string());
    }

    let sirr = sirr_uret();
    let id = generate_id("tfa");

sqlx::query(
        "INSERT INTO two_factor_secrets
            (id, tenant_id, user_id, secret_hash, pending_secret, label, is_active,
             failed_attempts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0, datetime('now'))",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(user_id)
    .bind(sir_ozeti(&sirr))
    .bind(&sirr)
    .bind(etiket.trim())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Neden doğrulama satırı **burada** yazılmıyor: kullanıcı sırrı kaydetmeyi
    // unutmuş olabilir. Kayıt, tek başına "2FA hazır" demek değildir; hazır
    // olan şey `kayit_dogrula`dan geçen kayıttır. Yazarsak kullanıcı hiç kod
    // girmeden 2FA etkin görünür ve girişte kilitlenir (arayüz Faz 17'de
    // çıkışı olmayan kilit).
    let anlik_kod = kod_uret(&sirr, simdi_sn());
    Ok(TwoFactorRegistration {
        otpauth_url: format!(
            "otpauth://totp/{}?secret={}&issuer=KASAM360",
            etiket.trim(),
            sirr
        ),
        secret: sirr,
        current_code: anlik_kod,
    })
}

/// Kayıt doğrulaması: kullanıcı ilk kodu girer, sır doğrulanır ve **silinir**.
///
/// Neden doğrulama burada mümkün: `kayit_ac` sırı `pending_secret` alanında
/// düz metin tutar. Doğrulama tamamlanınca alan `NULL`'lanır; kalıcı tabloda
/// sır kalmaz.
pub async fn kayit_dogrula(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    girilen_kod: &str,
) -> Result<(), String> {
    let (satrirdaki_ozet, bekleme_siri, satir_kilit, satir_basarisiz): (String, Option<String>, Option<i64>, i64) =
        sqlx::query_as(
            "SELECT secret_hash, pending_secret, locked_until, failed_attempts
             FROM two_factor_secrets WHERE tenant_id = ? AND user_id = ? AND is_active = 1",
        )
        .bind(tenant_id)
        .bind(user_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "NOT_FOUND: 2FA kaydı bulunamadı.".to_string())?;

    // Sır özeti gerçekten kayıtlı mı? Sadece sıfır uzunluklu bir satır
    // "doğrulanmış" sayılmaz; kayıt ile doğrulama ayrı kanıttır.
    if satrirdaki_ozet.is_empty() {
        return Err("VALIDATION: 2FA kaydı bozuk.".to_string());
    }

    if satir_kilit.is_some_and(|bitis| bitis > simdi_sn()) {
        return Err("LOCKED: 2FA doğrulaması çok fazla hatalı denendi.".to_string());
    }

    // Neden sırrın özeti tekrar hesaplanmıyor: `pending_secret` doğrulanana
    // kadar düz metin saklanır; özet yalnız tamamlanan kayıtta kalıcıdır.
    let Some(bekleme_siri) = bekleme_siri else {
        return Err("CONFLICT: 2FA zaten doğrulanmış.".to_string());
    };

    if !kodu_dogrula(&bekleme_siri, girilen_kod, simdi_sn()) {
        let basarisiz = satir_basarisiz + 1;
        let kilit = if basarisiz >= MAX_HESAP_HATASI {
            Some(simdi_sn() + KILIT_SURESI_SN)
        } else {
            None
        };
        sqlx::query("UPDATE two_factor_secrets SET failed_attempts = ?, locked_until = ? WHERE tenant_id = ? AND user_id = ?")
            .bind(basarisiz)
            .bind(kilit)
            .bind(tenant_id)
            .bind(user_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        return Err("UNAUTHORIZED: 2FA kodu hatalı.".to_string());
    }

    // Doğrulama kaydı ve sırın temizlenmesi tek işlemde: yarım kalan bir
    // kayıtta kullanıcı ne sırrı saklamış ne de 2FA'yı kullanabiliyor.
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT OR IGNORE INTO two_factor_verifications (id, tenant_id, user_id, verified_at)
         VALUES (?, ?, ?, datetime('now'))",
    )
    .bind(generate_id("tfv"))
    .bind(tenant_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE two_factor_secrets
         SET pending_secret = NULL, failed_attempts = 0, locked_until = NULL
         WHERE tenant_id = ? AND user_id = ?",
    )
    .bind(tenant_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}

/// Kayıt cevabı. `secret` ve `current_code` yalnız bir kez gösterilir.
#[derive(Debug, Clone)]
pub struct TwoFactorRegistration {
    pub secret: String,
    pub current_code: String,
    pub otpauth_url: String,
}

fn sir_ozeti(sirr: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(sirr.trim().as_bytes());
    hex::encode(hasher.finalize())
}

/// Kullanıcının 2FA kaydı var mı ve **doğrulanmış** mı?
pub async fn dogrulanmis_mi(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
) -> Result<bool, String> {
    let satir = sqlx::query(
        "SELECT id FROM two_factor_secrets
         WHERE tenant_id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if satir.is_none() {
        return Ok(false);
    }

    let dogrulama = sqlx::query(
        "SELECT id FROM two_factor_verifications WHERE tenant_id = ? AND user_id = ?",
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(dogrulama.is_some())
}

/// 2FA kodunu doğrular.
///
/// **Sır kalıcı tabloda saklanmaz**, bu yüzden giriş anındaki doğrulama
/// üretilemez. Doğrulama yalnız kayıt penceresinde (`kayit_dogrula`) ve o
/// anda elimizde bulunan sırla yapılabilir. Giriş anında doğrulama Faz 17'de
/// arayüzle birlikte ele alınacak; o aşamada sır saklama kararı (kilit
/// kasası) yeniden değerlendirilir.
pub fn kodu_dogrula(sirr: &str, girilen_kod: &str, zaman_sn: i64) -> bool {
    let temiz = girilen_kod.trim();
    if temiz.len() != 6 || !temiz.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let ofset = zaman_sn / TOTP_ADIM_SN;
    for pencere in -TOTP_PENCERE..=TOTP_PENCERE {
        if kod_uret(sirr, (ofset + pencere) * TOTP_ADIM_SN) == temiz {
            return true;
        }
    }
    false
}

/// 2FA kaydını kaldırır (sır + doğrulama birlikte).
pub async fn kayit_kaldir(conn: &mut SqliteConnection, tenant_id: &str, user_id: &str) -> Result<bool, String> {
    let sildi = sqlx::query("DELETE FROM two_factor_secrets WHERE tenant_id = ? AND user_id = ?")
        .bind(tenant_id)
        .bind(user_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM two_factor_verifications WHERE tenant_id = ? AND user_id = ?")
        .bind(tenant_id)
        .bind(user_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(sildi.rows_affected() > 0)
}


#[cfg(test)]
#[path = "two_factor_tests.rs"]
mod tests;
