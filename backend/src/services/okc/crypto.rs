//! GMP-3 eşleşme kriptografisi (belge §3.2, §3.3, §2.9).
//!
//! Anahtar türetimi: RFC 3526 grup 14 (2048 bit) Diffie-Hellman, TLS 1.2 PRF
//! (RFC 5246, HMAC-SHA256) ve AES-256-CBC. Bu dosya yalnız anahtar üretimini ve
//! gizlilik/bütünlük işlemlerini yapar; sertifika doğrulaması `pairing` içinde
//! `CertificateVerifier` arkasındadır ve varsayılanı reddetmektir.
//!
//! Belgede belirtilmeyen tek nokta mesaj başına IV'dir: her mesaj için rastgele
//! 16 baytlık IV üretilip şifreli verinin önüne eklenir (varsayım, belge dışı).

use aes::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use num_bigint::BigUint;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};

use super::types::{OkcError, OkcResult};

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

/// RFC 3526 grup 14 asalı. Değer, belgedeki formül
/// `2^2048 - 2^1984 - 1 + 2^64 * ([2^1918 pi] + 124476)` ile ayrıca doğrulanmıştır.
const MODP_2048_HEX: &str = "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF";

pub const DH_BYTES: usize = 256;
pub const GENERATOR: u32 = 2;

pub fn prime() -> OkcResult<BigUint> {
    // Sabit metin geçerlidir; yine de ayrıştırma başarısız olursa sıfır asalla
    // sessizce devam edilmez, eşleşme reddedilir.
    BigUint::parse_bytes(MODP_2048_HEX.as_bytes(), 16)
        .ok_or_else(|| OkcError::Crypto("DH asalı ayrıştırılamadı".to_string()))
}

/// Büyük-uçlu, sabit 256 bayt.
pub fn to_fixed(value: &BigUint) -> OkcResult<Vec<u8>> {
    let bytes = value.to_bytes_be();
    if bytes.len() > DH_BYTES {
        return Err(OkcError::Crypto("DH değeri 2048 bitten büyük".to_string()));
    }
    let mut out = vec![0u8; DH_BYTES - bytes.len()];
    out.extend(bytes);
    Ok(out)
}

/// Harici cihazın DH çifti: gizli üs 256 bit, açık değer `g^b mod p` (belge §3.2.1).
pub struct DhKeyPair {
    secret: BigUint,
    pub public: Vec<u8>,
}

impl DhKeyPair {
    pub fn generate() -> OkcResult<Self> {
        let p = prime()?;
        let mut raw = [0u8; 32];
        loop {
            OsRng.fill_bytes(&mut raw);
            let secret = BigUint::from_bytes_be(&raw);
            // Üs 2'den küçükse açık değer tahmin edilebilir olur.
            if secret > BigUint::from(2u8) {
                let public = BigUint::from(GENERATOR).modpow(&secret, &p);
                return Ok(Self {
                    secret,
                    public: to_fixed(&public)?,
                });
            }
        }
    }

    /// Karşı tarafın açık değerinden ön anahtarı (PRM) üretir. Değer `[2, p-2]`
    /// aralığında ve asal mertebeli alt grupta değilse reddedilir (RFC 2785).
    pub fn shared_secret(&self, peer_public: &[u8]) -> OkcResult<Vec<u8>> {
        let p = prime()?;
        let peer = BigUint::from_bytes_be(peer_public);
        let two = BigUint::from(2u8);
        let upper = &p - &two;
        if peer < two || peer > upper {
            return Err(OkcError::Crypto(
                "DH açık değeri izin verilen aralığın dışında".to_string(),
            ));
        }
        // Güvenli asal: (p-1)/2 mertebesinde olmayan değer küçük alt grup saldırısıdır.
        let q = (&p - BigUint::from(1u8)) >> 1;
        if peer.modpow(&q, &p) != BigUint::from(1u8) {
            return Err(OkcError::Crypto(
                "DH açık değeri beklenen alt grupta değil".to_string(),
            ));
        }
        to_fixed(&peer.modpow(&self.secret, &p))
    }
}

pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(block.map(|b| b ^ 0x36));
    inner.update(data);
    let inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(block.map(|b| b ^ 0x5C));
    outer.update(inner_digest);
    outer.finalize().into()
}

/// Sabit zamanlı karşılaştırma: HMAC ve anahtar kontrol değerinde zamanlama sızıntısı olmaz.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// TLS 1.2 PRF: `P_SHA256(secret, label || seed)` (RFC 5246 §5).
pub fn tls_prf(secret: &[u8], label: &str, seed: &[u8], out_len: usize) -> Vec<u8> {
    let mut label_seed = label.as_bytes().to_vec();
    label_seed.extend_from_slice(seed);
    let mut out = Vec::with_capacity(out_len + 32);
    let mut a = hmac_sha256(secret, &label_seed).to_vec();
    while out.len() < out_len {
        let mut input = a.clone();
        input.extend_from_slice(&label_seed);
        out.extend_from_slice(&hmac_sha256(secret, &input));
        a = hmac_sha256(secret, &a).to_vec();
    }
    out.truncate(out_len);
    out
}

