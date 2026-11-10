//! Çalışma kaydı zaman hesabı: gece yarısını aşan vardiya, mola ve vardiya günü.
//!
//! Neden saf yordamlar: süre, takvim günü değil iki an arasındaki farktır. Gece
//! 22:00'de başlayıp sabah 06:00'da biten vardiya iki takvim gününe yayılsa da sekiz
//! saattir; bunu SQL tarih dilimlerine bırakmak sınır günlerinde saat kaybettirirdi.
//! Vardiya günü ise kaydın girildiği saat dilimindeki başlangıç günündür: gece
//! yarısından sonra başlayan 01:00 vardiyası UTC'de bir önceki güne düşse de işletme
//! için o günündür.

use chrono::{DateTime, FixedOffset, SecondsFormat, Utc};

/// Tek kayıt bu süreyi aşamaz. Unutulup açık kalmış kaydın bir sonraki gün kapatılması
/// otuz saatlik ücret yazardı; bu durumda çıkış zamanı elle düzeltilmelidir.
pub const MAX_SHIFT_SECONDS: i64 = 24 * 3600;

/// Çıkış zamanı saat farkı payından fazla ileride olamaz: gelecekteki çıkış, çalışılmamış
/// süre için ücret yazar.
pub const FUTURE_SKEW_SECONDS: i64 = 5 * 60;

/// RFC 3339 anını ofsetiyle okur; ofset vardiya gününün hesabında kullanılır.
pub fn parse_instant(value: &str, field: &str) -> Result<DateTime<FixedOffset>, String> {
    DateTime::parse_from_rfc3339(value.trim())
        .map_err(|_| format!("VALIDATION: {field} RFC3339 olmalı"))
}

/// Saklanan kanonik biçim: UTC, saniye çözünürlüğü. Karışık ofsetli kayıtlar metin
/// olarak karşılaştırılamaz; tek biçim çakışma ve dönem sorgularını doğru tutar.
pub fn canonical_utc(instant: &DateTime<FixedOffset>) -> String {
    instant
        .with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Vardiya günü: başlangıcın kendi ofsetindeki takvim günü (`YYYY-MM-DD`).
pub fn work_date(started: &DateTime<FixedOffset>) -> String {
    started.date_naive().format("%Y-%m-%d").to_string()
}

/// Mola düşülmüş net çalışma süresi (saniye).
///
/// Mola, vardiyanın hangi tarafına düştüğüne bakılmadan toplam süreden düşer; gece
/// yarısından önce ya da sonra alınması süreyi değiştirmez.
pub fn net_worked_seconds(
    started: &DateTime<FixedOffset>,
    ended: &DateTime<FixedOffset>,
    break_minutes: i64,
) -> Result<i64, String> {
    if break_minutes < 0 {
        return Err("VALIDATION: mola negatif olamaz".to_string());
    }
    let total = (*ended - *started).num_seconds();
    if total <= 0 {
        return Err("VALIDATION: çıkış girişten sonra olmalı".to_string());
    }
    if total > MAX_SHIFT_SECONDS {
        return Err(
            "VALIDATION: kayıt 24 saati aşıyor; çıkış zamanını gerçek çıkış saatine düzeltin"
                .to_string(),
        );
    }
    let break_seconds = break_minutes
        .checked_mul(60)
        .ok_or_else(|| "VALIDATION: mola çok büyük".to_string())?;
    if break_seconds > total {
        return Err("VALIDATION: mola çalışma süresini aşamaz".to_string());
    }
    Ok(total - break_seconds)
}

/// Çıkış zamanı gelecekte mi? `now` dışarıdan verilir ki test zamanı sabitleyebilsin.
pub fn ensure_not_future(ended: &DateTime<FixedOffset>, now: DateTime<Utc>) -> Result<(), String> {
    if (ended.with_timezone(&Utc) - now).num_seconds() > FUTURE_SKEW_SECONDS {
        return Err("VALIDATION: çıkış zamanı gelecekte olamaz".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(value: &str) -> DateTime<FixedOffset> {
        parse_instant(value, "zaman").expect("zaman")
    }

    #[test]
    fn gece_yarisini_asan_vardiya_iki_gune_yayilsa_da_tam_sure_sayilir() {
        let started = at("2026-11-09T22:00:00+03:00");
        let ended = at("2026-11-10T06:00:00+03:00");
        // Sekiz saat, otuz dakika mola: yedi buçuk saat.
        assert_eq!(
            net_worked_seconds(&started, &ended, 30).expect("süre"),
            27_000
        );
        assert_eq!(work_date(&started), "2026-11-09");
    }

    #[test]
    fn vardiya_gunu_utc_degil_girilen_ofsetin_gunudur() {
        // 01:00 yerel, UTC'de bir önceki gün 22:00.
        let started = at("2026-11-10T01:00:00+03:00");
        assert_eq!(work_date(&started), "2026-11-10");
        assert_eq!(canonical_utc(&started), "2026-11-09T22:00:00Z");
    }

    #[test]
    fn farkli_ofsetli_ayni_an_ayni_kanonik_metni_verir() {
        assert_eq!(
            canonical_utc(&at("2026-11-10T01:00:00+03:00")),
            canonical_utc(&at("2026-11-09T22:00:00Z"))
        );
    }

    #[test]
    fn gecersiz_sure_ve_mola_reddedilir() {
        let started = at("2026-11-09T09:00:00Z");
        assert!(net_worked_seconds(&started, &started, 0).is_err());
        assert!(net_worked_seconds(&started, &at("2026-11-09T08:00:00Z"), 0).is_err());
        assert!(net_worked_seconds(&started, &at("2026-11-09T10:00:00Z"), 61).is_err());
        assert!(net_worked_seconds(&started, &at("2026-11-09T10:00:00Z"), -1).is_err());
        assert_eq!(
            net_worked_seconds(&started, &at("2026-11-09T10:00:00Z"), 60).expect("tam mola"),
            0
        );
    }

    #[test]
    fn yirmi_dort_saati_asan_kayit_reddedilir() {
        let started = at("2026-11-09T09:00:00Z");
        assert!(net_worked_seconds(&started, &at("2026-11-10T09:00:00Z"), 0).is_ok());
        assert!(net_worked_seconds(&started, &at("2026-11-10T09:00:01Z"), 0).is_err());
    }

    #[test]
    fn gelecekteki_cikis_reddedilir() {
        let now = at("2026-11-09T12:00:00Z").with_timezone(&Utc);
        assert!(ensure_not_future(&at("2026-11-09T12:04:00Z"), now).is_ok());
        assert!(ensure_not_future(&at("2026-11-09T12:06:00Z"), now).is_err());
    }
}
