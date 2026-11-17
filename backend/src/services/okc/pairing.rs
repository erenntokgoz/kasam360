//! Eşleşme akışı: INIT, KEYREQ, CLOSE (belge §3.2-§3.4).
//!
//! Gerçek cihazla eşleşme yalnız ÖKC üreticisinin yetkili servisi ve üreticinin
//! derlenmiş GMP-3 kütüphanesiyle yapılabilir (belge §3.3, §5.5). Bu uygulama
//! protokol adımlarını ve anahtar türetimini belgeye göre yapar; PÖKC sertifika
//! zincirinin doğrulanması `CertificateVerifier` arkasındadır ve varsayılan
//! doğrulayıcı HER ZAMAN reddeder: kök sertifikalar elde edilmeden eşleşme
//! başarılı sayılmaz (fail-closed).

use rand_core::{OsRng, RngCore};

use super::crypto::{prime, DhKeyPair, SecureChannel, SessionKeys, DH_BYTES, GENERATOR};
use super::frame::{
    Gmp3Message, GROUP_GIB, GROUP_PAIR, MSG_CLOSE_REQ, MSG_INIT_REQ, MSG_KEYREQ_REQ,
};
use super::session::OkcClient;
use super::tlv::bcd_decode;
use super::types::{OkcError, OkcResult};

/// PÖKC sertifikası ve A değerinin imzasını doğrular.
///
/// Uygulama şunları yapmak zorundadır (belge §3.2.3): biçim, tip, yayıncı,
/// anahtar kullanımı, geçerlilik, tüm zincirin imzası ve sertifika konusundaki
/// terminal seri numarasının beklenenle aynı olması; ardından RSASSA-PKCS1-v1_5
/// SHA-256 ile `signature` değerinin `signed_value` üzerindeki doğrulaması.
pub trait CertificateVerifier: Send + Sync {
    fn verify(
        &self,
        certificate: &[u8],
        terminal_serial: &str,
        signed_value: &[u8],
        signature: &[u8],
    ) -> OkcResult<()>;
}

/// Varsayılan doğrulayıcı: kök sertifika ve doğrulama kütüphanesi olmadığı için
/// her eşleşmeyi reddeder.
pub struct RejectingVerifier;

impl CertificateVerifier for RejectingVerifier {
    fn verify(&self, _: &[u8], _: &str, _: &[u8], _: &[u8]) -> OkcResult<()> {
        Err(OkcError::CertificateUnverified(
            "PÖKC sertifika zinciri doğrulayıcısı yapılandırılmadı".to_string(),
        ))
    }
}

/// Eşleşme sonucu; anahtarlar yalnız bellekte tutulur.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingInfo {
    pub okc_vendor: String,
    pub okc_model: String,
    pub okc_serial: String,
    pub key_revocation_counter: u32,
}

fn fixed_ascii(text: &str, len: usize) -> OkcResult<Vec<u8>> {
    if !text.is_ascii() || text.len() > len {
        return Err(OkcError::Protocol(format!(
            "alan {len} ASCII karakteri aşıyor: {text}"
        )));
    }
    let mut bytes = text.as_bytes().to_vec();
    bytes.resize(len, b' ');
    Ok(bytes)
}

fn trimmed(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim_end().to_string()
}

fn random16() -> [u8; 16] {
    let mut value = [0u8; 16];
    OsRng.fill_bytes(&mut value);
    value
}

impl OkcClient {
    fn gib_identity(&self) -> OkcResult<Vec<(u32, Vec<u8>)>> {
        Ok(vec![
            (0xDFC107, fixed_ascii(&self.software.vendor, 20)?),
            (0xDFC108, fixed_ascii(&self.software.name, 20)?),
            (0xDFC109, fixed_ascii(&self.software.version, 16)?),
        ])
    }