/// Eşleşme sonunda üretilen simetrik anahtar takımı (belge §3.2 adım 7-8).
#[derive(Clone)]
pub struct SessionKeys {
    pub khmac: [u8; 32],
    pub iv: [u8; 16],
    pub kenc: [u8; 32],
}

impl SessionKeys {
    /// `master = PRF(PRM, "GMP-3 istek", rndExt || rndOkc)`, ardından
    /// `KHMAC = PRF(master)`, `IV = PRF(KHMAC)`, `KENC = PRF(IV)` (etiket "GMP-3 anahtarlar").
    pub fn derive(prm: &[u8], ext_random: &[u8; 16], okc_random: &[u8; 16]) -> OkcResult<Self> {
        let mut seed = ext_random.to_vec();
        seed.extend_from_slice(okc_random);
        let master = tls_prf(prm, "GMP-3 istek", &seed, 32);
        let khmac_bytes = tls_prf(&master, "GMP-3 anahtarlar", &seed, 32);
        let iv_bytes = tls_prf(&khmac_bytes, "GMP-3 anahtarlar", &seed, 16);
        let kenc_bytes = tls_prf(&iv_bytes, "GMP-3 anahtarlar", &seed, 32);
        let to_array = |label: &str| OkcError::Crypto(format!("{label} uzunluğu geçersiz"));
        Ok(Self {
            khmac: khmac_bytes.try_into().map_err(|_| to_array("KHMAC"))?,
            iv: iv_bytes.try_into().map_err(|_| to_array("IV"))?,
            kenc: kenc_bytes.try_into().map_err(|_| to_array("KENC"))?,
        })
    }

    /// Anahtar kontrol verisi: 32 adet `0xFF` baytın KENC ile CBC şifrelenmesi.
    pub fn key_check_value(&self) -> OkcResult<[u8; 32]> {
        let mut data = [0xFFu8; 32];
        let encryptor = Aes256CbcEnc::new_from_slices(&self.kenc, &self.iv)
            .map_err(|e| OkcError::Crypto(e.to_string()))?;
        encryptor
            .encrypt_padded_mut::<aes::cipher::block_padding::NoPadding>(&mut data, 32)
            .map_err(|e| OkcError::Crypto(e.to_string()))?;
        Ok(data)
    }
}

/// Belge §2.9: veri 32 baytın katı olsa da olmasa da dolgu uygulanır; dolgu verinin
/// soluna konur ve her dolgu baytı dolgu uzunluğunu taşır.
pub fn pad_left(data: &[u8]) -> Vec<u8> {
    let pad = 32 - (data.len() % 32);
    let mut out = vec![pad as u8; pad];
    out.extend_from_slice(data);
    out
}

pub fn unpad_left(data: &[u8]) -> OkcResult<Vec<u8>> {
    let pad = usize::from(
        *data
            .first()
            .ok_or_else(|| OkcError::Crypto("boş şifreli veri".to_string()))?,
    );
    if pad == 0
        || pad > 32
        || pad > data.len()
        || data[..pad].iter().any(|b| usize::from(*b) != pad)
    {
        return Err(OkcError::Crypto("dolgu geçersiz".to_string()));
    }
    Ok(data[pad..].to_vec())
}

/// Eşleşme sonrası finansal mesajları şifreleyen ve bankacılık grubunu doğrulayan kanal.
#[derive(Clone)]
pub struct SecureChannel {
    keys: SessionKeys,
}

impl SecureChannel {
    pub fn new(keys: SessionKeys) -> Self {
        Self { keys }
    }

    /// Çıktı: `IV(16) || AES-256-CBC(pad_left(plain))`.
    pub fn encrypt(&self, plain: &[u8]) -> OkcResult<Vec<u8>> {
        let mut iv = [0u8; 16];
        OsRng.fill_bytes(&mut iv);
        let mut buffer = pad_left(plain);
        let len = buffer.len();
        Aes256CbcEnc::new_from_slices(&self.keys.kenc, &iv)
            .map_err(|e| OkcError::Crypto(e.to_string()))?
            .encrypt_padded_mut::<aes::cipher::block_padding::NoPadding>(&mut buffer, len)
            .map_err(|e| OkcError::Crypto(e.to_string()))?;
        let mut out = iv.to_vec();
        out.extend(buffer);
        Ok(out)
    }

