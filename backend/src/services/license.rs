//! İmzalı lisans belgesinin cihazda saklanması ve doğrulanması.
//!
//! Lisans kaynağı 360 Labs'tır; belge KASAM360 hesap servisinde Ed25519 ile imzalanır.
//! Kasa internetsiz de satış yapar: her işlemde sunucuya sorulmaz, saklanan belge gömülü
//! açık anahtarla burada doğrulanır. İmzası tutmayan, başka cihaza yazılmış veya süresi
//! (tolerans dahil) geçmiş belge hiçbir özelliği açmaz.

use chrono::{DateTime, Duration, Local, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

/// Hesap servisindeki `LICENSE_SIGNING_KEY` anahtarının açık yarısı (ham 32 bayt).
/// Anahtar değişirse bu değer de değişmeli; aksi hâlde hiçbir belge doğrulanmaz.
const PUBLIC_KEY_HEX: &str = "edc0cbf8a83a88e7d46632da9ef95e5a3a55d5dfd8305cb0a89d385a4aea2d15";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LicensePlan {
    pub name: String,
    pub features: Vec<String>,
    pub device_limit: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LicenseClaims {
    pub v: i64,
    pub product: String,
    pub sub: String,
    pub email: String,
    pub device_id: String,
    pub valid_until: Option<String>,
    pub blocked: bool,
    pub plan: Option<LicensePlan>,
    pub issued_at: String,
    pub grace_hours: i64,
}

/// Arayüzün okuduğu durum. `Active` ve `Grace` dışında özellik açılmaz.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LicenseState {
    /// Cihaz hiç bağlanmadı veya belge yok.
    Missing,
    Active,
    /// Bitiş günü geçti, tolerans süresi sürüyor; yenileme bekleniyor.
    Grace,
    Expired,
    /// Hesapta etkin paket yok.
    NoPackage,
    Blocked,
    /// İmza, ürün veya cihaz tutmuyor.
    Invalid,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub state: LicenseState,
    pub linked: bool,
    pub email: Option<String>,
    pub plan: Option<LicensePlan>,
    pub valid_until: Option<String>,
    pub features: Vec<String>,
    pub checked_at: Option<String>,
    pub last_error: Option<String>,
}

/// Belge `gövde.imza` biçimindedir; ikisi de base64url'dir ve imza gövde metni üzerindedir.
pub fn verify(token: &str) -> Result<LicenseClaims, String> {
    let public_key =
        hex::decode(PUBLIC_KEY_HEX).map_err(|_| "Açık anahtar okunamadı.".to_string())?;
    verify_with(token, &public_key)
}

fn verify_with(token: &str, public_key: &[u8]) -> Result<LicenseClaims, String> {
    let (body, signature) = token
        .split_once('.')
        .ok_or_else(|| "Lisans belgesi bozuk.".to_string())?;
    let signature = base64url(signature)?;
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, public_key)
        .verify(body.as_bytes(), &signature)
        .map_err(|_| "Lisans imzası doğrulanamadı.".to_string())?;
    let claims: LicenseClaims = serde_json::from_slice(&base64url(body)?)
        .map_err(|_| "Lisans belgesi okunamadı.".to_string())?;
    if claims.v != 1 || claims.product != "kasam360" {
        return Err("Lisans belgesi bu ürüne ait değil.".to_string());
    }
    Ok(claims)
}

