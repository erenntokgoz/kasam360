//! Yerel ağ eşitlemesi (`docs/local-network-sync.md`).

mod actor;
mod election;
pub mod engine;
pub mod op_log;
pub mod pairing;
mod replication;
pub mod runtime;
pub mod secure_channel;
pub mod store;
mod transport;
pub mod write_gate;

pub use op_log::{Operation, OperationOutcome, OperationStatus};
pub use runtime::{LanSync, SyncStatus};

#[cfg(test)]
mod network_tests;
