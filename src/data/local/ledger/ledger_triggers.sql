-- ============================================================================
-- Kasam360 Immutable Audit Ledger - Schema & Tamper-Proof Triggers
-- Step 2.7: Cryptographic Hash Chain, Append-Only Storage, & Tamper-Proof Triggers
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

-- ============================================================================
-- TAMPER-PROOF TRIGGERS (APPEND-ONLY ENFORCEMENT)
-- Any modification (UPDATE) or deletion (DELETE) is immediately aborted.
-- ============================================================================

-- 1. Prevent UPDATE operations on audit_ledger
CREATE TRIGGER IF NOT EXISTS trg_audit_ledger_prevent_update
BEFORE UPDATE ON audit_ledger
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY MANDATE VIOLATION: Updates to audit_ledger are strictly prohibited.');
END;

-- 2. Prevent DELETE operations on audit_ledger
CREATE TRIGGER IF NOT EXISTS trg_audit_ledger_prevent_delete
BEFORE DELETE ON audit_ledger
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY MANDATE VIOLATION: Deletions from audit_ledger are strictly prohibited.');
END;

-- ============================================================================
-- INTEGRITY & SEQUENCE VALIDATION TRIGGER (BEFORE INSERT)
-- Ensures sequence is strictly positive and hashes match 64-character hex length.
-- ============================================================================

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

-- ============================================================================
-- ROLE ISOLATION MANDATE SPECIFICATION:
-- ----------------------------------------------------------------------------
-- Auditor Role: STRICTLY READ-ONLY & EXPORT (SELECT, export to JSON/CSV/ARCHIVE, VERIFY)
-- Owner Role:   STRICTLY READ-ONLY & EXPORT (SELECT, export to JSON/CSV/ARCHIVE, VERIFY)
-- System Role:  AUTHORIZED APPEND ONLY via HashChainBuilder (INSERT)
-- All Other:    PROHIBITED from direct or indirect ledger access.
-- ============================================================================
