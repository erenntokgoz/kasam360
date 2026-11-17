//! İstemci oturumu: istek-cevap döngüsü, sıra numarası, şifreli kanal ve hata kodları.
//!
//! Neden tek `exchange`: her mesajın cevabı aynı sıra numarasını taşımak zorundadır
//! (belge §3.2.5); doğrulama tek yerde yapılırsa hiçbir çağıran kontrolü atlayamaz.

use std::time::Duration;

use chrono::Local;

use super::crypto::SecureChannel;
use super::frame::{is_pairing_type, Gmp3Message, GROUP_BANK, GROUP_PAIR, TAG_HMAC};
use super::transport::Transport;
use super::types::{OkcError, OkcResult};

/// Harici yazılımın kimliği (belge §3.4.1: üretici adı, yazılım adı, sürüm).
#[derive(Debug, Clone)]
pub struct SoftwareIdentity {
    pub vendor: String,
    pub name: String,
    pub version: String,
}

impl Default for SoftwareIdentity {
    fn default() -> Self {
        Self {
            vendor: "KASAM360".to_string(),
            name: "KASAM360 POS".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

pub struct OkcClient {
    pub(super) transport: Box<dyn Transport>,
    pub(super) terminal_serial: String,
    pub(super) timeout: Duration,
    pub(super) seq: u32,
    pub(super) channel: Option<SecureChannel>,
    pub(super) device_index: u8,
    pub(super) software: SoftwareIdentity,
}

/// Cihaz hata kodunun insan okunur karşılığı. 10-90 belge §2.11.2'dedir;
/// 40 ve üzeri KASAM360 taslak kodlarıdır ve üretici belirtimiyle değişecektir.
pub fn describe_error(code: &str) -> &'static str {
    match code {
        "10" => "mesaj bütünlüğü doğrulama hatası",
        "11" => "geçersiz mesaj",
        "12" => "mesaj uzunluğu doğrulama hatası",
        "13" => "LRC doğrulama hatası",
        "20" => "bilinmeyen terminal seri numarası",
        "30" => "bilinmeyen etiket",
        "31" => "etiket uzunluğu hatası",
        "32" => "etiket verisi okuma hatası",
        "90" => "geçersiz işlem",
        "40" => "kağıt bitti veya yazıcı kapağı açık",
        "41" => "kart ödemesi reddedildi",
        "42" => "ödeme uygulaması yok",
        "50" => "fiş bu durumda bu işlemi kabul etmiyor",
        "51" => "kalem geçersiz",
        "52" => "toplam uyuşmazlığı",
        "53" => "sepet kimliği bilinmiyor",
        "54" => "ödeme toplamı fiş toplamıyla uyuşmuyor",
        "55" => "sıra numarası kabul edilmedi",
        _ => "bilinmeyen cihaz hatası",
    }
}

impl OkcClient {
    pub fn new(
        transport: Box<dyn Transport>,
        terminal_serial: &str,
        timeout: Duration,
        software: SoftwareIdentity,
    ) -> Self {
        Self {
            transport,
            terminal_serial: terminal_serial.to_string(),
            timeout,
            seq: 0,
            channel: None,
            device_index: 0,
            software,
        }
    }

    pub fn is_paired(&self) -> bool {
        self.channel.is_some()
    }

    pub(super) fn require_paired(&self) -> OkcResult<()> {
        if self.channel.is_none() {
            return Err(OkcError::NotPaired(
                "yetkili servisin yaptığı eşleştirme tamamlanmamış".to_string(),
            ));
        }
        Ok(())
    }

    /// Yeni istek iskeleti: sıra numarası bir artar ve tarih-saat damgası eklenir.
    /// Sayaç dolarsa yeniden eşleşme istenir; sıfıra dönmek eski paketlerin
    /// yeniden oynatılmasına kapı açacağı için belge davranışı bilerek izlenmez.
    pub(super) fn request(&mut self, msg_type: u32) -> OkcResult<Gmp3Message> {
        let next = self
            .seq
            .checked_add(1)
            .filter(|n| *n <= 999_999)
            .ok_or_else(|| {
                OkcError::NotPaired("işlem sıra sayacı doldu; yeniden eşleşme gerekir".to_string())
            })?;
        self.seq = next;
        Gmp3Message::new(&self.terminal_serial, msg_type).with_stamp(next, Local::now())
    }

    /// Finansal mesajın bankacılık grubuna HMAC ekler (belge §2.11.2, §4.3).
    pub(super) fn seal(&self, mut message: Gmp3Message) -> OkcResult<Gmp3Message> {
        if let Some(content) = message.group_content(GROUP_BANK)? {
            let channel = self.channel.as_ref().ok_or_else(|| {
                OkcError::NotPaired("bankacılık verisi eşleşme olmadan gönderilemez".to_string())
            })?;
            message = message.with_field(
                GROUP_PAIR,
                TAG_HMAC,
                channel.banking_hmac(&content).to_vec(),
            );
        }
        Ok(message)
    }

    fn verify_seal(&self, response: &Gmp3Message) -> OkcResult<()> {
        let Some(content) = response.group_content(GROUP_BANK)? else {
            return Ok(());
        };
        let channel = self.channel.as_ref().ok_or_else(|| {
            OkcError::NotPaired("şifreli cevap eşleşme olmadan doğrulanamaz".to_string())
        })?;
        let received = response.require(GROUP_PAIR, TAG_HMAC)?;
        if !super::crypto::constant_time_eq(&channel.banking_hmac(&content), received) {
            return Err(OkcError::Crypto(
                "cevabın bankacılık HMAC değeri uyuşmuyor".to_string(),
            ));
        }
        Ok(())
    }

    /// İsteği gönderir, cevabı alır ve doğrular. Cihaz hata kodu `Rejected` olur.
    pub(super) fn exchange(&mut self, request: Gmp3Message) -> OkcResult<Gmp3Message> {
        let secure = !is_pairing_type(request.msg_type);
        if secure {
            self.require_paired()?;
        }
        let request_seq = request.seq()?;
        let sealed = if secure { self.seal(request)? } else { request };
        let channel = if secure { self.channel.as_ref() } else { None };
        let expected_type = sealed.msg_type + 0x0400;
        let packet = sealed.encode(channel)?;
        self.transport.send(&packet)?;
        let raw = self.transport.recv(self.timeout)?;

        let response = match Gmp3Message::decode(&raw, channel) {
            Ok(message) => message,
            // Cihaz hata cevabını şifresiz gönderebilir (belge §3.4, madde 8).
            Err(secure_error) if secure => match Gmp3Message::decode(&raw, None) {
                Ok(plain) if plain.error_code().is_some() => plain,
                _ => return Err(secure_error),
            },
            Err(error) => return Err(error),
        };

        if response.terminal_serial != self.terminal_serial {
            return Err(OkcError::Protocol(
                "cevap başka bir terminal seri numarasından geldi".to_string(),
            ));
        }
        if let Some(code) = response.error_code() {
            if code != "00" {
                return Err(OkcError::Rejected {
                    message: describe_error(&code).to_string(),
                    code,
                });
            }
        }
        if response.msg_type != expected_type {
            return Err(OkcError::Protocol(format!(
                "beklenmeyen cevap tipi: {:06X}",
                response.msg_type
            )));
        }
        if response.seq()? != request_seq {
            return Err(OkcError::Protocol(
                "cevap sıra numarası isteğinkiyle aynı değil".to_string(),
            ));
        }
        if secure {
            self.verify_seal(&response)?;
        }
        Ok(response)
    }

    /// Karşı tarafın hâlâ çalışıp çalışmadığını ve anahtarların aynı olduğunu
    /// sorar (belge §3.4.4): istek anahtar kontrol verisini taşır.
    pub fn echo(&mut self) -> OkcResult<()> {
        // Cihaz eşleşme olmadan cevap vermez (belge §3.3); boşuna beklenmez.
        let check = self
            .channel
            .as_ref()
            .ok_or_else(|| {
                OkcError::NotPaired("yetkili servisin yaptığı eşleştirme tamamlanmamış".to_string())
            })?
            .key_check_value()?;
        let request = self
            .request(super::frame::MSG_ECHO_REQ)?
            .with_field(
                GROUP_PAIR,
                0xDFEF0B,
                self.software.version.as_bytes().to_vec(),
            )
            .with_field(GROUP_PAIR, 0xDFEF0E, check.to_vec())
            .with_field(GROUP_PAIR, 0xDFEF04, vec![0x01]);
        let response = self.exchange(request)?;
        let device_check = response.require(GROUP_PAIR, 0xDFEF0E)?;
        if !super::crypto::constant_time_eq(device_check, &check) {
            return Err(OkcError::Crypto(
                "anahtar kontrol verisi uyuşmuyor; yeniden eşleşme gerekir".to_string(),
            ));
        }
        Ok(())
    }
}
