-- Migration 0002: Schema enhancements & performance indexes
-- db/mod.rs içindeki dağınık ALTER TABLE ifadelerinin sürümlü migration'a taşınması

-- Plans tablosu sütunları
ALTER TABLE plans ADD COLUMN max_branches INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plans ADD COLUMN features TEXT;
ALTER TABLE plans ADD COLUMN badge TEXT;

-- Users tablosu kimlik doğrulama sütunları
ALTER TABLE users ADD COLUMN credential_hash TEXT;
ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN login_identifier TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN must_change_pin INTEGER NOT NULL DEFAULT 0;

-- Outbox tablosu dispatcher sütunları
ALTER TABLE outbox ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN last_error TEXT;
ALTER TABLE outbox ADD COLUMN dispatched_at DATETIME;

-- Platform admins tablosu Argon2 sütunu
ALTER TABLE platform_admins ADD COLUMN pin_hash TEXT;

-- Audit ledger kategori ve hash sürümü sütunları
ALTER TABLE audit_ledger ADD COLUMN category TEXT NOT NULL DEFAULT 'SISTEM';
ALTER TABLE audit_ledger ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1;

-- Approvals tablosu onay ve jeton sütunları
ALTER TABLE approvals ADD COLUMN approved_by_role TEXT;
ALTER TABLE approvals ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE approvals ADD COLUMN token_hash TEXT;
ALTER TABLE approvals ADD COLUMN expires_at DATETIME;
ALTER TABLE approvals ADD COLUMN consumed_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status ON approvals(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_resource ON approvals(tenant_id, resource_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_token ON approvals(token_hash) WHERE token_hash IS NOT NULL;

-- Modifier grupları kategori şablonu ve indeksleri
ALTER TABLE modifier_groups ADD COLUMN category_id TEXT;
CREATE INDEX IF NOT EXISTS idx_modifier_groups_tenant_category ON modifier_groups(tenant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_product_modifier_groups_product ON product_modifier_groups(product_id);

-- Tenants tablosu iletişim/şirket sütunları
ALTER TABLE tenants ADD COLUMN contact_person TEXT;
ALTER TABLE tenants ADD COLUMN email TEXT;
ALTER TABLE tenants ADD COLUMN phone TEXT;
ALTER TABLE tenants ADD COLUMN tax_id TEXT;
ALTER TABLE tenants ADD COLUMN tax_office TEXT;
ALTER TABLE tenants ADD COLUMN address TEXT;

-- Performans indeksleri
CREATE INDEX IF NOT EXISTS idx_order_items_tenant_product ON order_items(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_events_order_settled ON events (tenant_id, json_extract(payload, '$.orderId')) WHERE aggregate_type = 'SALE' AND event_type = 'SALE_SETTLED';

-- Yeni saha kolonları
ALTER TABLE order_items ADD COLUMN paid_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN is_comp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN course_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN guest_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN default_station TEXT DEFAULT 'Sıcak';

