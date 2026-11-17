-- Paket servis: müşteri rehberi, adresler, paket siparişi durumu ve kurye mutabakatı.
-- Paket siparişinin kalemleri, stoğu ve tahsilatı mevcut `orders` / `order_items` hattındadır.
-- Bu tablolar yalnız teslimat bilgisini ve durumunu tutar. Kurye bir personel etiketidir.
ALTER TABLE users ADD COLUMN is_courier INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS delivery_customers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_customers_phone ON delivery_customers(tenant_id, phone);
CREATE TABLE IF NOT EXISTS delivery_addresses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES delivery_customers(id) ON DELETE RESTRICT,
    label TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL,
    directions TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_addresses_customer ON delivery_addresses(tenant_id, customer_id);
CREATE TABLE IF NOT EXISTS courier_settlements (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    courier_id TEXT NOT NULL,
    order_count INTEGER NOT NULL CHECK (order_count > 0),
    expected_cash_cents INTEGER NOT NULL CHECK (expected_cash_cents >= 0),
    expected_card_cents INTEGER NOT NULL CHECK (expected_card_cents >= 0),
    received_cash_cents INTEGER NOT NULL CHECK (received_cash_cents >= 0),
    received_card_cents INTEGER NOT NULL CHECK (received_card_cents >= 0),
    note TEXT NOT NULL DEFAULT '',
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courier_settlements_courier ON courier_settlements(tenant_id, courier_id, created_at);
CREATE TABLE IF NOT EXISTS delivery_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    customer_id TEXT REFERENCES delivery_customers(id) ON DELETE RESTRICT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address_text TEXT NOT NULL,
    directions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'PHONE'
        CHECK (source IN ('PHONE', 'COUNTER', 'YEMEKSEPETI', 'GETIR', 'TRENDYOL', 'MIGROS')),
    external_ref TEXT,
    status TEXT NOT NULL DEFAULT 'PREPARING'
        CHECK (status IN ('PREPARING', 'READY', 'ON_ROUTE', 'DELIVERED', 'CANCELLED')),
    courier_id TEXT,
    fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'CARD', 'ONLINE')),
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ready_at TEXT,
    dispatched_at TEXT,
    delivered_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT,
    settlement_id TEXT REFERENCES courier_settlements(id) ON DELETE RESTRICT,
    settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_courier ON delivery_orders(tenant_id, courier_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_orders_external ON delivery_orders(tenant_id, source, external_ref)
    WHERE external_ref IS NOT NULL;
