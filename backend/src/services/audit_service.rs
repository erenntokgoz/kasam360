use sha2::{Digest, Sha256};
use hex;
use uuid::Uuid;
use sqlx::Row;

const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

pub struct AuditService;

impl AuditService {
    #[allow(clippy::too_many_arguments)]
    pub fn compute_audit_hash(
        sequence: i64,
        timestamp: &str,
        actor_id: &str,
        actor_role: &str,
        action: &str,
        resource_id: &str,
        payload_json: &str,
        previous_hash: &str,
    ) -> String {
        let canonical = format!(
            "{}:{}:{}:{}:{}:{}:{}:{}",
            sequence, timestamp, actor_id, actor_role, action, resource_id, payload_json, previous_hash
        );
        let mut hasher = Sha256::new();
        hasher.update(canonical.as_bytes());
        hex::encode(hasher.finalize())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn append_audit_entry(
        conn: &mut sqlx::SqliteConnection,
        transaction_id: &str,
        method: &str,
        total_amount: i64,
        total_cogs_cents: i64,
        item_count: usize,
        actor_id: &str,
        now_iso: &str,
    ) -> Result<(), String> {
        let latest_row = sqlx::query(
            "SELECT sequence, current_hash FROM audit_ledger ORDER BY sequence DESC LIMIT 1",
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let (next_seq, prev_hash) = match latest_row {
            Some(row) => {
                let seq: i64 = row.get("sequence");
                let hash: String = row.get("current_hash");
                (seq + 1, hash)
            }
            None => (1, GENESIS_HASH.to_string()),
        };

        let action = "payment:settled_fifo";
        let actor_role = "System";

        let ledger_payload_obj = serde_json::json!({
            "transactionId": transaction_id,
            "method": method,
            "totalAmount": total_amount,
            "cogsTotalCents": total_cogs_cents,
            "itemsCount": item_count,
        });
        let ledger_payload_str =
            serde_json::to_string(&ledger_payload_obj).map_err(|e| e.to_string())?;

        let current_hash = Self::compute_audit_hash(
            next_seq,
            now_iso,
            actor_id,
            actor_role,
            action,
            transaction_id,
            &ledger_payload_str,
            &prev_hash,
        );

        let ledger_entry_id = format!("ledger_{}", Uuid::new_v4());

        sqlx::query(
            "INSERT INTO audit_ledger \
             (id, sequence, timestamp, actor_id, actor_role, action, resource_id, payload, \
              previous_hash, current_hash, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&ledger_entry_id)
        .bind(next_seq)
        .bind(now_iso)
        .bind(actor_id)
        .bind(actor_role)
        .bind(action)
        .bind(transaction_id)
        .bind(&ledger_payload_str)
        .bind(&prev_hash)
        .bind(&current_hash)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn append_generic_audit_entry(
        conn: &mut sqlx::SqliteConnection,
        action: &str,
        resource_id: &str,
        payload_obj: serde_json::Value,
        actor_id: &str,
        actor_role: &str,
        now_iso: &str,
    ) -> Result<(), String> {
        let latest_row = sqlx::query(
            "SELECT sequence, current_hash FROM audit_ledger ORDER BY sequence DESC LIMIT 1",
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let (next_seq, prev_hash) = match latest_row {
            Some(row) => {
                let seq: i64 = row.get("sequence");
                let hash: String = row.get("current_hash");
                (seq + 1, hash)
            }
            None => (1, GENESIS_HASH.to_string()),
        };

        let ledger_payload_str =
            serde_json::to_string(&payload_obj).map_err(|e| e.to_string())?;

        let current_hash = Self::compute_audit_hash(
            next_seq,
            now_iso,
            actor_id,
            actor_role,
            action,
            resource_id,
            &ledger_payload_str,
            &prev_hash,
        );

        let ledger_entry_id = format!("ledger_{}", Uuid::new_v4());

        sqlx::query(
            "INSERT INTO audit_ledger \
             (id, sequence, timestamp, actor_id, actor_role, action, resource_id, payload, \
              previous_hash, current_hash, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&ledger_entry_id)
        .bind(next_seq)
        .bind(now_iso)
        .bind(actor_id)
        .bind(actor_role)
        .bind(action)
        .bind(resource_id)
        .bind(&ledger_payload_str)
        .bind(&prev_hash)
        .bind(&current_hash)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_audit_hash() {
        let sequence = 1;
        let timestamp = "2024-01-01T10:00:00Z";
        let actor_id = "test_actor";
        let actor_role = "System";
        let action = "test_action";
        let resource_id = "test_resource";
        let payload_json = "{}";
        let previous_hash = "0000000000000000000000000000000000000000000000000000000000000000";

        let hash = AuditService::compute_audit_hash(
            sequence, timestamp, actor_id, actor_role, action, resource_id, payload_json, previous_hash,
        );

        assert_eq!(hash.len(), 64);
    }
}
