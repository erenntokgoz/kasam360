//! `modifier_service` testleri (facade).
//!
//! Kapsam: kural testleri. "Şablonda 'Az' seçeneği var" gibi **içerik**
//! testleri yazılmaz; bunlar SPEC'te olmayan hazır içerik uydurur. Testler
//! gerçek servisin karar kurallarını denetler: tenant izolasyonu, kategori
//! şablonu bağlantısı, ürün bağlantısı ve fiyat bütünlüğü.

mod common;
mod group_tests;
mod pricing_tests;
