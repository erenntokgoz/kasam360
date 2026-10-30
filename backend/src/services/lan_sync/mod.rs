//! Yerel ağ eşitlemesi (`docs/local-network-sync.md`).

mod actor;
pub mod capture;
mod election;
pub mod engine;
mod membership;
pub mod op_log;
pub mod pairing;
mod replication;
pub mod runtime;
pub mod secure_channel;
pub mod store;
mod transport;
pub mod write_gate;
pub mod write_tx;

pub use op_log::{Operation, OperationOutcome, OperationStatus};
pub use runtime::{LanSync, SyncStatus};
pub use write_tx::{WritePool, WriteTx};

#[cfg(test)]
mod network_tests;

#[cfg(test)]
mod replication_fault_tests;

#[cfg(test)]
mod replication_tests;