fn base64url(text: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for byte in text.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            b'=' => continue,
            _ => return Err("Lisans belgesi bozuk.".to_string()),
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

/// Bitiş günü cihazın yerel takviminde gün sonuna kadar geçerlidir; ardından tolerans başlar.
pub fn state_of(claims: &LicenseClaims, device_id: &str, now: DateTime<Utc>) -> LicenseState {
    if claims.device_id != device_id {
        return LicenseState::Invalid;
    }
    if claims.blocked {
        return LicenseState::Blocked;
    }
    let (Some(until), Some(_)) = (claims.valid_until.as_deref(), claims.plan.as_ref()) else {
        return LicenseState::NoPackage;
    };
    let Ok(day) = NaiveDate::parse_from_str(until, "%Y-%m-%d") else {
        return LicenseState::Invalid;
    };
    let Some(end) = day
        .succ_opt()
        .and_then(|next| next.and_hms_opt(0, 0, 0))
        .and_then(|midnight| Local.from_local_datetime(&midnight).earliest())
        .map(|end| end.with_timezone(&Utc))
    else {
        return LicenseState::Invalid;
    };
    if now < end {
        LicenseState::Active
    } else if now < end + Duration::hours(claims.grace_hours.clamp(0, 24 * 30)) {
        LicenseState::Grace
    } else {
        LicenseState::Expired
    }
}

/// Lisans satırı ve bu kurulumun lisans cihaz kimliği. Kimlik ilk okumada üretilir.
pub struct Stored {
    pub device_id: String,
    pub license_key: Option<String>,
    pub token: Option<String>,
    pub checked_at: Option<String>,
    pub last_error: Option<String>,
}

pub async fn load(conn: &mut SqliteConnection) -> Result<Stored, String> {
    sqlx::query(
        "INSERT INTO device_license (slot, device_id) VALUES (1, ?) ON CONFLICT(slot) DO NOTHING",
    )
    .bind(crate::id_generator::generate_id("dev"))
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let row = sqlx::query(
        "SELECT device_id, license_key, token, checked_at, last_error FROM device_license WHERE slot = 1",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(Stored {
        device_id: row.try_get("device_id").map_err(|e| e.to_string())?,
        license_key: row.try_get("license_key").map_err(|e| e.to_string())?,
        token: row.try_get("token").map_err(|e| e.to_string())?,
        checked_at: row.try_get("checked_at").map_err(|e| e.to_string())?,
        last_error: row.try_get("last_error").map_err(|e| e.to_string())?,
    })
}

pub async fn save_key(conn: &mut SqliteConnection, key: &str) -> Result<(), String> {
    sqlx::query("UPDATE device_license SET license_key = ?, last_error = NULL WHERE slot = 1")
        .bind(key)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Sunucunun cevabı yazılır. `token` yoksa eldeki belge korunur, `drop_token` ise siler.
pub async fn record(
    conn: &mut SqliteConnection,
    token: Option<&str>,
    drop_token: bool,
    drop_key: bool,
    error: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE device_license SET
            token = CASE WHEN ? THEN NULL ELSE COALESCE(?, token) END,
            license_key = CASE WHEN ? THEN NULL ELSE license_key END,
            checked_at = CASE WHEN ? IS NULL THEN checked_at ELSE ? END,
            last_error = ?
         WHERE slot = 1",
    )
    .bind(drop_token)
    .bind(token)
    .bind(drop_key)
    .bind(token)
    .bind(Utc::now().to_rfc3339())
    .bind(error)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn status(stored: &Stored, now: DateTime<Utc>) -> LicenseStatus {
    let claims = stored.token.as_deref().map(verify);
    let (state, claims) = match claims {
        None => (LicenseState::Missing, None),
        Some(Err(_)) => (LicenseState::Invalid, None),
        Some(Ok(claims)) => (state_of(&claims, &stored.device_id, now), Some(claims)),
    };
    let features = match (&claims, state) {
        (Some(claims), LicenseState::Active | LicenseState::Grace) => claims
            .plan
            .as_ref()
            .map(|plan| plan.features.clone())
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    LicenseStatus {
        state,
        linked: stored.license_key.is_some(),
        email: claims.as_ref().map(|c| c.email.clone()),
        plan: claims.as_ref().and_then(|c| c.plan.clone()),
        valid_until: claims.as_ref().and_then(|c| c.valid_until.clone()),
        features,
        checked_at: stored.checked_at.clone(),
        last_error: stored.last_error.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn encode(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let n = chunk.iter().fold(0u32, |acc, b| (acc << 8) | u32::from(*b))
                << (8 * (3 - chunk.len()));
            for i in 0..=chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            }
        }
        out
    }

    fn claims(valid_until: Option<&str>) -> LicenseClaims {
        LicenseClaims {
            v: 1,
            product: "kasam360".into(),
            sub: "usr_1".into(),
            email: "a@example.test".into(),
            device_id: "dev_1".into(),
            valid_until: valid_until.map(str::to_string),
            blocked: false,
            plan: Some(LicensePlan {
                name: "Temel".into(),
                features: vec!["feat_kds".into()],
                device_limit: 1,
            }),
            issued_at: "2026-11-05T00:00:00Z".into(),
            grace_hours: 72,
        }
    }

    #[test]
    fn signature_must_match_the_exact_body() -> Result<(), String> {
        let rng = ring::rand::SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).map_err(|_| "anahtar")?;
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).map_err(|_| "anahtar")?;
        let body =
            encode(&serde_json::to_vec(&claims(Some("2027-01-31"))).map_err(|e| e.to_string())?);
        let token = format!("{body}.{}", encode(pair.sign(body.as_bytes()).as_ref()));
        assert_eq!(
            verify_with(&token, pair.public_key().as_ref())?,
            claims(Some("2027-01-31"))
        );
        let forged =
            encode(&serde_json::to_vec(&claims(Some("2099-01-31"))).map_err(|e| e.to_string())?);
        let (_, signature) = token.split_once('.').ok_or("biçim")?;
        assert!(verify_with(&format!("{forged}.{signature}"), pair.public_key().as_ref()).is_err());
        // Gömülü anahtar başka anahtarın imzasını kabul etmez.
        assert!(verify(&token).is_err());
        Ok(())
    }

    #[test]
    fn state_follows_device_block_package_and_grace() {
        let at = |text: &str| DateTime::parse_from_rfc3339(text).map(|t| t.with_timezone(&Utc));
        let Ok(now) = at("2027-01-31T09:00:00Z") else {
            return;
        };
        assert_eq!(
            state_of(&claims(Some("2027-01-31")), "dev_1", now),
            LicenseState::Active
        );
        assert_eq!(
            state_of(&claims(Some("2027-01-31")), "dev_2", now),
            LicenseState::Invalid
        );
        let Ok(later) = at("2027-02-02T12:00:00Z") else {
            return;
        };
        assert_eq!(
            state_of(&claims(Some("2027-01-31")), "dev_1", later),
            LicenseState::Grace
        );
        let Ok(much_later) = at("2027-02-10T00:00:00Z") else {
            return;
        };
        assert_eq!(
            state_of(&claims(Some("2027-01-31")), "dev_1", much_later),
            LicenseState::Expired
        );
        assert_eq!(
            state_of(&claims(None), "dev_1", now),
            LicenseState::NoPackage
        );
        let mut blocked = claims(Some("2027-01-31"));
        blocked.blocked = true;
        assert_eq!(state_of(&blocked, "dev_1", now), LicenseState::Blocked);
    }

    #[test]
    fn features_open_only_for_an_active_document() {
        let stored = Stored {
            device_id: "dev_1".into(),
            license_key: Some("lk_x".into()),
            token: Some("bozuk".into()),
            checked_at: None,
            last_error: None,
        };
        let status = status(&stored, Utc::now());
        assert_eq!(status.state, LicenseState::Invalid);
        assert!(status.features.is_empty());
    }
}
