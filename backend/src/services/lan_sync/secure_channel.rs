//! Cihazlar arası kimliği doğrulanmış, şifreli kanal.
//!
//! Her bağlantı geçici X25519 anahtarıyla açılır; böylece sonradan ele geçen
//! cihaz anahtarı eski trafiği çözemez. Üye bağlantısında iki taraf Ed25519 ile
//! dökümü imzalar ve açık anahtar küme üyeliğinden doğrulanır. İlk eşleştirmede
//! henüz üyelik yoktur; tek kullanımlık kod anahtar türetmeye katılır, kodu
//! bilmeyen taraf ilk çerçeveyi çözemez.
//!
//! Şifreleme ChaCha20-Poly1305'tir. Sayaçlı nonce tekrar ve sıra değişikliğini
//! ikinci bir denetime gerek bırakmadan yakalar.

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::agreement::{self, EphemeralPrivateKey, UnparsedPublicKey, X25519};
use ring::hkdf::{Salt, HKDF_SHA256};
use ring::rand::SystemRandom;
use ring::signature::{self, Ed25519KeyPair, KeyPair};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;

/// Anlık görüntü taşıyabilecek kadar büyük, belleği tüketmeyecek kadar küçük.
const MAX_FRAME: usize = 32 * 1024 * 1024;
const PROTOCOL: &str = "kasam360-sync-v1";

pub struct DeviceKey {
    pair: Ed25519KeyPair,
    pub public_key: String,
}

impl DeviceKey {
    fn from_pkcs8(pkcs8: &[u8]) -> Result<Self, String> {
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8).map_err(|e| e.to_string())?;
        let public_key = hex::encode(pair.public_key().as_ref());
        Ok(Self { pair, public_key })
    }

    /// Anahtar ilk kullanımda üretilir ve cihazdan çıkmaz.
    pub async fn load_or_create(conn: &mut SqliteConnection) -> Result<Self, String> {
        let stored = sqlx::query("SELECT private_pkcs8 FROM sync_device_key WHERE slot = 1")
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        if let Some(row) = stored {
            let text: String = row.try_get("private_pkcs8").map_err(|e| e.to_string())?;
            return Self::from_pkcs8(&hex::decode(text).map_err(|e| e.to_string())?);
        }
        let pkcs8 =
            Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).map_err(|e| e.to_string())?;
        let key = Self::from_pkcs8(pkcs8.as_ref())?;
        sqlx::query(
            "INSERT INTO sync_device_key (slot, private_pkcs8, public_key) VALUES (1, ?, ?)",
        )
        .bind(hex::encode(pkcs8.as_ref()))
        .bind(&key.public_key)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        Ok(key)
    }
}

/// Bağlantının kimlik yöntemi.
pub enum Auth<'a> {
    /// Tek kullanımlık eşleştirme anahtarı.
    Pairing { psk: &'a [u8] },
    /// Küme üyesi; `resolve` eş cihazın üyelikteki açık anahtarını verir.
    Member {
        key: &'a DeviceKey,
        cluster_id: &'a str,
        resolve: &'a (dyn Fn(&str) -> Option<String> + Sync),
    },
}

#[derive(Serialize, Deserialize)]
struct Hello {
    protocol: String,
    cluster_id: String,
    device_id: String,
    ephemeral: String,
}

#[derive(Serialize, Deserialize)]
struct Proof {
    signature: String,
}

pub struct SecureChannel<S> {
    stream: S,
    send_key: LessSafeKey,
    recv_key: LessSafeKey,
    send_counter: u64,
    recv_counter: u64,
}

/// Ayrı görevde okunabilen yarım kanal; okuma iptal edilirse çerçeve bölünmesin diye.
pub struct SecureReader {
    stream: OwnedReadHalf,
    key: LessSafeKey,
    counter: u64,
}

pub struct SecureWriter {
    stream: OwnedWriteHalf,
    key: LessSafeKey,
    counter: u64,
}

impl SecureChannel<TcpStream> {
    pub fn split(self) -> (SecureReader, SecureWriter) {
        let (read, write) = self.stream.into_split();
        (
            SecureReader {
                stream: read,
                key: self.recv_key,
                counter: self.recv_counter,
            },
            SecureWriter {
                stream: write,
                key: self.send_key,
                counter: self.send_counter,
            },
        )
    }
}

impl SecureWriter {
    pub async fn send<T: Serialize>(&mut self, value: &T) -> Result<(), String> {
        let mut body = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        self.key
            .seal_in_place_append_tag(nonce(self.counter), Aad::empty(), &mut body)
            .map_err(|_| "Şifreleme başarısız".to_string())?;
        self.counter += 1;
        write_frame(&mut self.stream, &body).await
    }
}

