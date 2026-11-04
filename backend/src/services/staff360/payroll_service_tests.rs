use super::period_range;
use crate::services::staff360::payroll_rules::hourly_equivalent_cents;

#[test]
fn donem_araligi_uc_aylik_dogru() {
    assert_eq!(
        period_range("2026-03").unwrap(),
        ("2026-03-01".to_string(), "2026-03-31T23:59:59".to_string())
    );
}

#[test]
fn subat_artisiz_28_gun() {
    let (b, s) = period_range("2026-02").unwrap();
    assert_eq!(b, "2026-02-01");
    assert!(s.starts_with("2026-02-28"), "2026 artık yıl değil: {s}");
}

#[test]
fn subat_artili_29_gun() {
    let (_, s) = period_range("2028-02").unwrap();
    assert!(s.starts_with("2028-02-29"), "2028 artık yıl: {s}");
}

#[test]
fn yuzyil_artik_olmayan_yil_28_gun() {
    // 1900 artık yıl **değildir** (100 ile bölünür ama 400 ile bölünmez).
    let (_, s) = period_range("1900-02").unwrap();
    assert!(s.starts_with("1900-02-28"), "{s}");
}

#[test]
fn gecersiz_donem_reddedilir() {
    assert!(period_range("2026-13").is_err());
    assert!(period_range("2026").is_err());
    assert!(period_range("abc-def").is_err());
}

#[test]
fn saat_karsiligi_aylik_225_haftalik_45_gunluk_yedi_bucuk_saat() {
    // 30.000,00 TL / 225 = 133,333 TL → 13.333 kuruş.
    assert_eq!(
        hourly_equivalent_cents("FIXED", "MONTHLY", 3_000_000, 0),
        Ok(13_333)
    );
    // 4.500,00 TL / 45 = 100,00 TL.
    assert_eq!(
        hourly_equivalent_cents("TIP", "WEEKLY", 450_000, 0),
        Ok(10_000)
    );
    // 1.000,00 TL / 7,5 = 133,333 TL.
    assert_eq!(
        hourly_equivalent_cents("FIXED", "DAILY", 100_000, 0),
        Ok(13_333)
    );
    // Yarım kuruş yukarı: 4 / 7,5 = 0,53 → 1; 3 / 7,5 = 0,4 → 0.
    assert_eq!(hourly_equivalent_cents("FIXED", "DAILY", 4, 0), Ok(1));
    assert_eq!(hourly_equivalent_cents("FIXED", "DAILY", 3, 0), Ok(0));
    assert_eq!(
        hourly_equivalent_cents("HOURLY", "MONTHLY", 0, 25_000),
        Ok(25_000)
    );
    assert!(hourly_equivalent_cents("FIXED", "YEARLY", 1, 0).is_err());
}
