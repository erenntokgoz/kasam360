//! Fiyat bütünlüğü testleri modülü.
//!
//! Kapsam: modifier fiyatının tek doğruluk kaynağı veritabanıdır. İstemci
//! tarafı manipülasyonları, çift sayım ve constraint ihlalleri engellenir.

pub mod common;
pub mod manipulation;
pub mod snapshot_validation;
