//! GMP-3 paket çerçevesi: uzunluk, terminal seri no, mesaj tipi, alan grupları, LRC.
//!
//! Belge §2.6-§2.11 ve §3.4 örnek paketlerinden çıkarılan düzen:
//! `[uzunluk:2][terminal seri no:12][mesaj tipi:3][TLV uzunluğu][gruplar...][LRC:1]`.
//! DOĞRULANMADI: LRC algoritması ve uzunluğun kapsamı belgede metin olarak
//! tanımlı değildir; burada LRC mesaj tipi etiketinden son veri baytına kadar XOR,
//! uzunluk ise seri no'dan LRC'ye kadar olan bayt sayısıdır. Gerçek cihazla
//! sınanmadan bu iki varsayıma güvenilmemelidir (docs/contracts/okc-gmp3.md).

use chrono::{DateTime, Datelike, Local, Timelike};

use super::crypto::SecureChannel;
use super::tlv::{self, bcd_decode, bcd_encode, Field};
use super::types::{OkcError, OkcResult};

pub const MSG_INIT_REQ: u32 = 0xFF8A60;
pub const MSG_INIT_RESP: u32 = 0xFF8E60;
pub const MSG_KEYREQ_REQ: u32 = 0xFF8A62;
pub const MSG_KEYREQ_RESP: u32 = 0xFF8E62;
pub const MSG_CLOSE_REQ: u32 = 0xFF8A63;
pub const MSG_CLOSE_RESP: u32 = 0xFF8E63;
pub const MSG_ECHO_REQ: u32 = 0xFF8A64;
pub const MSG_ECHO_RESP: u32 = 0xFF8E64;

pub const GROUP_TX: u32 = 0xDF02;
pub const GROUP_PAIR: u32 = 0xDF6F;
pub const GROUP_BANK: u32 = 0xDF6E;
pub const GROUP_GIB: u32 = 0xDF41;
pub const GROUP_PRIVATE: u32 = 0xDF30;

pub const TAG_TERMINAL_SERIAL: u32 = 0xDF8204;
pub const TAG_SEQ: u32 = 0xDF8208;
pub const TAG_DATE: u32 = 0xDF8209;
pub const TAG_TIME: u32 = 0xDF820A;
pub const TAG_ERROR: u32 = 0xDFEF06;
pub const TAG_HMAC: u32 = 0xDFEF0F;

/// Belge §4.3: en büyük paket 8192 bayt.
pub const MAX_PACKET: usize = 8192;
pub const SERIAL_LEN: usize = 12;
pub const STX: u8 = 0x02;
pub const ETX: u8 = 0x03;
pub const ACK: u8 = 0x06;
pub const NAK: u8 = 0x15;

/// Bir mesajın gruplarından biri.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    pub tag: u32,
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gmp3Message {
    pub terminal_serial: String,
    pub msg_type: u32,
    pub groups: Vec<Group>,
}

/// Eşleşme ve yoklama mesajları şifresiz gider (belge §3.4); diğerleri finansal sayılır.
pub fn is_pairing_type(msg_type: u32) -> bool {
    matches!(
        msg_type,
        MSG_INIT_REQ
            | MSG_INIT_RESP
            | MSG_KEYREQ_REQ
            | MSG_KEYREQ_RESP
            | MSG_CLOSE_REQ
            | MSG_CLOSE_RESP
            | MSG_ECHO_REQ
            | MSG_ECHO_RESP
    )
}

/// Longitudinal Redundancy Check: bayt bayt XOR (varsayım, bkz. modül başlığı).
pub fn lrc(data: &[u8]) -> u8 {
    data.iter().fold(0u8, |acc, byte| acc ^ byte)
}

impl Gmp3Message {
    pub fn new(terminal_serial: &str, msg_type: u32) -> Self {
        Self {
            terminal_serial: terminal_serial.to_string(),
            msg_type,
            groups: Vec::new(),
        }
    }

