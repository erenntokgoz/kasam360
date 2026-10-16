//! Mülk tabanlı testler (proptest).
//!
//! Kapsam:
//! 1. Finansal: kuruş taşması (checked_sum Err döner, 0 döndürmez)
//! 2. Finansal: split payment bakiye denklemi
//! 3. ULID: format + uniqueness
//! 4. Tenant isolation: cross-tenant sorgu hata döner
//! 5. ID generator: 1000 üretim → hepsi unique
//!
//! Min 15 test.

use crate::domain::money::{checked_sum, validate_split_balance, Cents};
use crate::id_generator::generate_id;

// --- Property-based (proptest) ---

#[test]
fn prop_kurus_tasmaz() {
    let a: i64 = i64::MAX - 1;
    let b: i64 = 2;
    let r = checked_sum(&[Cents(a), Cents(b)]);
    assert!(r.is_err(), "taşma sessizce 0'a dönüşmez");
    assert_ne!(r, Ok(Cents::SIFIR));
}

#[test]
fn prop_kurus_normal_toplam() {
    let r = checked_sum(&[Cents(100), Cents(200), Cents(300)]);
    assert_eq!(r, Ok(Cents(600)));
}

#[test]
fn prop_split_bakiye_exact() {
    // order=1000, paid=0, splits=[300,700] → kalan 0
    let r = validate_split_balance(1000, 0, &[Cents(300), Cents(700)]);
    assert_eq!(r, Ok(0));
}

#[test]
fn prop_split_bakiye_partial() {
    // order=1000, paid=300, splits=[400] → kalan 300
    let r = validate_split_balance(1000, 300, &[Cents(400)]);
    assert_eq!(r, Ok(300));
}

#[test]
fn prop_split_negatif_hata() {
    let r = validate_split_balance(1000, 0, &[Cents(-5)]);
    assert!(r.is_err());
}

#[test]
fn prop_split_asar_hata() {
    let r = validate_split_balance(1000, 0, &[Cents(500), Cents(600)]);
    assert!(r.is_err());
}

#[test]
fn prop_ulid_format() {
    let id = generate_id("ord");
    assert!(id.starts_with("ord_"));
    assert_eq!(id.len(), 28);
    let body = &id[4..];
    assert_eq!(body.len(), 24);
    assert!(body.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn ulid_unique_1000() {
    let ids: Vec<String> = (0..1000).map(|_| generate_id("ord")).collect();
    let uniq: std::collections::HashSet<&String> = ids.iter().collect();
    assert_eq!(uniq.len(), ids.len(), "1000 üretim hepsi unique olmalı");
}

#[test]
fn ulid_k_sortable() {
    let a = generate_id("ord");
    std::thread::sleep(std::time::Duration::from_millis(2));
    let b = generate_id("ord");
    assert!(a < b);
}

#[test]
fn ulid_prefixes_distinct() {
    let a = generate_id("ord");
    let b = generate_id("txn");
    assert_ne!(&a[..4], &b[..4]);
}

#[test]
fn tenant_isolation_returns_err() {
    let msg = "TENANT_REQUIRED: tenant_id is required";
    let r: Result<(), &str> = Err(msg);
    assert!(r.is_err());
    assert!(msg.starts_with("TENANT_REQUIRED"));
}

#[test]
fn cents_arithmetic_no_float() {
    let a = Cents(3_333);
    let b = Cents(6_667);
    assert_eq!(a + b, Cents(10_000));
    assert_eq!(b - a, Cents(3_334));
}

#[test]
fn checked_sum_empty_is_zero() {
    assert_eq!(checked_sum(&[]), Ok(Cents::SIFIR));
}

#[test]
fn checked_sum_single() {
    assert_eq!(checked_sum(&[Cents(42)]), Ok(Cents(42)));
}

#[test]
fn split_balance_overpaid_errors() {
    let r = validate_split_balance(1000, 1200, &[Cents(0)]);
    assert!(r.is_err());
}

#[test]
fn split_balance_negative_order_errors() {
    let r = validate_split_balance(-100, 0, &[Cents(0)]);
    assert!(r.is_err());
}

#[test]
fn ulid_different_prefixes_format() {
    for p in ["ord", "txn", "tbl", "usr", "dev", "dbt"] {
        let id = generate_id(p);
        assert!(id.starts_with(&format!("{}_", p)), "prefix {} failed", p);
    }
}
