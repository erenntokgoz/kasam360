-- ============================================================================
-- Kasam360 Seed Data
-- Idempotent: INSERT OR IGNORE means re-running this file is always safe.
-- price_cents values are INTEGER (Rule #17: no floating-point for financials).
-- current_total values are INTEGER cents (Rule #17).
-- ============================================================================

-- -------------------------
-- 1. Categories (3)
-- -------------------------
INSERT OR IGNORE INTO categories (id, name, display_order, icon) VALUES
    ('cat-001', 'Sicak Icecekler', 1, '☕'),
    ('cat-002', 'Soguk Icecekler', 2, '🥤'),
    ('cat-003', 'Yiyecekler',      3, '🍽️');

-- -------------------------
-- 2. Products (10)
-- price_cents: INTEGER (e.g. 1500 = 15.00 TL)
-- -------------------------
INSERT OR IGNORE INTO products (id, sku, barcode, name, price_cents, tax_rate, category_id, description, is_active, stock_quantity) VALUES
    -- Sicak Icecekler
    ('prd-001', 'SKU-CAF-001', NULL, 'Turk Kahvesi',  2000,  8.0, 'cat-001', 'Geleneksel Turk kahvesi',     1, NULL),
    ('prd-002', 'SKU-CAF-002', NULL, 'Espresso',       1800,  8.0, 'cat-001', 'Tek shot espresso',           1, NULL),
    ('prd-003', 'SKU-CAF-003', NULL, 'Sutlu Kahve',   2500,  8.0, 'cat-001', 'Latte veya sutlu kahve',      1, NULL),
    ('prd-004', 'SKU-CAF-004', NULL, 'Cay',            1200,  8.0, 'cat-001', 'Demli cay, ince belli',       1, NULL),
    -- Soguk Icecekler
    ('prd-005', 'SKU-ICE-001', NULL, 'Ayran',          1500,  8.0, 'cat-002', 'Soguk yayik ayrani',          1, NULL),
    ('prd-006', 'SKU-ICE-002', NULL, 'Limonata',       2200,  8.0, 'cat-002', 'Taze sikilmis limonata',      1, NULL),
    ('prd-007', 'SKU-ICE-003', NULL, 'Soguk Cay',     1800,  8.0, 'cat-002', 'Seftali aromali soguk cay',   1, NULL),
    -- Yiyecekler
    ('prd-008', 'SKU-FD-001',  NULL, 'Sigara Boregi', 3500, 10.0, 'cat-003', 'Citir peynirli borek (5 adet)', 1, NULL),
    ('prd-009', 'SKU-FD-002',  NULL, 'Karisik Tost',  4500, 10.0, 'cat-003', 'Kasar peynirli ve salam',     1, NULL),
    ('prd-010', 'SKU-FD-003',  NULL, 'Gozleme',       5000, 10.0, 'cat-003', 'Peynirli veya patatesli',     1, NULL);

-- -------------------------
-- 3. Tables (12)
-- current_total: INTEGER cents (0 = boş masa)
-- -------------------------
INSERT OR IGNORE INTO tables (id, name, status, opened_at, waiter_id, current_total) VALUES
    ('tbl-001', 'Masa 1',  'AVAILABLE', NULL, NULL, 0),
    ('tbl-002', 'Masa 2',  'AVAILABLE', NULL, NULL, 0),
    ('tbl-003', 'Masa 3',  'AVAILABLE', NULL, NULL, 0),
    ('tbl-004', 'Masa 4',  'AVAILABLE', NULL, NULL, 0),
    ('tbl-005', 'Masa 5',  'AVAILABLE', NULL, NULL, 0),
    ('tbl-006', 'Masa 6',  'AVAILABLE', NULL, NULL, 0),
    ('tbl-007', 'Masa 7',  'AVAILABLE', NULL, NULL, 0),
    ('tbl-008', 'Masa 8',  'AVAILABLE', NULL, NULL, 0),
    ('tbl-009', 'Masa 9',  'AVAILABLE', NULL, NULL, 0),
    ('tbl-010', 'Masa 10', 'AVAILABLE', NULL, NULL, 0),
    ('tbl-011', 'Masa 11', 'AVAILABLE', NULL, NULL, 0),
    ('tbl-012', 'Masa 12', 'AVAILABLE', NULL, NULL, 0);

-- -------------------------
-- 4. Users (6 rol)
-- INSERT OR IGNORE: mevcut kayıtları silmez, güvenle tekrar çalıştırılabilir.
-- -------------------------
INSERT OR IGNORE INTO users (id, pin, role, name) VALUES
    ('usr_master',  '1111', 'MASTER',  'Master Admin'),
    ('usr_owner',   '2222', 'OWNER',   'Owner (Patron)'),
    ('usr_manager', '3333', 'MANAGER', 'Manager (Müdür)'),
    ('usr_cashier', '4444', 'CASHIER', 'Cashier (Kasiyer)'),
    ('usr_waiter',  '5555', 'WAITER',  'Waiter (Garson)'),
    ('usr_cook',    '6666', 'KITCHEN', 'Kitchen (Aşçı)');

-- -------------------------
-- 5. Plans (3 Paket)
-- monthly_price_cents: INTEGER (ör: 49900 = 499.00 TL)
-- -------------------------
INSERT OR IGNORE INTO plans (id, name, monthly_price_cents, max_devices, max_users) VALUES
    ('plan_starter',    'Başlangıç Paketi',    49900, 2,  3),
    ('plan_pro',        'Profesyonel Paket',   99900, 5,  10),
    ('plan_enterprise', 'Kurumsal Paket',     199900, 20, 50);

-- -------------------------
-- 6. Tenants (3 Müşteri)
-- -------------------------
INSERT OR IGNORE INTO tenants (id, name, status, plan_id) VALUES
    ('DEFAULT_TENANT',  'Kasam360 Merkez İşletme', 'ACTIVE',    'plan_pro'),
    ('tenant_kadikoy',  'Kadıköy Şubesi & Kafe',    'ACTIVE',    'plan_starter'),
    ('tenant_moda',     'Moda Sahil Bistro',       'SUSPENDED', 'plan_starter');

-- -------------------------
-- 7. Subscriptions
-- -------------------------
INSERT OR IGNORE INTO subscriptions (id, tenant_id, plan_id, status, renews_at) VALUES
    ('sub_default',  'DEFAULT_TENANT', 'plan_pro',        'ACTIVE',    datetime('now', '+30 days')),
    ('sub_kadikoy',  'tenant_kadikoy', 'plan_starter',    'ACTIVE',    datetime('now', '+15 days')),
    ('sub_moda',     'tenant_moda',    'plan_starter',    'SUSPENDED', datetime('now', '-5 days'));

-- -------------------------
-- 8. Devices
-- -------------------------
INSERT OR IGNORE INTO devices (id, tenant_id, name, device_type, status, last_heartbeat) VALUES
    ('dev_pos_01', 'DEFAULT_TENANT', 'Ana Kasa POS Terminali', 'POS',     'ACTIVE', datetime('now')),
    ('dev_kds_01', 'DEFAULT_TENANT', 'Mutfak KDS Ekranı',      'KDS',     'ACTIVE', datetime('now', '-2 minutes')),
    ('dev_pos_02', 'tenant_kadikoy', 'Kadıköy Kasa 1',         'POS',     'ACTIVE', datetime('now', '-10 minutes')),
    ('dev_prn_01', 'tenant_kadikoy', 'Bar Yazıcısı',          'PRINTER', 'ACTIVE', datetime('now', '-1 hour'));

-- -------------------------
-- 9. Directories (5 Temel Cari Hesap)
-- -------------------------
INSERT OR IGNORE INTO directories (id, tenant_id, name, type, phone, credit_limit_cents, created_at) VALUES
    ('dir_001', 'DEFAULT_TENANT', 'Öz Gıda Toptan A.Ş.', 'SUPPLIER', '0212 555 1010', 5000000, datetime('now')),
    ('dir_002', 'DEFAULT_TENANT', 'Ahmet Yılmaz (Masa 4 Veresiye)', 'CUSTOMER', '0532 111 2233', 100000, datetime('now')),
    ('dir_003', 'DEFAULT_TENANT', 'Mehmet Usta (Aşçıbaşı)', 'STAFF', '0544 333 4455', 200000, datetime('now')),
    ('dir_004', 'DEFAULT_TENANT', 'Dükkan Sahibi (Mülk Sahibi)', 'FIXED_EXPENSE', '0533 777 8899', 0, datetime('now')),
    ('dir_005', 'DEFAULT_TENANT', 'Eren Bey (Patron Şahsi)', 'OWNER_PERSONAL', '0530 000 0001', 0, datetime('now'));

