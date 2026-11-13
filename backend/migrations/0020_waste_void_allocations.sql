-- Fire iptali ve düzeltmesi: iptal işareti ve partiye göre düşüm dağılımı.
ALTER TABLE waste_records ADD COLUMN voided_at TEXT;
ALTER TABLE waste_records ADD COLUMN voided_by TEXT;
ALTER TABLE waste_records ADD COLUMN void_reason TEXT;
CREATE TABLE IF NOT EXISTS waste_allocations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    waste_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_cost_cents INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_waste_alloc_waste ON waste_allocations(tenant_id, waste_id);
