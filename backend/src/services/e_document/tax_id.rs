//! VKN (10 hane) ve TCKN (11 hane) sağlama doğrulaması.
//!
//! Neden gönderimden önce doğrulanır: yanlış kimlikle düzenlenen belge sağlayıcıda
//! reddedilir ve ETTN yanar; hata kuyruğa girmeden, ayar kaydında yakalanmalıdır.

/// Vergi kimliğinin türü; XML'de `schemeID` olarak yazılır.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaxIdKind {
    Vkn,
    Tckn,
}

impl TaxIdKind {
    pub fn scheme_id(self) -> &'static str {
        match self {
            TaxIdKind::Vkn => "VKN",
            TaxIdKind::Tckn => "TCKN",
        }
    }
}

fn digits(value: &str) -> Option<Vec<i64>> {
    if !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(value.bytes().map(|b| i64::from(b - b'0')).collect())
}

fn vkn_is_valid(d: &[i64]) -> bool {
    let mut sum = 0;
    for (i, digit) in d.iter().take(9).enumerate() {
        let weight = 9 - i as u32;
        let tmp = (digit + i64::from(weight)) % 10;
        let mut v = (tmp * (1_i64 << weight)) % 9;
        if tmp != 0 && v == 0 {
            v = 9;
        }
        sum += v;
    }
    (10 - sum % 10) % 10 == d[9]
}

fn tckn_is_valid(d: &[i64]) -> bool {
    if d[0] == 0 {
        return false;
    }
    let odd: i64 = d[0] + d[2] + d[4] + d[6] + d[8];
    let even: i64 = d[1] + d[3] + d[5] + d[7];
    let tenth = ((odd * 7 - even) % 10 + 10) % 10;
    let eleventh = d[..10].iter().sum::<i64>() % 10;
    tenth == d[9] && eleventh == d[10]
}

/// Uzunluğa göre türü belirler ve sağlama basamağını doğrular.
pub fn classify(value: &str) -> Result<TaxIdKind, String> {
    let d =
        digits(value).ok_or_else(|| "VALIDATION: VKN/TCKN yalnız rakam içermeli".to_string())?;
    match d.len() {
        10 if vkn_is_valid(&d) => Ok(TaxIdKind::Vkn),
        11 if tckn_is_valid(&d) => Ok(TaxIdKind::Tckn),
        10 | 11 => Err("VALIDATION: VKN/TCKN sağlama basamağı geçersiz".to_string()),
        _ => Err("VALIDATION: VKN 10, TCKN 11 haneli olmalı".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gecerli_vkn_ve_tckn_kabul_edilir() {
        assert_eq!(classify("0690000001"), Ok(TaxIdKind::Vkn));
        assert_eq!(classify("10000000146"), Ok(TaxIdKind::Tckn));
    }

    #[test]
    fn hatali_saglama_uzunluk_ve_karakter_reddedilir() {
        assert!(classify("1111111111").is_err());
        assert!(classify("10000000147").is_err());
        assert!(classify("00000000000").is_err());
        assert!(classify("123").is_err());
        assert!(classify("12345abcde").is_err());
    }
}
