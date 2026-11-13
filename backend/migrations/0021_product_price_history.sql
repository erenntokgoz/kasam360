-- Menü fiyat değişim geçmişi: eski fiyat, yeni fiyat, kim ve ne zaman.
CREATE TABLE IF NOT EXISTS product_price_history (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    old_price_cents INTEGER NOT NULL CHECK (old_price_cents >= 0),
    new_price_cents INTEGER NOT NULL CHECK (new_price_cents >= 0),
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('MENU_EDIT', 'BULK_UPDATE')),
    changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_history_time ON product_price_history(tenant_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON product_price_history(tenant_id, product_id, changed_at);
