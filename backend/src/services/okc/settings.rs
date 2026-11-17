//! Yazar kasa ayarları: kapalı/açık, bağlantı türü ve bağlantı noktası.
//!
//! Neden varsayılan kapalı: yazar kasa bağlanmamış bir işletmede tahsilat bu
//! katmandan etkilenmemeli. Açıldığında ise fail-closed çalışır: ayar geçersizse
//! veya cihaz yoksa tahsilat tamamlanmaz. Ayarlar cihaza (kasa bilgisayarına)
//! özgüdür; kablolu bağlantı bu bilgisayarın portuna bağlıdır.

use std::net::{IpAddr, SocketAddr};

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::types::{OkcError, OkcResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectionKind {
    Serial,
    Usb,
    Tcp,
    /// Yalnız geliştirme derlemesinde; sürüm derlemesinde reddedilir.
    Simulator,
}

impl ConnectionKind {
    pub fn as_db(self) -> &'static str {
        match self {
            Self::Serial => "SERIAL",
            Self::Usb => "USB",
            Self::Tcp => "TCP",
            Self::Simulator => "SIMULATOR",
        }
    }

    fn from_db(value: &str) -> OkcResult<Self> {
        match value {
            "SERIAL" => Ok(Self::Serial),
            "USB" => Ok(Self::Usb),
            "TCP" => Ok(Self::Tcp),
            "SIMULATOR" => Ok(Self::Simulator),
            other => Err(OkcError::Settings(format!(
                "bilinmeyen bağlantı türü: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OkcSettings {
    pub enabled: bool,
    pub connection_kind: ConnectionKind,
    /// Seri/USB için port adı (`COM3`, `/dev/ttyUSB0`); TCP için `ip:port`.
    pub port: String,
    pub baud_rate: i64,
    pub response_timeout_ms: i64,
    /// ÖKC mali seri numarası (en çok 12 karakter); cevaplar bununla eşlenir.
    pub terminal_serial: String,
}

impl Default for OkcSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            connection_kind: ConnectionKind::Tcp,
            port: String::new(),
            baud_rate: 115_200,
            response_timeout_ms: 5_000,
            terminal_serial: String::new(),
        }
    }
}

const WIRELESS_MARKERS: [&str; 6] = ["bluetooth", "bth", "wifi", "wi-fi", "wlan", "rfcomm"];

impl OkcSettings {
    pub fn validate(&self) -> OkcResult<()> {
        let bad = |message: &str| Err(OkcError::Settings(message.to_string()));
        if !(1_000..=30_000).contains(&self.response_timeout_ms) {
            return bad("cevap bekleme süresi 1000-30000 ms olmalıdır");
        }
        if !(1_200..=921_600).contains(&self.baud_rate) {
            return bad("baud hızı 1200-921600 aralığında olmalıdır");
        }
        if !self.enabled {
            return Ok(());
        }
        let serial = self.terminal_serial.trim();
        if serial.is_empty()
            || serial.len() > 12
            || !serial.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return bad("terminal seri numarası 1-12 harf veya rakam olmalıdır");
        }
        match self.connection_kind {
            ConnectionKind::Simulator => {
                if !cfg!(debug_assertions) {
                    return bad("simülatör yalnız geliştirme sürümünde kullanılabilir");
                }
            }
            ConnectionKind::Serial | ConnectionKind::Usb => {
                let port = self.port.trim();
                if port.is_empty() || port.len() > 64 {
                    return bad("bağlantı noktası boş olamaz");
                }
                let lowered = port.to_lowercase();
                if WIRELESS_MARKERS
                    .iter()
                    .any(|marker| lowered.contains(marker))
                {
                    return bad("kablosuz bağlantı kullanılamaz: yalnız kablolu seri veya USB");
                }
            }
            ConnectionKind::Tcp => {
                self.tcp_address()?;
            }
        }
        Ok(())
    }

    /// TCP adresi yalnız yerel ağ IP'si olabilir. Alan adı ve genel IP reddedilir:
    /// ÖKC ile bağlantı ağ geçidinin ötesine çıkmamalıdır. Kablolu olduğunu
    /// yazılım kanıtlayamaz; bu işletmenin kurulum sorumluluğudur.
    pub fn tcp_address(&self) -> OkcResult<SocketAddr> {
        let address: SocketAddr = self.port.trim().parse().map_err(|_| {
            OkcError::Settings("TCP bağlantı noktası `ip:port` biçiminde olmalıdır".to_string())
        })?;
        let local = match address.ip() {
            IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
            IpAddr::V6(ip) => ip.is_loopback(),
        };
        if !local || address.port() == 0 {
            return Err(OkcError::Settings(
                "TCP adresi yerel ağda (özel IP) ve geçerli bir portta olmalıdır".to_string(),
            ));
        }
        Ok(address)
    }
}

/// Kiracının ayarını okur; satır yoksa varsayılan (kapalı) döner.
pub async fn load(conn: &mut SqliteConnection, tenant_id: &str) -> Result<OkcSettings, String> {
    let row = sqlx::query(
        "SELECT enabled, connection_kind, port, baud_rate, response_timeout_ms, terminal_serial
         FROM okc_settings WHERE tenant_id = ?",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Ok(OkcSettings::default());
    };
    let kind: String = row.try_get("connection_kind").map_err(|e| e.to_string())?;
    Ok(OkcSettings {
        enabled: row
            .try_get::<i64, _>("enabled")
            .map_err(|e| e.to_string())?
            == 1,
        connection_kind: ConnectionKind::from_db(&kind).map_err(|e| e.to_command_error())?,
        port: row.try_get("port").map_err(|e| e.to_string())?,
        baud_rate: row.try_get("baud_rate").map_err(|e| e.to_string())?,
        response_timeout_ms: row
            .try_get("response_timeout_ms")
            .map_err(|e| e.to_string())?,
        terminal_serial: row.try_get("terminal_serial").map_err(|e| e.to_string())?,
    })
}

pub async fn save(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    settings: &OkcSettings,
) -> Result<(), String> {
    settings.validate().map_err(|e| e.to_command_error())?;
    sqlx::query(
        "INSERT INTO okc_settings
            (tenant_id, enabled, connection_kind, port, baud_rate, response_timeout_ms, terminal_serial, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(tenant_id) DO UPDATE SET
            enabled = excluded.enabled,
            connection_kind = excluded.connection_kind,
            port = excluded.port,
            baud_rate = excluded.baud_rate,
            response_timeout_ms = excluded.response_timeout_ms,
            terminal_serial = excluded.terminal_serial,
            updated_at = datetime('now')",
    )
    .bind(tenant_id)
    .bind(i64::from(settings.enabled))
    .bind(settings.connection_kind.as_db())
    .bind(settings.port.trim())
    .bind(settings.baud_rate)
    .bind(settings.response_timeout_ms)
    .bind(settings.terminal_serial.trim())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled(kind: ConnectionKind, port: &str) -> OkcSettings {
        OkcSettings {
            enabled: true,
            connection_kind: kind,
            port: port.to_string(),
            terminal_serial: "ABC123".to_string(),
            ..OkcSettings::default()
        }
    }

    #[test]
    fn default_is_disabled() {
        let defaults = OkcSettings::default();
        assert!(!defaults.enabled);
        assert!(defaults.validate().is_ok());
    }

    #[test]
    fn wireless_ports_are_refused() {
        assert!(enabled(ConnectionKind::Serial, "COM3").validate().is_ok());
        assert!(enabled(ConnectionKind::Serial, "Bluetooth Link COM7")
            .validate()
            .is_err());
        assert!(enabled(ConnectionKind::Usb, "/dev/rfcomm0")
            .validate()
            .is_err());
    }

    #[test]
    fn tcp_must_be_a_local_ip_literal() {
        assert!(enabled(ConnectionKind::Tcp, "192.168.1.50:5555")
            .validate()
            .is_ok());
        assert!(enabled(ConnectionKind::Tcp, "okc.example.com:5555")
            .validate()
            .is_err());
        assert!(enabled(ConnectionKind::Tcp, "8.8.8.8:5555")
            .validate()
            .is_err());
        assert!(enabled(ConnectionKind::Tcp, "192.168.1.50:0")
            .validate()
            .is_err());
        assert!(enabled(ConnectionKind::Tcp, "192.168.1.50")
            .validate()
            .is_err());
    }

    #[test]
    fn enabled_requires_a_valid_terminal_serial() {
        let mut settings = enabled(ConnectionKind::Serial, "COM3");
        settings.terminal_serial = String::new();
        assert!(settings.validate().is_err());
        settings.terminal_serial = "ÇOK-UZUN-NUMARA".to_string();
        assert!(settings.validate().is_err());
    }
}