    /// Üç adımlı eşleşmeyi yürütür ve şifreli kanalı kurar. Her adımda cihazdan
    /// gelen değer doğrulanır; biri başarısızsa kanal kurulmaz.
    pub fn pair(&mut self, verifier: &dyn CertificateVerifier) -> OkcResult<PairingInfo> {
        // Her eşleşmede sayaç sıfırlanır (belge §3.2.5).
        self.seq = 0;
        self.channel = None;
        let ext_random = random16();

        // 1. INIT: yazılım kimliği ve rastsal sayı.
        let mut init = self.request(MSG_INIT_REQ)?;
        for (tag, value) in self.gib_identity()? {
            init = init.with_field(GROUP_GIB, tag, value);
        }
        init = init
            .with_field(GROUP_GIB, 0xDFC10D, ext_random.to_vec())
            .with_field(
                GROUP_PAIR,
                0xDFEF0B,
                fixed_ascii(&self.software.version, 16)?,
            );
        let init_response = self.exchange(init)?;
        let okc_vendor = trimmed(init_response.require(GROUP_GIB, 0xDFC10A)?);
        let okc_model = trimmed(init_response.require(GROUP_GIB, 0xDFC10B)?);
        let okc_serial = trimmed(init_response.require(GROUP_GIB, 0xDFC10C)?);
        let okc_random: [u8; 16] = init_response
            .require(GROUP_GIB, 0xDFC10E)?
            .try_into()
            .map_err(|_| OkcError::Protocol("ÖKC rastsal sayısı 16 bayt değil".to_string()))?;
        let certificate = init_response.require(GROUP_PAIR, 0xDFEF01)?.to_vec();
        self.device_index = init_response
            .field(GROUP_PAIR, 0xDFEF09)
            .and_then(|v| v.first().copied())
            .unwrap_or(0);

        // Cihazın bildirdiği DH parametreleri belgedeki grupla aynı olmak zorundadır;
        // zayıf veya özel grup kabul edilmez.
        let device_prime = init_response.require(GROUP_PAIR, 0xDFEF0C)?;
        let device_generator = init_response.require(GROUP_PAIR, 0xDFEF0D)?;
        let expected_prime = prime()?;
        if num_bigint::BigUint::from_bytes_be(device_prime) != expected_prime
            || device_generator != [GENERATOR as u8]
        {
            return Err(OkcError::Crypto(
                "ÖKC RFC 3526 grup 14 dışında DH parametresi bildirdi".to_string(),
            ));
        }
        if okc_serial != self.terminal_serial {
            return Err(OkcError::CertificateUnverified(
                "ÖKC seri numarası ayarlanan terminal seri numarasıyla aynı değil".to_string(),
            ));
        }

        // 2. KEYREQ: B = g^b mod p.
        let key_pair = DhKeyPair::generate()?;
        let mut keyreq = self.request(MSG_KEYREQ_REQ)?;
        for (tag, value) in self.gib_identity()? {
            keyreq = keyreq.with_field(GROUP_GIB, tag, value);
        }
        keyreq = keyreq
            .with_field(GROUP_GIB, 0xDFC10A, fixed_ascii(&okc_vendor, 20)?)
            .with_field(GROUP_GIB, 0xDFC10B, fixed_ascii(&okc_model, 20)?)
            .with_field(GROUP_GIB, 0xDFC10C, fixed_ascii(&okc_serial, 16)?)
            .with_field(GROUP_PAIR, 0xDFEF03, key_pair.public.clone())
            .with_field(GROUP_PAIR, 0xDFEF09, vec![self.device_index]);
        let keyreq_response = self.exchange(keyreq)?;
        let a_value = keyreq_response.require(GROUP_PAIR, 0xDFEF03)?;
        let signature = keyreq_response.require(GROUP_PAIR, 0xDFEF0A)?;
        if a_value.len() != DH_BYTES {
            return Err(OkcError::Protocol("A değeri 256 bayt değil".to_string()));
        }
        // İmza doğrulanmadan A ile hiçbir hesap yapılmaz.
        verifier.verify(&certificate, &self.terminal_serial, a_value, signature)?;

        let prm = key_pair.shared_secret(a_value)?;
        let keys = SessionKeys::derive(&prm, &ext_random, &okc_random)?;
        let check = keys.key_check_value()?;

        // 3. CLOSE: anahtar kontrol verisini cihaz kendi anahtarıyla karşılaştırır.
        let mut close = self.request(MSG_CLOSE_REQ)?;
        for (tag, value) in self.gib_identity()? {
            close = close.with_field(GROUP_GIB, tag, value);
        }
        close = close
            .with_field(GROUP_GIB, 0xDFC10A, fixed_ascii(&okc_vendor, 20)?)
            .with_field(GROUP_GIB, 0xDFC10B, fixed_ascii(&okc_model, 20)?)
            .with_field(GROUP_GIB, 0xDFC10C, fixed_ascii(&okc_serial, 16)?)
            .with_field(GROUP_PAIR, 0xDFEF0E, check.to_vec())
            .with_field(GROUP_PAIR, 0xDFEF09, vec![self.device_index]);
        let close_response: Gmp3Message = self.exchange(close)?;
        let revocation = match close_response.field(GROUP_PAIR, 0xDFEF02) {
            Some(value) => u32::try_from(bcd_decode(value)?)
                .map_err(|_| OkcError::Protocol("anahtar iptal sayacı taştı".to_string()))?,
            None => 0,
        };

        self.channel = Some(SecureChannel::new(keys));
        Ok(PairingInfo {
            okc_vendor,
            okc_model,
            okc_serial,
            key_revocation_counter: revocation,
        })
    }
}
