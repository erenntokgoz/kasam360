//! Prefixed K-sortable ID Generator (Stripe / ULID Standard)
//! Kasam360 Kurumsal Kimlik Anatomisi
//! Format: <prefix>_<12_hex_timestamp_ms><12_hex_entropy>

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Belirtilen ön ek ile zaman damgalı (K-sortable) benzersiz kimlik üretir.
pub fn generate_id(prefix: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let seq = COUNTER.fetch_add(1, Ordering::Relaxed) & 0xFFFF;
    let rand_part = uuid::Uuid::new_v4().simple().to_string();

    // 12 karakter zaman damgası + 4 karakter sıra + 8 karakter rastgele entropi = 24 karakter
    format!("{}_{:012x}{:04x}{}", prefix, now_ms, seq, &rand_part[..8])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prefixed_id_format() {
        let order_id = generate_id("ord");
        assert!(order_id.starts_with("ord_"));
        assert_eq!(order_id.len(), 4 + 12 + 4 + 8); // "ord_" (4) + 24 = 28

        let table_id = generate_id("tbl");
        assert!(table_id.starts_with("tbl_"));

        let txn_id = generate_id("txn");
        assert!(txn_id.starts_with("txn_"));
    }

    #[test]
    fn test_k_sortable_ordering() {
        let id1 = generate_id("ord");
        std::thread::sleep(std::time::Duration::from_millis(2));
        let id2 = generate_id("ord");
        assert!(id1 < id2);
    }
}
