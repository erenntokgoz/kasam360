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
--
-- `timestamp` hashed kanonik girdinin parçasıdır ve RFC3339 kalır; biçimi
-- değiştirmek mevcut tüm satırların doğrulamasını kırardı (hash_version = 1
-- kanonik formu dondurulmuştur).
--
-- `created_at` raporların ve vardiya karşılaştırmalarının okuduğu sütundur.
-- `shifts.opened_at` ve `cash_movements.created_at` ile aynı biçimde
-- SQLite'in yerel UTC gösterimini kullanır; iki biçimin bir arada yaşaması
-- metin karşılaştırmalarını sessizce bozuyordu.
--
-- `category` spec'te tanımlanan 8 ana kategoriden biridir ve veritabanı
-- seviyesinde doğrulanır. `hash_version` mevcut kanonik formu (1) dondurur.
CREATE TABLE IF NOT EXISTS audit_ledger (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    sequence INTEGER NOT NULL UNIQUE,
    timestamp TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'SISTEM',
    action TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    current_hash TEXT NOT NULL UNIQUE,
    hash_version INTEGER NOT NULL DEFAULT 1,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance & Integrity Indexes
CREATE INDEX IF NOT EXISTS idx_audit_ledger_sequence ON audit_ledger(sequence ASC);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_current_hash ON audit_ledger(current_hash);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_previous_hash ON audit_ledger(previous_hash);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_timestamp ON audit_ledger(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_actor_id ON audit_ledger(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_action ON audit_ledger(action);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_resource_id ON audit_ledger(resource_id);
-- Çok tenantlı okuma yolları her sorguyu tenant'a göre daraltır.
CREATE INDEX IF NOT EXISTS idx_audit_ledger_tenant_sequence ON audit_ledger(tenant_id, sequence ASC);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_tenant_action ON audit_ledger(tenant_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_tenant_category ON audit_ledger(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_tenant_created ON audit_ledger(tenant_id, created_at);

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
--
-- `CREATE TRIGGER IF NOT EXISTS` eski tanımı yükseltmediği için önce düşürülür:
-- aksi halde zincir doğrulaması hiçbir zaman yüklenmezdi.
DROP TRIGGER IF EXISTS trg_audit_ledger_validate_insert;

CREATE TRIGGER trg_audit_ledger_validate_insert
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
            WHEN NEW.hash_version < 1 THEN
                RAISE(ABORT, 'INTEGRITY VIOLATION: hash_version must be a positive integer.')
            WHEN NEW.category NOT IN ('SIPARIS_MASA', 'ODEME', 'FINANS', 'PERSONEL', 'MENU', 'YETKI', 'SISTEM', 'GUVENLIK') THEN
                RAISE(ABORT, 'INTEGRITY VIOLATION: Unknown audit category.')
            -- İlk kayıt sıfır hash'le, sonraki kayıtlar doğrudan bir öncekinin
            -- hash'iyle zincirlenmek zorunda. İki eşzamanlı yazıcı bu kontrol
            -- sayesinde zinciri forksuz tutar.
            WHEN NOT EXISTS (SELECT 1 FROM audit_ledger) AND NEW.previous_hash != '0000000000000000000000000000000000000000000000000000000000000000' THEN
                RAISE(ABORT, 'INTEGRITY VIOLATION: The first entry must link to the zero hash.')
            WHEN EXISTS (SELECT 1 FROM audit_ledger)
                 AND NEW.previous_hash != (SELECT current_hash FROM audit_ledger ORDER BY sequence DESC LIMIT 1) THEN
                RAISE(ABORT, 'INTEGRITY VIOLATION: previous_hash does not match the current ledger tip.')
            WHEN NEW.sequence != (SELECT COALESCE(MAX(sequence), 0) + 1 FROM audit_ledger) THEN
                RAISE(ABORT, 'INTEGRITY VIOLATION: sequence must continue from the current tip.')
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
    id TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'RESERVED', 'OCCUPIED')),
    opened_at DATETIME,
    waiter_id TEXT,
    current_total INTEGER NOT NULL DEFAULT 0
);

-- Faz 8 — Rezervasyon kaydı.
--
-- Neden ayrı tablo: rezervasyon bir "durum bayrağı" değil, müşteri adı, telefon,
-- kişi sayısı ve randevu saati taşıyan **kendi kimliği olan bir kayıttır**. Eski
-- modelde `tables.status = 'RESERVED'` tek başına rezervasyonu temsil ediyordu;
-- dolu masaya rezerve etme, rezervasyonu kaldırma ve geciken rezervasyon takibi
-- bu yüzden mümkün değildi.
--
-- Durum makinesi: ACTIVE → ARRIVED → SEATED (adisyon açıldı), ya da
-- ACTIVE/ARRIVED → CANCELLED (vazgeçti) / NO_SHOW (gelmedi) / EXPIRED (süre doldu).
-- Kapanan kayıt SİLİNMEZ; salon planındaki mor blok bu satırın varlığından
-- türetilir, "gelmeyen misafir" geçmişi de kaybolmaz.
CREATE TABLE IF NOT EXISTS reservations (
    id TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    table_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'ARRIVED', 'SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED')),
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    party_size INTEGER NOT NULL DEFAULT 1 CHECK (party_size > 0),
    -- Müşterinin verdiği randevu saati (ISO-8601). Bekleme sayacı bu değere göre
    -- değil, `created_at` değerine göre işler: randevu saati ileriye dönük olabilir.
    reserved_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    arrived_at TEXT,
    closed_at TEXT,
    note TEXT,
    created_by TEXT,
    created_by_role TEXT,
    closed_by TEXT,
    close_reason TEXT,
    FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reservations_tenant_status
    ON reservations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_table
    ON reservations(tenant_id, table_id);
CREATE INDEX IF NOT EXISTS idx_reservations_created_at
    ON reservations(created_at);

-- Kısmi tekil indeks: aynı kiracıda bir masada aynı anda **tek açık** rezervasyon
-- durabilir. Uygulama katmanındaki kontroller yarış koşulunda (iki garson aynı
-- anda tıklarsa) yetersiz kalır; bu indeks kuralı veritabanı seviyesinde
-- zorunlu kılar ve eşzamanlı adisyon güvenliğini tamamlar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_one_open_per_table
    ON reservations(tenant_id, table_id)
    WHERE status IN ('ACTIVE', 'ARRIVED');

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

-- `pin` sütunu kaldırılmıştır: PIN düz metin saklanmaz, yalnızca Argon2id PHC
-- (`pin_hash`) tutulur. Bu nedenle (tenant_id, pin) tekil indeksi de kaldırılmıştır
-- — tuzlu hash'ler karşılaştırılamaz, indeks çakışma yakalayamaz. Tenant içi PIN
-- benzersizliği `user_credentials::ensure_pin_available` ile, yazma yarışına karşı
-- `ensure_pin_unique_after_write` ile korunur.
--
-- `credential_hash` ve `pin_hash` ayrıdır: bir kullanıcı hem e-posta/şifreyle
-- (kurulum ekranı) hem de POS PIN'iyle (çalışma istasyonu) girebilmelidir.
-- Tek sütunda tutulsaydı biri yazıldığında diğeri ezilirdi.
-- `is_active`: personel silinmez, pasife alınır (AGENTS.md §6).
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    credential_hash TEXT,
    pin_hash TEXT,
    login_identifier TEXT,
    email TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_tenant_active ON users(tenant_id, is_active);

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    tax_id TEXT,
    tax_office TEXT,
    address TEXT
);

