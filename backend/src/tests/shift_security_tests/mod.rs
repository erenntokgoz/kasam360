//! Vardiya güvenlik regresyon testleri.
//!
//! Kapsam:
//! - V1: `get_active_shift` sorgusu tenant filtresizdi -> cross-tenant kasa sızıntısı
//! - V2: `get_open_shifts` sorgusu tenant filtresizdi -> cross-tenant vardiya sızıntısı
//! - V3: `waiter_clock_in` RBAC çağırmıyor ve tenant bağlamıyordu
//! - V4: `open_shift` / `close_shift` RBAC çağırmıyordu
//! - V5: `orders.cashier_id` hiç yazılmıyordu -> garson karnesi imkânsız
//!
//! Her test bir ihlali kanıtlar. Sadece "kod derleniyor" kontrolü değildir.

pub mod common;
pub mod v1_v2;
pub mod v3_v5;
