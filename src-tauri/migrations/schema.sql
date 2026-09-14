PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
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
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    event_id TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING' NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);

CREATE TABLE IF NOT EXISTS snapshots (
    aggregate_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
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
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
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
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    icon TEXT
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
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
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    opened_at DATETIME,
    waiter_id TEXT,
    current_total INTEGER NOT NULL DEFAULT 0
);

-- Orders table — Blocker B-3 fix
-- total_cents is INTEGER to prevent floating-point financial errors (KASAM360 Rule #17)
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    table_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'IN_PROGRESS', 'PAID', 'CANCELLED', 'VOID')),
    total_cents INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    cashier_id TEXT,
    notes TEXT,
    FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_orders_table_id ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT', pin TEXT NOT NULL UNIQUE, role TEXT NOT NULL, name TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pin ON users(pin);

CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    cashier_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    closed_at DATETIME,
    expected_amount_cents INTEGER NOT NULL DEFAULT 0,
    actual_amount_cents INTEGER,
    difference_cents INTEGER
);

-- ============================================================================
-- PHASE 2: MISSING ARCHITECTURE TABLES
-- ============================================================================

-- TENANT ISOLATION
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    plan_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    monthly_price_cents INTEGER NOT NULL,
    max_devices INTEGER NOT NULL,
    max_users INTEGER NOT NULL,
    max_branches INTEGER NOT NULL DEFAULT 1,
    features TEXT,
    badge TEXT
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    renews_at DATETIME,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    license_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    last_heartbeat DATETIME
);

-- BRANCHES
CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- MODIFIERS
CREATE TABLE IF NOT EXISTS modifier_groups (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT 0,
    min_selections INTEGER NOT NULL DEFAULT 0,
    max_selections INTEGER
);

CREATE TABLE IF NOT EXISTS modifier_options (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_modifier_groups (
    product_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    PRIMARY KEY (product_id, group_id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE
);

-- INVENTORY
CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    current_stock REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL,
    min_stock_alert REAL
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    inventory_item_id TEXT NOT NULL,
    movement_type TEXT NOT NULL CHECK(movement_type IN ('IN', 'OUT', 'WASTE', 'ADJUST')),
    quantity REAL NOT NULL,
    actor_id TEXT NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
);

-- APPROVAL ENGINE
CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    request_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approver_id TEXT,
    payload TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at DATETIME
);

-- CASH MOVEMENTS
CREATE TABLE IF NOT EXISTS cash_movements (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    movement_type TEXT NOT NULL CHECK(movement_type IN ('IN', 'OUT')),
    amount_cents INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

-- STATIONS
CREATE TABLE IF NOT EXISTS stations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ORDER ITEMS (notes column for KDS visibility)
CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    tax_amount_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    modifiers TEXT,
    notes TEXT,
    station TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_station ON order_items(station);