CREATE TABLE IF NOT EXISTS tenant_modules (
    tenant_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, module_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- `pin` sütunu kaldırılmıştır: MASTER kimlik bilgisi düz metin saklanmaz, yalnızca
-- Argon2id PHC (`pin_hash`) tutulur. `UNIQUE` kısıtı da düşmüştür: tuzlu hash'ler
-- karşılaştırılamaz, aynı kimlikten iki farklı hash çıkacağı için indeks hiçbir
-- çakışma yakalayamazdı. Bu tabloda tek bir MASTER hesabı beklenir ve yazma yolu
-- bulunmadığından benzersizlik uygulama katmanında da dayatılmıyor.
CREATE TABLE IF NOT EXISTS platform_admins (
    id TEXT PRIMARY KEY,
    pin_hash TEXT,
    name TEXT NOT NULL,
    email TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
-- `category_id` NULL = serbest grup (bir ürüne doğrudan atanır),
-- dolu = o kategorinin şablonu. Mevcut satırlar NULL kalır; veri taşınmaz.
CREATE TABLE IF NOT EXISTS modifier_groups (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT 0,
    min_selections INTEGER NOT NULL DEFAULT 0,
    max_selections INTEGER,
    category_id TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_modifier_groups_tenant_category
    ON modifier_groups(tenant_id, category_id);

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

CREATE INDEX IF NOT EXISTS idx_product_modifier_groups_product
    ON product_modifier_groups(product_id);

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

-- FIFO PARTİ / LOT KUYRUĞU (GERÇEK FIFO MALİYETİ)
CREATE TABLE IF NOT EXISTS inventory_batches (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    inventory_item_id TEXT,
    product_id TEXT,
    batch_code TEXT,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    initial_quantity REAL NOT NULL,
    remaining_quantity REAL NOT NULL,
    unit_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_batches_prod ON inventory_batches(product_id, received_at ASC);
CREATE INDEX IF NOT EXISTS idx_inv_batches_item ON inventory_batches(inventory_item_id, received_at ASC);

-- APPROVAL ENGINE
-- Anlık PIN onayı (Faz 3): satır artık "kim onayladı" kaydıdır ve tek
-- kullanımlık jetonu taşır. Durum kümesi değişmez; onay `APPROVED` + çözülmüş
-- zaman damgasıyla yazılır. CHECK kısıtı eski veritabanlarında da geçerli
-- kalsın diye genişletilmemiştir.
CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    request_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approver_id TEXT,
    -- Onaylayanın rolü: "İptal/İade/Zayi — kim onayladı" raporunun kaynağı.
    approved_by_role TEXT,
    -- İşlemin tutarı (kuruş): jeton kapsamına girer, kapsam sapması reddedilir.
    amount_cents INTEGER NOT NULL DEFAULT 0,
    -- Jetonun kendisi değil, kanonik formunun SHA-256 özeti saklanır.
    token_hash TEXT,
    expires_at DATETIME,
    consumed_at DATETIME,
    payload TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status ON approvals(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_resource ON approvals(tenant_id, resource_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_token ON approvals(token_hash) WHERE token_hash IS NOT NULL;

-- Onay PIN'i deneme sayacı. Süreç belleği değil: uygulama yeniden başlasa da
-- kilit korunur (AGENTS.md §9/13). Kapsam terminal + tenant + işlem yüzeyi;
-- böylece bir cihazdaki hatalı deneme başka cihazın sayacını tüketmez.
CREATE TABLE IF NOT EXISTS approval_attempts (
    scope TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    terminal_id TEXT NOT NULL,
    surface TEXT NOT NULL,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
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

-- ============================================================================
-- 11. CARİ & REHBER (DIRECTORIES) — Müşteri, Tedarikçi ve Personel
-- ============================================================================
CREATE TABLE IF NOT EXISTS directories (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('CUSTOMER', 'SUPPLIER', 'STAFF', 'FIXED_EXPENSE', 'OWNER_PERSONAL')),
    phone TEXT,
    email TEXT,
    tax_no TEXT,
    tax_office TEXT,
    address TEXT,
    credit_limit_cents INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_directories_tenant_type ON directories(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_directories_name ON directories(name);

-- ============================================================================
-- 12. BORÇ / ALACAK & VERESİYE MOTORU (DEBTS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS debts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    directory_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('GIVEN', 'TAKEN')),
    total_amount_cents INTEGER NOT NULL,
    remaining_amount_cents INTEGER NOT NULL,
    due_date DATETIME,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE')),
    is_cash INTEGER NOT NULL DEFAULT 0,
    order_id TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (directory_id) REFERENCES directories(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_debts_tenant_dir ON debts(tenant_id, directory_id);
CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);

-- ============================================================================
-- 13. BORÇ TAHSİLAT & TEDİYE HAREKETLERİ (DEBT PAYMENTS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS debt_payments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    debt_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'CREDIT_CARD', 'BANK_TRANSFER')),
    shift_id TEXT,
    actor_id TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt_id ON debt_payments(debt_id);

-- ============================================================================
-- 14. GENEL İŞLETME GİDERLERİ (GENERAL EXPENSES)
-- ============================================================================
CREATE TABLE IF NOT EXISTS general_expenses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    category TEXT NOT NULL CHECK(category IN ('RENT', 'UTILITIES', 'SUPPLIER', 'STAFF_ADVANCE', 'TAX', 'PERSONAL', 'MAINTENANCE', 'OTHER')),
    amount_cents INTEGER NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'VERESIYE')),
    directory_id TEXT,
    shift_id TEXT,
    actor_id TEXT NOT NULL,
    description TEXT,
    expense_date DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (directory_id) REFERENCES directories(id)
);
CREATE INDEX IF NOT EXISTS idx_general_expenses_tenant_cat ON general_expenses(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_general_expenses_date ON general_expenses(expense_date);

-- ============================================================================
-- 15. TEKRARLAYAN GİDERLER (RECURRING EXPENSES)
-- ============================================================================
CREATE TABLE IF NOT EXISTS recurring_expenses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('RENT', 'UTILITIES', 'SUPPLIER', 'STAFF_ADVANCE', 'TAX', 'PERSONAL', 'MAINTENANCE', 'OTHER')),
    amount_cents INTEGER NOT NULL,
    frequency TEXT NOT NULL CHECK(frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY')),
    due_day INTEGER NOT NULL DEFAULT 1,
    directory_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (directory_id) REFERENCES directories(id)
);

-- ============================================================================
-- 16. BÜTÇE KOTALARI VE LİMİT UYARILARI (BUDGET LIMITS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS budget_limits (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    category TEXT NOT NULL,
    monthly_limit_cents INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(tenant_id, category)
);

-- ============================================================================
-- 17. AYLIK SATIŞ HEDEFLERİ (Faz 10 — Rapor & Analiz Merkezi)
-- ============================================================================
-- category = 'ALL' satır genel hedeftir; kategori satırları kırılım içindir.
-- Yalnızca CREATE TABLE IF NOT EXISTS: mevcut veritabanları bozulmaz.
CREATE TABLE IF NOT EXISTS monthly_targets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    month TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'ALL',
    target_cents INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(tenant_id, month, category)
);

CREATE INDEX IF NOT EXISTS idx_monthly_targets_tenant ON monthly_targets(tenant_id, month);

-- ============================================================================
-- 18. RAKİP FİYAT TAKİBİ (Faz 10)
-- ============================================================================
-- Aynı ürün + rakip için gözlem zamanı benzersizdir; yeni gözlem eskisini
-- günceller, geçmiş silinmez (karşılaştırma geçmişi korunur).
CREATE TABLE IF NOT EXISTS competitor_prices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    product_id TEXT NOT NULL,
    competitor_name TEXT NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0,
    observed_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(tenant_id, product_id, competitor_name, observed_at),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_competitor_prices_lookup
    ON competitor_prices(tenant_id, product_id, competitor_name, observed_at DESC);