impl SecureReader {
    pub async fn recv<T: DeserializeOwned>(&mut self) -> Result<T, String> {
        let mut body = read_frame(&mut self.stream).await?;
        let plain = self
            .key
            .open_in_place(nonce(self.counter), Aad::empty(), &mut body)
            .map_err(|_| "UNAUTHORIZED: çerçeve doğrulanamadı".to_string())?;
        self.counter += 1;
        serde_json::from_slice(plain).map_err(|e| e.to_string())
    }
}

fn nonce(counter: u64) -> Nonce {
    let mut bytes = [0u8; 12];
    bytes[4..].copy_from_slice(&counter.to_be_bytes());
    Nonce::assume_unique_for_key(bytes)
}

async fn write_frame<S: AsyncWrite + Unpin>(stream: &mut S, body: &[u8]) -> Result<(), String> {
    if body.len() > MAX_FRAME {
        return Err("Çerçeve sınırı aşıldı".to_string());
    }
    let length = u32::try_from(body.len()).map_err(|e| e.to_string())?;
    stream
        .write_all(&length.to_be_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stream.write_all(body).await.map_err(|e| e.to_string())?;
    stream.flush().await.map_err(|e| e.to_string())
}

async fn read_frame<S: AsyncRead + Unpin>(stream: &mut S) -> Result<Vec<u8>, String> {
    let mut header = [0u8; 4];
    stream
        .read_exact(&mut header)
        .await
        .map_err(|e| e.to_string())?;
    let length = u32::from_be_bytes(header) as usize;
    if length > MAX_FRAME {
        return Err("Çerçeve sınırı aşıldı".to_string());
    }
    let mut body = vec![0u8; length];
    stream
        .read_exact(&mut body)
        .await
        .map_err(|e| e.to_string())?;
    Ok(body)
}

fn derive_key(salt: &[u8], secret: &[u8], label: &str) -> Result<LessSafeKey, String> {
    let info = [label.as_bytes()];
    let prk = Salt::new(HKDF_SHA256, salt).extract(secret);
    let okm = prk
        .expand(&info, &CHACHA20_POLY1305)
        .map_err(|_| "Anahtar türetilemedi".to_string())?;
    Ok(LessSafeKey::new(UnboundKey::from(okm)))
}

fn sign_payload(role: &str, transcript: &[u8]) -> Vec<u8> {
    [PROTOCOL.as_bytes(), role.as_bytes(), transcript].concat()
}

impl<S: AsyncRead + AsyncWrite + Unpin> SecureChannel<S> {
    pub async fn send<T: Serialize>(&mut self, value: &T) -> Result<(), String> {
        let mut body = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        self.send_key
            .seal_in_place_append_tag(nonce(self.send_counter), Aad::empty(), &mut body)
            .map_err(|_| "Şifreleme başarısız".to_string())?;
        self.send_counter += 1;
        write_frame(&mut self.stream, &body).await
    }

    pub async fn recv<T: DeserializeOwned>(&mut self) -> Result<T, String> {
        let mut body = read_frame(&mut self.stream).await?;
        let plain = self
            .recv_key
            .open_in_place(nonce(self.recv_counter), Aad::empty(), &mut body)
            .map_err(|_| "UNAUTHORIZED: çerçeve doğrulanamadı".to_string())?;
        self.recv_counter += 1;
        serde_json::from_slice(plain).map_err(|e| e.to_string())
    }

    /// Bağlantıyı açar. `is_initiator` taraflara ayrı anahtar yönü atar.
    pub async fn establish(
        mut stream: S,
        device_id: &str,
        auth: Auth<'_>,
        is_initiator: bool,
    ) -> Result<(Self, String), String> {
        let rng = SystemRandom::new();
        let private = EphemeralPrivateKey::generate(&X25519, &rng).map_err(|e| e.to_string())?;
        let public = private.compute_public_key().map_err(|e| e.to_string())?;
        let cluster_id = match &auth {
            Auth::Pairing { .. } => "",
            Auth::Member { cluster_id, .. } => cluster_id,
        };
        let hello = serde_json::to_vec(&Hello {
            protocol: PROTOCOL.to_string(),
            cluster_id: cluster_id.to_string(),
            device_id: device_id.to_string(),
            ephemeral: hex::encode(public.as_ref()),
        })
        .map_err(|e| e.to_string())?;

        let peer_hello = if is_initiator {
            write_frame(&mut stream, &hello).await?;
            read_frame(&mut stream).await?
        } else {
            let incoming = read_frame(&mut stream).await?;
            write_frame(&mut stream, &hello).await?;
            incoming
        };
        let peer: Hello = serde_json::from_slice(&peer_hello).map_err(|e| e.to_string())?;
        if peer.protocol != PROTOCOL || peer.cluster_id != cluster_id {
            return Err("UNAUTHORIZED: protokol veya küme eşleşmedi".to_string());
        }

        let (first, second) = if is_initiator {
            (&hello, &peer_hello)
        } else {
            (&peer_hello, &hello)
        };
        let mut digest = Sha256::new();
        digest.update(first);
        digest.update(second);
        let psk: &[u8] = match &auth {
            Auth::Pairing { psk } => psk,
            Auth::Member { .. } => b"",
        };
        digest.update(psk);
        let transcript = digest.finalize();

        let peer_ephemeral = hex::decode(&peer.ephemeral).map_err(|e| e.to_string())?;
        let (initiator_key, responder_key) = agreement::agree_ephemeral(
            private,
            &UnparsedPublicKey::new(&X25519, &peer_ephemeral),
            |shared| {
                Ok::<_, String>((
                    derive_key(&transcript, shared, "initiator")?,
                    derive_key(&transcript, shared, "responder")?,
                ))
            },
        )
        .map_err(|_| "UNAUTHORIZED: anahtar anlaşması başarısız".to_string())??;
        let (send_key, recv_key) = if is_initiator {
            (initiator_key, responder_key)
        } else {
            (responder_key, initiator_key)
        };
        let mut channel = Self {
            stream,
            send_key,
            recv_key,
            send_counter: 0,
            recv_counter: 0,
        };

        // İmza dökümü bağlar: iletiyi başka bağlantıya taşımak işe yaramaz.
        let (my_role, peer_role) = if is_initiator {
            ("initiator", "responder")
        } else {
            ("responder", "initiator")
        };
        let signature = match &auth {
            Auth::Pairing { .. } => String::new(),
            Auth::Member { key, .. } => {
                hex::encode(key.pair.sign(&sign_payload(my_role, &transcript)))
            }
        };
        channel.send(&Proof { signature }).await?;
        let proof: Proof = channel.recv().await?;
        if let Auth::Member { resolve, .. } = &auth {
            let public_key = resolve(&peer.device_id)
                .ok_or_else(|| "UNAUTHORIZED: cihaz küme üyesi değil".to_string())?;
            let public_key = hex::decode(public_key).map_err(|e| e.to_string())?;
            let proof_bytes = hex::decode(&proof.signature).map_err(|e| e.to_string())?;
            signature::UnparsedPublicKey::new(&signature::ED25519, public_key)
                .verify(&sign_payload(peer_role, &transcript), &proof_bytes)
                .map_err(|_| "UNAUTHORIZED: cihaz imzası geçersiz".to_string())?;
        }
        Ok((channel, peer.device_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    fn key() -> DeviceKey {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).expect("anahtar");
        DeviceKey::from_pkcs8(pkcs8.as_ref()).expect("anahtar")
    }

    #[tokio::test]
    async fn dogru_uyeler_sifreli_konusur() {
        let (a, b) = duplex(1 << 16);
        let (key_a, key_b) = (key(), key());
        let (public_a, public_b) = (key_a.public_key.clone(), key_b.public_key.clone());
        let resolve_a = move |id: &str| (id == "dev_b").then(|| public_b.clone());
        let resolve_b = move |id: &str| (id == "dev_a").then(|| public_a.clone());
        let auth_a = Auth::Member {
            key: &key_a,
            cluster_id: "cls",
            resolve: &resolve_a,
        };
        let auth_b = Auth::Member {
            key: &key_b,
            cluster_id: "cls",
            resolve: &resolve_b,
        };
        let (left, right) = tokio::join!(
            SecureChannel::establish(a, "dev_a", auth_a, true),
            SecureChannel::establish(b, "dev_b", auth_b, false),
        );
        let (mut left, right_id) = left.expect("sol");
        let (mut right, left_id) = right.expect("sağ");
        assert_eq!((left_id.as_str(), right_id.as_str()), ("dev_a", "dev_b"));
        left.send(&"tahsilat").await.expect("gönder");
        assert_eq!(right.recv::<String>().await.expect("al"), "tahsilat");
    }

    #[tokio::test]
    async fn uye_olmayan_cihaz_reddedilir() {
        let (a, b) = duplex(1 << 16);
        let (key_a, key_b) = (key(), key());
        let public_b = key_b.public_key.clone();
        // Sol taraf herkese güvenir; sağ taraf yabancıyı üyelikte bulamaz.
        let resolve_a = move |_: &str| Some(public_b.clone());
        let resolve_b = |_: &str| None;
        let auth_a = Auth::Member {
            key: &key_a,
            cluster_id: "cls",
            resolve: &resolve_a,
        };
        let auth_b = Auth::Member {
            key: &key_b,
            cluster_id: "cls",
            resolve: &resolve_b,
        };
        let (_, right) = tokio::join!(
            SecureChannel::establish(a, "dev_yabanci", auth_a, true),
            SecureChannel::establish(b, "dev_b", auth_b, false),
        );
        assert!(right.err().expect("red").starts_with("UNAUTHORIZED"));
    }

    #[tokio::test]
    async fn sahte_imza_kabul_edilmez() {
        let (a, b) = duplex(1 << 16);
        let (key_a, key_b, impostor) = (key(), key(), key());
        // Saldırgan dev_a kimliğini taşır ama anahtarı üyelikteki değildir.
        let public_a = key_a.public_key.clone();
        let public_b = key_b.public_key.clone();
        let resolve_a = move |_: &str| Some(public_b.clone());
        let resolve_b = move |_: &str| Some(public_a.clone());
        let auth_a = Auth::Member {
            key: &impostor,
            cluster_id: "cls",
            resolve: &resolve_a,
        };
        let auth_b = Auth::Member {
            key: &key_b,
            cluster_id: "cls",
            resolve: &resolve_b,
        };
        let (_, right) = tokio::join!(
            SecureChannel::establish(a, "dev_a", auth_a, true),
            SecureChannel::establish(b, "dev_b", auth_b, false),
        );
        assert!(right.err().expect("red").contains("imzası"));
    }

    #[tokio::test]
    async fn yanlis_eslestirme_kodu_cerceve_acamaz() {
        let (a, b) = duplex(1 << 16);
        let (left, right) = tokio::join!(
            SecureChannel::establish(a, "dev_a", Auth::Pairing { psk: b"dogru" }, true),
            SecureChannel::establish(b, "dev_b", Auth::Pairing { psk: b"yanlis" }, false),
        );
        assert!(left.is_err() || right.is_err());
    }

    #[tokio::test]
    async fn dogru_eslestirme_kodu_baglanir() {
        let (a, b) = duplex(1 << 16);
        let (left, right) = tokio::join!(
            SecureChannel::establish(a, "dev_a", Auth::Pairing { psk: b"kod" }, true),
            SecureChannel::establish(b, "dev_b", Auth::Pairing { psk: b"kod" }, false),
        );
        let (mut left, _) = left.expect("sol");
        let (mut right, _) = right.expect("sağ");
        right.send(&7i64).await.expect("gönder");
        assert_eq!(left.recv::<i64>().await.expect("al"), 7);
    }

    #[tokio::test]
    async fn degistirilen_cerceve_reddedilir() {
        let (a, mut relay_left) = duplex(1 << 16);
        let (mut relay_right, b) = duplex(1 << 16);
        let relay = tokio::spawn(async move {
            // Merhaba ve kanıtlar olduğu gibi geçer, veri çerçevesi bozulur.
            let hello = read_frame(&mut relay_left).await.expect("merhaba");
            write_frame(&mut relay_right, &hello).await.expect("ilet");
            let hello = read_frame(&mut relay_right).await.expect("merhaba");
            write_frame(&mut relay_left, &hello).await.expect("ilet");
            let proof = read_frame(&mut relay_left).await.expect("kanıt");
            write_frame(&mut relay_right, &proof).await.expect("ilet");
            let proof = read_frame(&mut relay_right).await.expect("kanıt");
            write_frame(&mut relay_left, &proof).await.expect("ilet");
            let mut data = read_frame(&mut relay_left).await.expect("veri");
            data[0] ^= 1;
            write_frame(&mut relay_right, &data).await.expect("ilet");
            (relay_left, relay_right)
        });
        let (left, right) = tokio::join!(
            SecureChannel::establish(a, "dev_a", Auth::Pairing { psk: b"kod" }, true),
            SecureChannel::establish(b, "dev_b", Auth::Pairing { psk: b"kod" }, false),
        );
        let (mut left, _) = left.expect("sol");
        let (mut right, _) = right.expect("sağ");
        left.send(&1i64).await.expect("gönder");
        let error = right.recv::<i64>().await.expect_err("bozuk çerçeve");
        assert!(error.starts_with("UNAUTHORIZED"), "{error}");
        relay.await.expect("aktarım");
    }
}