    pub fn decrypt(&self, data: &[u8]) -> OkcResult<Vec<u8>> {
        if data.len() < 48 || !(data.len() - 16).is_multiple_of(16) {
            return Err(OkcError::Crypto(
                "şifreli veri uzunluğu geçersiz".to_string(),
            ));
        }
        let (iv, cipher) = data.split_at(16);
        let mut buffer = cipher.to_vec();
        Aes256CbcDec::new_from_slices(&self.keys.kenc, iv)
            .map_err(|e| OkcError::Crypto(e.to_string()))?
            .decrypt_padded_mut::<aes::cipher::block_padding::NoPadding>(&mut buffer)
            .map_err(|e| OkcError::Crypto(e.to_string()))?;
        unpad_left(&buffer)
    }

    /// Bankacılık (finansal) grubunun HMAC doğrulama verisi.
    pub fn banking_hmac(&self, banking_group_value: &[u8]) -> [u8; 32] {
        hmac_sha256(&self.keys.khmac, banking_group_value)
    }

    pub fn key_check_value(&self) -> OkcResult<[u8; 32]> {
        self.keys.key_check_value()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prime_is_2048_bit_modp_group() {
        let p = prime().expect("asal");
        assert_eq!(p.bits(), 2048);
        // 2 üreteci (p-1)/2 mertebesindedir; belgedeki g=2 ile uyumlu.
        let q = (&p - BigUint::from(1u8)) >> 1;
        assert_eq!(BigUint::from(2u8).modpow(&q, &p), BigUint::from(1u8));
    }

    #[test]
    fn hmac_matches_rfc4231_case_1() {
        let key = [0x0Bu8; 20];
        let mac = hmac_sha256(&key, b"Hi There");
        assert_eq!(
            hex::encode(mac),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn dh_peers_agree_and_reject_weak_values() {
        let a = DhKeyPair::generate().expect("a");
        let b = DhKeyPair::generate().expect("b");
        assert_eq!(
            a.shared_secret(&b.public).expect("ab"),
            b.shared_secret(&a.public).expect("ba")
        );
        let mut one = vec![0u8; DH_BYTES];
        one[DH_BYTES - 1] = 1;
        assert!(a.shared_secret(&one).is_err());
        assert!(a.shared_secret(&vec![0u8; DH_BYTES]).is_err());
        let minus_one = to_fixed(&(prime().expect("asal") - BigUint::from(1u8))).expect("p-1");
        assert!(a.shared_secret(&minus_one).is_err());
    }

    #[test]
    fn prf_is_deterministic_and_length_exact() {
        let a = tls_prf(b"gizli", "etiket", b"tohum", 77);
        let b = tls_prf(b"gizli", "etiket", b"tohum", 77);
        assert_eq!(a.len(), 77);
        assert_eq!(a, b);
        assert_ne!(a[..32], tls_prf(b"gizli", "baska", b"tohum", 32)[..]);
    }

    #[test]
    fn padding_follows_spec_examples() {
        // Belge: 25 baytlık veri soluna yedi adet 07 alır; 32 baytlık veri otuz iki adet 20 alır.
        let padded = pad_left(&[0xAA; 25]);
        assert_eq!(&padded[..7], &[7u8; 7]);
        assert_eq!(padded.len(), 32);
        let padded = pad_left(&[0xAA; 32]);
        assert_eq!(&padded[..32], &[32u8; 32]);
        assert_eq!(padded.len(), 64);
        assert_eq!(unpad_left(&padded).expect("çöz"), vec![0xAA; 32]);
        assert!(unpad_left(&[3, 3, 2, 1]).is_err());
    }

    #[test]
    fn channel_round_trip_and_tamper_detection() {
        let keys = SessionKeys::derive(&[7u8; 256], &[1u8; 16], &[2u8; 16]).expect("anahtar");
        let channel = SecureChannel::new(keys);
        let sealed = channel.encrypt(b"fis verisi").expect("sifrele");
        assert_eq!(channel.decrypt(&sealed).expect("coz"), b"fis verisi");
        // IV'nin ilk baytını bozmak sol dolgunun ilk baytını bozar; bütünlüğün asıl
        // güvencesi bankacılık grubu HMAC'idir, CBC tek başına bütünlük vermez.
        let mut tampered = sealed.clone();
        tampered[0] ^= 1;
        assert!(channel.decrypt(&tampered).is_err());
        assert_ne!(
            channel.encrypt(b"x").expect("a"),
            channel.encrypt(b"x").expect("b"),
            "her mesaj kendi IV'sini taşır"
        );
    }

    #[test]
    fn key_check_value_is_stable_per_key() {
        let k1 = SessionKeys::derive(&[7u8; 256], &[1u8; 16], &[2u8; 16]).expect("k1");
        let k2 = SessionKeys::derive(&[7u8; 256], &[1u8; 16], &[2u8; 16]).expect("k2");
        let k3 = SessionKeys::derive(&[8u8; 256], &[1u8; 16], &[2u8; 16]).expect("k3");
        assert_eq!(
            k1.key_check_value().expect("a"),
            k2.key_check_value().expect("b")
        );
        assert_ne!(
            k1.key_check_value().expect("a"),
            k3.key_check_value().expect("c")
        );
    }
}
