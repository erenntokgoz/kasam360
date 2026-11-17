//! GMP-3 TLV kodlaması (belge §2.8, §2.9, §2.11).
//!
//! Etiket genişlikleri belgede sabittir: mesaj tipi 3 bayt, alan grubu 2 bayt,
//! alan 3 bayt. Uzunluk 0..127 tek bayt, 128..255 için `81 XX`, 256..65535 için
//! `82 XX XX`. Tutarlar BCD, metinler ISO 8859-9 (Türkçe) olarak taşınır.

use super::types::{OkcError, OkcResult};

/// Tek bir TLV alanı: etiket değeri ve ham içerik.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Field {
    pub tag: u32,
    pub value: Vec<u8>,
}

/// Uzunluk baytlarını yazar. 65535 üstü belge dışıdır ve reddedilir.
pub fn encode_len(len: usize) -> OkcResult<Vec<u8>> {
    match len {
        0..=127 => Ok(vec![len as u8]),
        128..=255 => Ok(vec![0x81, len as u8]),
        256..=65_535 => Ok(vec![0x82, (len >> 8) as u8, (len & 0xFF) as u8]),
        _ => Err(OkcError::Protocol(format!("TLV uzunluğu çok büyük: {len}"))),
    }
}

/// Uzunluğu okur; (uzunluk, tüketilen bayt) döner. Eksik veri hata verir.
pub fn decode_len(data: &[u8]) -> OkcResult<(usize, usize)> {
    let first = *data
        .first()
        .ok_or_else(|| OkcError::Protocol("TLV uzunluğu eksik".to_string()))?;
    match first {
        0..=0x7F => Ok((usize::from(first), 1)),
        0x81 => {
            let b = *data
                .get(1)
                .ok_or_else(|| OkcError::Protocol("TLV uzunluğu eksik".to_string()))?;
            Ok((usize::from(b), 2))
        }
        0x82 => {
            if data.len() < 3 {
                return Err(OkcError::Protocol("TLV uzunluğu eksik".to_string()));
            }
            Ok(((usize::from(data[1]) << 8) | usize::from(data[2]), 3))
        }
        other => Err(OkcError::Protocol(format!(
            "desteklenmeyen TLV uzunluk biçimi: {other:#04x}"
        ))),
    }
}

/// Etiketi büyük-uçlu sabit genişlikte yazar.
pub fn push_tag(out: &mut Vec<u8>, tag: u32, width: usize) {
    for i in (0..width).rev() {
        out.push(((tag >> (8 * i)) & 0xFF) as u8);
    }
}

fn read_tag(data: &[u8], width: usize) -> OkcResult<u32> {
    if data.len() < width {
        return Err(OkcError::Protocol("TLV etiketi eksik".to_string()));
    }
    Ok(data[..width]
        .iter()
        .fold(0u32, |acc, byte| (acc << 8) | u32::from(*byte)))
}

/// Tek bir TLV'yi yazar: etiket, uzunluk, değer.
pub fn encode_tlv(tag: u32, tag_width: usize, value: &[u8]) -> OkcResult<Vec<u8>> {
    let mut out = Vec::with_capacity(tag_width + 3 + value.len());
    push_tag(&mut out, tag, tag_width);
    out.extend(encode_len(value.len())?);
    out.extend_from_slice(value);
    Ok(out)
}

/// Bir bölümü sıralı TLV alanlarına ayırır. Artan bayt kalırsa bozuk paket sayılır.
pub fn parse_fields(data: &[u8], tag_width: usize) -> OkcResult<Vec<Field>> {
    let mut fields = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        let tag = read_tag(&data[pos..], tag_width)?;
        pos += tag_width;
        let (len, used) = decode_len(&data[pos..])?;
        pos += used;
        let end = pos
            .checked_add(len)
            .filter(|end| *end <= data.len())
            .ok_or_else(|| OkcError::Protocol("TLV değeri paket sınırını aşıyor".to_string()))?;
        fields.push(Field {
            tag,
            value: data[pos..end].to_vec(),
        });
        pos = end;
    }
    Ok(fields)
}

/// Tamsayıyı sabit uzunlukta BCD'ye çevirir (`bytes` bayt = 2*bytes hane).
pub fn bcd_encode(value: u64, bytes: usize) -> OkcResult<Vec<u8>> {
    let digits = bytes * 2;
    let text = format!("{value:0digits$}");
    if text.len() != digits {
        return Err(OkcError::Protocol(format!(
            "{value} değeri {bytes} baytlık BCD'ye sığmıyor"
        )));
    }
    Ok(text
        .as_bytes()
        .chunks(2)
        .map(|pair| ((pair[0] - b'0') << 4) | (pair[1] - b'0'))
        .collect())
}

