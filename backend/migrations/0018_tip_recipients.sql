ALTER TABLE tip_pool_entries ADD COLUMN recipient_user_id TEXT;
ALTER TABLE tip_pool_entries ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tip_request
ON tip_pool_entries (tenant_id, request_id) WHERE request_id IS NOT NULL;
CREATE VIEW IF NOT EXISTS staff_tip_earnings AS
SELECT tenant_id, user_id, period, amount_cents, created_at FROM tip_distributions
UNION ALL
SELECT tenant_id, recipient_user_id, period, amount_cents, created_at
FROM tip_pool_entries WHERE recipient_user_id IS NOT NULL;