    /// İşlem grubunu (DF02) ekler: sıra numarası, tarih ve saat. Sıra numarası
    /// 1..=999999 aralığındadır; sıfır ve taşma reddedilir.
    pub fn with_stamp(mut self, seq: u32, now: DateTime<Local>) -> OkcResult<Self> {
        if seq == 0 || seq > 999_999 {
            return Err(OkcError::Protocol(
                "işlem sıra numarası 1-999999 dışında; yeniden eşleşme gerekir".to_string(),
            ));
        }
        let date = u64::try_from(now.year() % 100)
            .map_err(|_| OkcError::Protocol("yıl geçersiz".to_string()))?
            * 10_000
            + u64::from(now.month()) * 100
            + u64::from(now.day());
        let time = u64::from(now.hour()) * 10_000
            + u64::from(now.minute()) * 100
            + u64::from(now.second());
        let group = Group {
            tag: GROUP_TX,
            fields: vec![
                Field {
                    tag: TAG_SEQ,
                    value: bcd_encode(u64::from(seq), 3)?,
                },
                Field {
                    tag: TAG_DATE,
                    value: bcd_encode(date, 3)?,
                },
                Field {
                    tag: TAG_TIME,
                    value: bcd_encode(time, 3)?,
                },
            ],
        };
        self.groups.insert(0, group);
        Ok(self)
    }

    pub fn with_field(mut self, group_tag: u32, tag: u32, value: Vec<u8>) -> Self {
        match self.groups.iter_mut().find(|g| g.tag == group_tag) {
            Some(group) => group.fields.push(Field { tag, value }),
            None => self.groups.push(Group {
                tag: group_tag,
                fields: vec![Field { tag, value }],
            }),
        }
        self
    }

    pub fn field(&self, group_tag: u32, tag: u32) -> Option<&[u8]> {
        self.groups
            .iter()
            .filter(|g| g.tag == group_tag)
            .flat_map(|g| g.fields.iter())
            .find(|f| f.tag == tag)
            .map(|f| f.value.as_slice())
    }

    pub fn require(&self, group_tag: u32, tag: u32) -> OkcResult<&[u8]> {
        self.field(group_tag, tag).ok_or_else(|| {
            OkcError::Protocol(format!(
                "zorunlu alan yok: grup {group_tag:04X} alan {tag:06X}"
            ))
        })
    }

    /// Bir grubun TLV kodlanmış içeriği (etiket ve uzunluk hariç). HMAC bu bayt
    /// dizisi üzerinden hesaplanır (belge §2.11.2, DFEF0F).
    pub fn group_content(&self, group_tag: u32) -> OkcResult<Option<Vec<u8>>> {
        let Some(group) = self.groups.iter().find(|g| g.tag == group_tag) else {
            return Ok(None);
        };
        let mut content = Vec::new();
        for field in &group.fields {
            content.extend(tlv::encode_tlv(field.tag, 3, &field.value)?);
        }
        Ok(Some(content))
    }

    pub fn seq(&self) -> OkcResult<u32> {
        let value = bcd_decode(self.require(GROUP_TX, TAG_SEQ)?)?;
        u32::try_from(value).map_err(|_| OkcError::Protocol("sıra numarası taştı".to_string()))
    }

    /// Cihazın hata kodu (`DFEF06`, ASCII 2). Alan yoksa `None`.
    pub fn error_code(&self) -> Option<String> {
        self.field(GROUP_PAIR, TAG_ERROR)
            .map(|v| String::from_utf8_lossy(v).to_string())
    }

    /// Mesaj tipinden LRC'ye kadar olan iç bölüm.
    fn inner(&self) -> OkcResult<Vec<u8>> {
        let mut body = Vec::new();
        for group in &self.groups {
            let mut content = Vec::new();
            for field in &group.fields {
                content.extend(tlv::encode_tlv(field.tag, 3, &field.value)?);
            }
            body.extend(tlv::encode_tlv(group.tag, 2, &content)?);
        }
        let mut inner = tlv::encode_tlv(self.msg_type, 3, &body)?;
        inner.push(lrc(&inner));
        Ok(inner)
    }

