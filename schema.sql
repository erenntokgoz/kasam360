PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    aggregate_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_aggregate_id ON events (aggregate_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);

CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING' NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);

CREATE TABLE IF NOT EXISTS snapshots (
    aggregate_id TEXT PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    latest_version INTEGER NOT NULL,
    state_payload TEXT NOT NULL CHECK (json_valid(state_payload)),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================================
-- Kasam360 Immutable Audit Ledger - Schema & Tamper-Proof Triggers
-- ============================================================================

-- Audit Ledger Table Definition
CREATE TABLE IF NOT EXISTS audit_ledger (
    id TEXT PRIMARY KEY NOT NULL,
    sequence INTEGER NOT NULL UNIQUE,
    timestamp TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    current_hash TEXT NOT NULL UNIQUE,
    metadata TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

-- Performance & Integrity Indexes
CREATE INDEX IF NOT EXISTS idx_audit_ledger_sequence ON audit_ledger(sequence ASC);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_current_hash ON audit_ledger(current_hash);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_previous_hash ON audit_ledger(previous_hash);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_timestamp ON audit_ledger(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_actor_id ON audit_ledger(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_action ON audit_ledger(action);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_resource_id ON audit_ledger(resource_id);

-- Tamper-Proof Triggers (Append-Only Enforcement)
CREATE TRIGGER IF NOT EXISTS trg_audit_ledger_prevent_update
BEFORE UPDATE ON audit_ledger
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY MANDATE VIOLATION: Updates to audit_ledger are strictly prohibited.');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_ledger_prevent_delete
BEFORE DELETE ON audit_ledger
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY MANDATE VIOLATION: Deletions from audit_ledger are strictly prohibited.');
END;

-- Integrity & Sequence Validation Trigger
CREATE TRIGGER IF NOT EXISTS trg_audit_ledger_validate_insert
BEFORE INSERT ON audit_ledger
FOR EACH ROW
BEGIN
    SELECT
        CASE
            WHEN NEW.sequence <= 0 THEN
                RAISE(ABORT, 'INTEGRITY VIOLATION: Sequence must be a positive integer starting at 1.')
            WHEN length(NEW.current_hash) != 64 THEN
                RAISE(ABORT, 'INTEGRITY VIOLATION: current_hash must be a 64-character SHA-256 hex string.')
            WHEN length(NEW.previous_hash) != 64 THEN
                RAISE(ABORT, 'INTEGRITY VIOLATION: previous_hash must be a 64-character SHA-256 hex string.')
        END;
END;

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    icon TEXT
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL DEFAULT '',
    barcode TEXT,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 10.0,
    category_id TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    stock_quantity INTEGER,
    color TEXT,
    image_url TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS tables (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    opened_at DATETIME,
    waiter_id TEXT,
    current_total REAL NOT NULL DEFAULT 0.0
);