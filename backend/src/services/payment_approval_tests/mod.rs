//! `payment_approval` testleri.

use super::*;
pub use crate::approval_service::{self, operation, ApprovalRequest};
pub use crate::services::audit_service::{category, AuditLock};

pub mod common;
pub mod discount_tests;

pub use common::*;

#[cfg(test)]
#[path = "../payment_total_tests.rs"]
mod payment_total;
