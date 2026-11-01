-- Önceki kurulumlarda kapanmış adisyon değişiklik talepleri tablosu oluşturulur.
CREATE TABLE IF NOT EXISTS order_change_requests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    requested_by TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    decision_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_change_requests_tenant_status ON order_change_requests(tenant_id, status);
