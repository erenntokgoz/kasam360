//! Hakediş dönemleri: aylık, haftalık, günlük.
//!
//! Kural tutarı kişinin dönemine aittir: günlük kuralda taban bir günlük ücrettir.
//! Dönem anahtarı `payroll_runs.period` içinde saklanır; önekli hafta anahtarı aynı tarihin
//! günlük hesabıyla çakışmasın diye vardır.

use chrono::{Datelike, Duration, NaiveDate, Weekday};

pub const MONTHLY: &str = "MONTHLY";
pub const WEEKLY: &str = "WEEKLY";
pub const DAILY: &str = "DAILY";

#[derive(Debug, PartialEq, Eq)]
pub struct PeriodWindow {
    pub key: String,
    pub from: String,
    pub to: String,
    /// Ücretsiz izin bölücüsü: dönem tabanı kaç güne yayılır.
    pub days: i64,
}

fn parse_day(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| format!("tarih gecersiz: {value}"))
}

/// Bilinmeyen dönem aylığa düşmez: yanlış tutar ödenmesindense hesap reddedilir.
pub fn period_window(pay_period: &str, period: &str) -> Result<PeriodWindow, String> {
    match pay_period {
        MONTHLY => {
            let (from, to) = period_range(period)?;
            Ok(PeriodWindow {
                key: period.to_string(),
                from,
                to,
                days: 30,
            })
        }
        WEEKLY => {
            let start = parse_day(period)?;
            if start.weekday() != Weekday::Mon {
                return Err(format!("hafta pazartesi baslamali: {period}"));
            }
            Ok(PeriodWindow {
                key: format!("W{period}"),
                from: period.to_string(),
                to: format!("{}T23:59:59", start + Duration::days(6)),
                days: 7,
            })
        }
        DAILY => {
            parse_day(period)?;
            Ok(PeriodWindow {
                key: period.to_string(),
                from: period.to_string(),
                to: format!("{period}T23:59:59"),
                days: 1,
            })
        }
        other => Err(format!("gecersiz hakedis donemi: {other}")),
    }
}

/// `YYYY-MM` dönemini `[baslangic, bitis]` aralığına çevirir.
/// Geçersiz dönem hata verir; sessizce tüm zaman aralığına düşmez.
pub fn period_range(period: &str) -> Result<(String, String), String> {
    let parcalar: Vec<&str> = period.split('-').collect();
    if parcalar.len() != 2 || parcalar[0].len() != 4 || parcalar[1].len() != 2 {
        return Err(format!("donem YYYY-MM olmali: {period}"));
    }
    let yil: i32 = parcalar[0]
        .parse()
        .map_err(|_| format!("donem yili gecersiz: {period}"))?;
    let ay: u32 = parcalar[1]
        .parse()
        .map_err(|_| format!("donem ayi gecersiz: {period}"))?;
    if !(1..=12).contains(&ay) {
        return Err(format!("donem ayi 1-12 olmali: {period}"));
    }
    let ilk = format!("{yil:04}-{ay:02}-01");
    // Ay uzunluğu: 31'e `31 - gün` farkı eklenir. Şubat artık yılda 29, normal
    // yılda 28 gündür; hata burada bordro dönemini bir gün kaydırır.
    let son_gun = 31u8
        - match ay {
            4 | 6 | 9 | 11 => 2,
            2 => {
                if (yil % 4 == 0 && yil % 100 != 0) || yil % 400 == 0 {
                    2
                } else {
                    3
                }
            }
            _ => 0,
        };
    // Aralık için ayrı dal YOKTUR. Önceden `yil+1-01-31` üreten dal vardı ve
    // 2026-12 dönemini 2027-01-31'e kadar uzatıyordu: Aralıkta çalışan
    // personelin Ocak satışı Aralık bordrosuna girer, Ocak bordrosuna da
    // girmezdi. Aralık 31 gündür, `_ => 0` dalı zaten doğru sonucu verir.
    let son = format!("{yil:04}-{ay:02}-{son_gun}");
    Ok((ilk, format!("{son}T23:59:59")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hafta_pazartesiden_pazara_gider_anahtari_ayridir() {
        let window = period_window(WEEKLY, "2026-11-02").expect("hafta");
        assert_eq!(window.key, "W2026-11-02");
        assert_eq!(window.to, "2026-11-08T23:59:59");
        assert_eq!(window.days, 7);
        assert!(period_window(WEEKLY, "2026-11-03").is_err());
    }

    #[test]
    fn gun_kendi_icinde_kalir_bilinmeyen_donem_reddedilir() {
        let window = period_window(DAILY, "2026-11-02").expect("gün");
        assert_eq!(window.key, "2026-11-02");
        assert_eq!(window.to, "2026-11-02T23:59:59");
        assert!(period_window(DAILY, "2026-13-02").is_err());
        assert!(period_window("YEARLY", "2026").is_err());
    }
}