    /// Paketi üretir. `channel` verilirse mesaj tipinden LRC'ye kadar olan bölüm
    /// KENC ile şifrelenir (belge §4.3).
    pub fn encode(&self, channel: Option<&SecureChannel>) -> OkcResult<Vec<u8>> {
        if !self.terminal_serial.is_ascii() || self.terminal_serial.len() > SERIAL_LEN {
            return Err(OkcError::Protocol(
                "terminal seri numarası en çok 12 ASCII karakter olabilir".to_string(),
            ));
        }
        let mut payload = self.inner()?;
        if let Some(channel) = channel {
            payload = channel.encrypt(&payload)?;
        }
        let total = SERIAL_LEN + payload.len();
        if total + 2 > MAX_PACKET {
            return Err(OkcError::Protocol("paket 8192 baytı aşıyor".to_string()));
        }
        let len = u16::try_from(total)
            .map_err(|_| OkcError::Protocol("paket uzunluğu taştı".to_string()))?;
        let mut packet = len.to_be_bytes().to_vec();
        let mut serial = self.terminal_serial.as_bytes().to_vec();
        serial.resize(SERIAL_LEN, b' ');
        packet.extend(serial);
        packet.extend(payload);
        Ok(packet)
    }

    /// Paketi çözer. Uzunluk, LRC ve TLV bütünlüğü doğrulanmadan hiçbir alan
    /// döndürülmez; şifreli mesajda kanal verilmezse reddedilir.
    pub fn decode(packet: &[u8], channel: Option<&SecureChannel>) -> OkcResult<Self> {
        if packet.len() < 2 + SERIAL_LEN + 5 || packet.len() > MAX_PACKET {
            return Err(OkcError::Protocol("paket uzunluğu geçersiz".to_string()));
        }
        let declared = usize::from(u16::from_be_bytes([packet[0], packet[1]]));
        if declared != packet.len() - 2 {
            return Err(OkcError::Protocol(
                "mesaj uzunluğu doğrulama hatası".to_string(),
            ));
        }
        let serial_bytes = &packet[2..2 + SERIAL_LEN];
        let terminal_serial = tlv::decode_text(serial_bytes)
            .trim_end_matches([' ', '\0'])
            .to_string();
        let payload = &packet[2 + SERIAL_LEN..];
        let inner = match channel {
            Some(channel) => channel.decrypt(payload)?,
            None => payload.to_vec(),
        };
        let (lrc_byte, tlv_part) = inner
            .split_last()
            .ok_or_else(|| OkcError::Protocol("boş mesaj".to_string()))?;
        if lrc(tlv_part) != *lrc_byte {
            return Err(OkcError::Protocol("LRC doğrulama hatası".to_string()));
        }
        if tlv_part.len() < 4 {
            return Err(OkcError::Protocol("mesaj tipi eksik".to_string()));
        }
        let outer = tlv::parse_fields(tlv_part, 3)?;
        let [message] = outer.as_slice() else {
            return Err(OkcError::Protocol(
                "tek mesaj tipi alanı bekleniyordu".to_string(),
            ));
        };
        let mut groups = Vec::new();
        for group in tlv::parse_fields(&message.value, 2)? {
            groups.push(Group {
                tag: group.tag,
                fields: tlv::parse_fields(&group.value, 3)?,
            });
        }
        Ok(Self {
            terminal_serial,
            msg_type: message.tag,
            groups,
        })
    }
}

