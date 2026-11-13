-- Para hesapları (kasa, banka, POS) ve hesaplar arası transferler.
-- Bakiye saklanmaz: açılış tutarı artı gelen eksi giden transferlerden türetilir.
CREATE TABLE IF NOT EXISTS money_accounts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('CASH', 'BANK', 'POS')),
    opening_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_cents >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_money_accounts_name ON money_accounts(tenant_id, lower(name));
CREATE TABLE IF NOT EXISTS account_transfers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    from_account_id TEXT NOT NULL REFERENCES money_accounts(id) ON DELETE RESTRICT,
    to_account_id TEXT NOT NULL REFERENCES money_accounts(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    note TEXT NOT NULL DEFAULT '',
    actor_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (from_account_id <> to_account_id)
);
CREATE INDEX IF NOT EXISTS idx_account_transfers_tenant ON account_transfers(tenant_id, created_at);