/// BCD değeri tamsayıya çevirir; geçersiz hane (A-F) reddedilir.
pub fn bcd_decode(data: &[u8]) -> OkcResult<u64> {
    let mut value: u64 = 0;
    for byte in data {
        for nibble in [byte >> 4, byte & 0x0F] {
            if nibble > 9 {
                return Err(OkcError::Protocol("BCD alanında geçersiz hane".to_string()));
            }
            value = value
                .checked_mul(10)
                .and_then(|v| v.checked_add(u64::from(nibble)))
                .ok_or_else(|| OkcError::Protocol("BCD değeri taştı".to_string()))?;
        }
    }
    Ok(value)
}

/// Metni ISO 8859-9'a çevirir. Karşılığı olmayan karakter sessizce `?` olmaz:
/// fişte yanlış ürün adı basmak yerine işlem reddedilir.
pub fn encode_text(text: &str) -> OkcResult<Vec<u8>> {
    text.chars()
        .map(|c| {
            let code = c as u32;
            Ok(match c {
                'Ğ' => 0xD0,
                'ğ' => 0xF0,
                'İ' => 0xDD,
                'ı' => 0xFD,
                'Ş' => 0xDE,
                'ş' => 0xFE,
                _ if code < 0x80 => code as u8,
                // Latin-1 ile ISO 8859-9 aynı konumlarda ortak harfler taşır.
                _ if (0xA0..=0xFF).contains(&code)
                    && ![0xD0, 0xDD, 0xDE, 0xF0, 0xFD, 0xFE].contains(&code) =>
                {
                    code as u8
                }
                _ => {
                    return Err(OkcError::Validation(format!(
                        "yazar kasa karakter kümesinde olmayan karakter: {c}"
                    )))
                }
            })
        })
        .collect()
}

pub fn decode_text(data: &[u8]) -> String {
    data.iter()
        .map(|byte| match byte {
            0xD0 => 'Ğ',
            0xF0 => 'ğ',
            0xDD => 'İ',
            0xFD => 'ı',
            0xDE => 'Ş',
            0xFE => 'ş',
            other => char::from(*other),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn length_forms_round_trip() {
        for len in [0usize, 1, 127, 128, 255, 256, 8192, 65_535] {
            let bytes = encode_len(len).expect("kodla");
            assert_eq!(decode_len(&bytes).expect("çöz"), (len, bytes.len()));
        }
        assert!(encode_len(65_536).is_err());
        assert!(decode_len(&[0x83, 1, 2, 3]).is_err());
        assert!(decode_len(&[0x82, 1]).is_err());
    }

    #[test]
    fn spec_length_examples() {
        // Belge örneği: 128..255 için 81 XX, 256..65535 için 82 XX XX.
        assert_eq!(encode_len(0x58).expect("k"), vec![0x58]);
        assert_eq!(encode_len(0x88).expect("k"), vec![0x81, 0x88]);
        assert_eq!(encode_len(0x0100).expect("k"), vec![0x82, 0x01, 0x00]);
    }

    #[test]
    fn fields_round_trip_and_reject_truncation() {
        let mut data = encode_tlv(0xDFEF06, 3, b"00").expect("a");
        data.extend(encode_tlv(0xDFEF09, 3, &[1]).expect("b"));
        let fields = parse_fields(&data, 3).expect("çöz");
        assert_eq!(fields.len(), 2);
        assert_eq!(fields[0].tag, 0xDFEF06);
        assert_eq!(fields[0].value, b"00");
        data.pop();
        assert!(parse_fields(&data, 3).is_err());
    }

    #[test]
    fn bcd_round_trip_and_limits() {
        assert_eq!(bcd_encode(4500, 6).expect("e"), vec![0, 0, 0, 0, 0x45, 0]);
        assert_eq!(bcd_decode(&[0, 0, 0, 0, 0x45, 0]).expect("d"), 4500);
        assert!(bcd_encode(1_000_000_000_000, 6).is_err());
        assert!(bcd_decode(&[0x1A]).is_err());
    }

    #[test]
    fn turkish_text_round_trip() {
        let text = "Çay ŞĞİıöü ğş";
        assert_eq!(decode_text(&encode_text(text).expect("e")), text);
        assert!(encode_text("kahve ☕").is_err());
    }
}