/// Belge §2.6: seri ve USB için paket başına STX ve ETX eklenir.
pub fn serial_wrap(packet: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(packet.len() + 2);
    out.push(STX);
    out.extend_from_slice(packet);
    out.push(ETX);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::okc::crypto::SessionKeys;

    fn sample() -> Gmp3Message {
        Gmp3Message::new("ABC123", MSG_ECHO_REQ)
            .with_stamp(7, Local::now())
            .expect("damga")
            .with_field(GROUP_PAIR, 0xDFEF0B, b"drv-1".to_vec())
    }

    #[test]
    fn plain_round_trip_keeps_every_field() {
        let message = sample();
        let packet = message.encode(None).expect("kodla");
        let decoded = Gmp3Message::decode(&packet, None).expect("çöz");
        assert_eq!(decoded.terminal_serial, "ABC123");
        assert_eq!(decoded.msg_type, MSG_ECHO_REQ);
        assert_eq!(decoded.seq().expect("sıra"), 7);
        assert_eq!(decoded.field(GROUP_PAIR, 0xDFEF0B), Some(&b"drv-1"[..]));
    }

    #[test]
    fn packet_layout_matches_documented_example() {
        let packet = sample().encode(None).expect("kodla");
        // Uzunluk (2) + seri no (12) + mesaj tipi etiketi.
        assert_eq!(
            usize::from(u16::from_be_bytes([packet[0], packet[1]])),
            packet.len() - 2
        );
        assert_eq!(&packet[2..8], b"ABC123");
        assert_eq!(&packet[8..14], b"      ");
        assert_eq!(&packet[14..17], &[0xFF, 0x8A, 0x64]);
        // İşlem grubu DF02 ilk gruptur ve 0x15 (21) bayt taşır: belgedeki örnekle aynı.
        assert_eq!(&packet[18..21], &[0xDF, 0x02, 0x15]);
    }

    #[test]
    fn corrupted_packets_are_rejected() {
        let packet = sample().encode(None).expect("kodla");
        let mut bad_lrc = packet.clone();
        let last = bad_lrc.len() - 1;
        bad_lrc[last] ^= 0xFF;
        assert!(Gmp3Message::decode(&bad_lrc, None).is_err());
        let mut bad_len = packet.clone();
        bad_len[1] ^= 1;
        assert!(Gmp3Message::decode(&bad_len, None).is_err());
        assert!(Gmp3Message::decode(&packet[..10], None).is_err());
        let mut flipped = packet;
        flipped[20] ^= 0x01;
        assert!(Gmp3Message::decode(&flipped, None).is_err());
    }

    #[test]
    fn encrypted_round_trip_needs_the_same_keys() {
        let keys = SessionKeys::derive(&[3u8; 256], &[1u8; 16], &[2u8; 16]).expect("anahtar");
        let channel = SecureChannel::new(keys);
        let packet = sample().encode(Some(&channel)).expect("kodla");
        assert!(Gmp3Message::decode(&packet, None).is_err());
        let other = SecureChannel::new(
            SessionKeys::derive(&[4u8; 256], &[1u8; 16], &[2u8; 16]).expect("anahtar"),
        );
        assert!(Gmp3Message::decode(&packet, Some(&other)).is_err());
        let decoded = Gmp3Message::decode(&packet, Some(&channel)).expect("çöz");
        assert_eq!(decoded.seq().expect("sıra"), 7);
        // Seri no şifrelenmez; yalnız mesaj tipinden LRC'ye kadar olan bölüm gizlidir.
        assert_eq!(&packet[2..8], b"ABC123");
    }

    #[test]
    fn sequence_bounds_and_oversize_are_rejected() {
        let now = Local::now();
        assert!(Gmp3Message::new("A", MSG_ECHO_REQ)
            .with_stamp(0, now)
            .is_err());
        assert!(Gmp3Message::new("A", MSG_ECHO_REQ)
            .with_stamp(1_000_000, now)
            .is_err());
        let big =
            Gmp3Message::new("A", MSG_ECHO_REQ).with_field(GROUP_PRIVATE, 0xDFB001, vec![0; 9000]);
        assert!(big.encode(None).is_err());
        assert!(Gmp3Message::new("ÇOK-UZUN-SERI-NO", MSG_ECHO_REQ)
            .encode(None)
            .is_err());
    }

    #[test]
    fn serial_wrap_adds_markers() {
        assert_eq!(serial_wrap(&[1, 2]), vec![STX, 1, 2, ETX]);
    }
}
