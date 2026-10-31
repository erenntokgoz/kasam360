use super::{period_range, yuzde_hesapla};

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
fn aralik_dondurulmez() {
    assert_eq!(yuzde_hesapla(33_335, 7), 2_333);
}

#[test]
fn gecersiz_donem_reddedilir() {
    assert!(period_range("2026-13").is_err());
    assert!(period_range("2026").is_err());
    assert!(period_range("abc-def").is_err());
}
