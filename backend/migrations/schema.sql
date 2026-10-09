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
    -- Faz 18 · outbox dispatcher. `retry_count` başarısız deneme
    -- sayısıdır; `MAX_RETRY` üstünde `DEAD_LETTER` durumu kurulur.
    -- `last_error` son teslimat hatasının özeti, `dispatched_at`
    -- başarı zamanıdır. Kolonlar hash kanonik formunun parçası
    -- değildir; mevcut satırlar PENDING olarak kalır.
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    dispatched_at DATETIME
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
    -- KDV oranı basis-point (binde) cinsinden: %10 = 1000, %20 = 2000.
    -- Eski `tax_rate REAL` kolonu kaldırıldı; migrasyon ile taşınır.
    tax_rate_bp INTEGER NOT NULL DEFAULT 1000 CHECK (tax_rate_bp >= 0),
    category_id TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    -- Legacy: `stock_quantity` kullanımdan kaldırıldı. Tek kaynak `inventory_batches`.
    -- Kolon veri taşıması için bırakıldı, yeni kod yazmaz.
    stock_quantity INTEGER,
    color TEXT,
    image_url TEXT,
    -- Faz 12 · 86'd: "stok bitti, menüden kalktı". `is_active` ile karışmasın
    -- diye ayrı tutuldu; `is_active` kalıcı, `is_86` geçicidir.
    is_86 BOOLEAN NOT NULL DEFAULT 0,
    stockout_reason TEXT,
    stockout_at TEXT,
    stockout_by TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);
CREATE INDEX IF NOT EXISTS idx_products_tenant_86
    ON products(tenant_id, is_86);

CREATE TABLE IF NOT EXISTS tables (
    id TEXT NOT NULL PRIMARY KEY,
    -- Neden varsayılan YOK: `DEFAULT 'DEFAULT_TENANT'` kalsaydı `tenant_id`
    -- bind etmeyen bir INSERT sessizce ortak havuza düşer ve kiracı izolasyonu
    -- delinirdi (AGENTS.md §3.3). Tenant çağırandan gelir.
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'RESERVED', 'OCCUPIED')),
    opened_at DATETIME,
    waiter_id TEXT,
    current_total INTEGER NOT NULL DEFAULT 0,
    -- Faz 13 · Kroki geometrisi. Varsayılanlar bilinçli: geçmiş masalar kroki
    -- açıldığında sol üst köşede üst üste binmesin diye sonradan serpiştirilir.
    x INTEGER NOT NULL DEFAULT 0,
    y INTEGER NOT NULL DEFAULT 0,
    rotation INTEGER NOT NULL DEFAULT 0,
    seats INTEGER NOT NULL DEFAULT 4,
    zone TEXT
);
CREATE INDEX IF NOT EXISTS idx_tables_tenant_zone
    ON tables(tenant_id, zone);

-- Faz 13 · Salon bölümleri (Ana Salon, Teras, Bar).
--
-- Neden `tenant_id` üzerinde varsayılan YOK: bind edilmemiş bir bölüm
-- sessizce ortak havuza düşmemeli, veritabanı hatası vermeli (AGENTS.md §3.3).
CREATE TABLE IF NOT EXISTS floor_zones (
    id          TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_floor_zones_tenant
    ON floor_zones(tenant_id, sort_order);

-- Faz 13 · Mimari objeler: kapı, bar, duvar, kolon.
--
-- `zone_id` boş olabilir; bölüm silinse de obje kaydı korunur çünkü salon
-- yeniden düzenlenebilir ve objenin kaybolması krokiyi bozar.
--
-- `template_id` objenin hangi şablondan geldiğini işaretler: şablon yeniden
-- uygulandığında yalnız kendi objeleri değişir, kullanıcının elle koyduğu
-- kapı/bar kalır. NULL = kullanıcı kendisi yerleştirdi.
CREATE TABLE IF NOT EXISTS floor_objects (
    id          TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    zone_id     TEXT,
    template_id TEXT,
    kind        TEXT NOT NULL CHECK (kind IN ('DOOR','BAR','WALL','COLUMN')),
    label       TEXT,
    x           INTEGER NOT NULL DEFAULT 0,
    y           INTEGER NOT NULL DEFAULT 0,
    width       INTEGER NOT NULL DEFAULT 80,
    height      INTEGER NOT NULL DEFAULT 80,
    rotation    INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_floor_objects_tenant_zone
    ON floor_objects(tenant_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_floor_objects_template
    ON floor_objects(tenant_id, template_id);

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
        CHECK (status IN ('OPEN', 'IN_PROGRESS', 'PAID', 'CANCELLED', 'VOID', 'COMPENSATED')),
    total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
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
-- `must_change_pin`: fabrika öntanımlı PIN ile tohumlanan hesaplar ilk
-- girişte PIN değiştirmek zorundadır (G2 · P0 güvenlik). Kullanıcı
-- PIN'ini değiştirdiğinde bayrak sıfırlanır.
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    credential_hash TEXT,
    pin_hash TEXT,
    login_identifier TEXT,
    email TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_pin INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_tenant_active ON users(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    cashier_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    closed_at DATETIME,
    expected_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (expected_amount_cents >= 0),
    actual_amount_cents INTEGER CHECK (actual_amount_cents >= 0),
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
    -- Nullable: hareket ya eski `inventory_items` kaydına ya da `products`
    -- kaydına bağlıdır. Faz 12 kör sayım düzeltmesi ürüne yazılır.
    inventory_item_id TEXT,
    product_id TEXT,
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
    -- Varsayılan YOK: tenant_id bind edilmeden yazılan parti ortak havuza
    -- düşmemeli, veritabanı hatası vermeli (AGENTS.md §3.3).
    tenant_id TEXT NOT NULL,
    inventory_item_id TEXT,
    product_id TEXT,
    batch_code TEXT,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Raf ömrü (Faz 12): aynı ürünün partileri farklı günlerde dolabildiği
    -- için son kullanma tarihi partinin kendisinde durur.
    expiry_date TEXT,
    received_by TEXT,
    initial_quantity REAL NOT NULL,
    remaining_quantity REAL NOT NULL,
    unit_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),
    subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
    tax_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount_cents >= 0),
    total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
    modifiers TEXT,
    notes TEXT,
    station TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    -- Garson kimliği (Faz 11 garson karnesi). Sipariş seviyesindeki
    -- `orders.cashier_id` masanın sahibidir; aynı masada kalemleri farklı
    -- garsonlar girebilir, bu yüzden kırılım kalem bazlıdır.
    waiter_id TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_station ON order_items(station);
CREATE INDEX IF NOT EXISTS idx_order_items_waiter ON order_items(tenant_id, waiter_id);

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

-- ============================================================================
-- 19. PERSONEL 360 (Faz 11) — Profil, Vardiya Planı, İzin, Maaş, Bahşiş
-- ============================================================================
-- Neden ayrı tablo: `users` kimlik dogrulamadir (Argon2id hash, PIN, soft-delete).
-- `staff_profiles` isveren verisidir (maas, TC, dogum gunu, ise giris). Ayni
-- tabloda tutulsaydi kimlik dogrulama sorgulari maas kolonlarini da tasirdi ve
-- yetkisiz erisim yuzeyi buyurdu. Ayri tablo = "kim giris yapar" ile "kimi
-- istihdam ediyoruz" ayrismasi.
CREATE TABLE IF NOT EXISTS staff_profiles (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    user_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
-- Maaş tutarları kuruş cinsinden; float YASAK (AGENTS.md §2).
    -- NULL = "henüz belirlenmedi". 0 ile aynı DEĞİLDİR: maaşı 0 olan
    -- personel ile maaşı tanımlanmamış personel farklı durumlardır ve
    -- ekranda "Belirlenmedi" / "0" ayrı gösterilir.
    base_salary_cents INTEGER,
    -- Yuzde modeli: 0-100 arasi, tam sayi. 0 "komsiyon yok" demektir.
    commission_percent INTEGER,
    birth_date TEXT,
    hire_date TEXT,
    phone TEXT,
    national_id TEXT,
    address TEXT,
    emergency_contact TEXT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_tenant
    ON staff_profiles(tenant_id, user_id);

-- Maaş modeli tanımı. Beş model tek tabloda: her model bir bayrak.
-- Tasarım gerekçesi: model başına tablo açmak yerine tek kural tablosu, bordro
-- yeniden hesabında hangi bileşenin kullanıldığını izlenebilir kılar.
CREATE TABLE IF NOT EXISTS payroll_rules (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    user_id TEXT NOT NULL,
    -- FIXED | COMMISSION | TIP | HOURLY | PROFIT_SHARE
    model TEXT NOT NULL DEFAULT 'FIXED',
    base_salary_cents INTEGER NOT NULL DEFAULT 0,
    commission_percent INTEGER NOT NULL DEFAULT 0,
    hourly_rate_cents INTEGER NOT NULL DEFAULT 0,
    -- Bahsis katsayisi: 1.00 = tam havuz. Yuzde olarak tutulur (100 = 1.00).
    tip_multiplier_percent INTEGER NOT NULL DEFAULT 100,
    -- Kar payi yuzdesi (net kara karsi)
    profit_share_percent INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Bordro kaydi: yeniden hesaplanabilir olmali, bu yuzden her hesap satirdir.
-- UPDATE/DELETE yasak: hatali hesap duzeltilir, silinmez.
CREATE TABLE IF NOT EXISTS payroll_runs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    user_id TEXT NOT NULL,
    -- YYYY-MM
    period TEXT NOT NULL,
    model TEXT NOT NULL,
    base_cents INTEGER NOT NULL DEFAULT 0,
    commission_cents INTEGER NOT NULL DEFAULT 0,
    tip_cents INTEGER NOT NULL DEFAULT 0,
    hourly_cents INTEGER NOT NULL DEFAULT 0,
    profit_share_cents INTEGER NOT NULL DEFAULT 0,
    deduction_cents INTEGER NOT NULL DEFAULT 0,
    gross_cents INTEGER NOT NULL DEFAULT 0,
    net_cents INTEGER NOT NULL DEFAULT 0,
    -- Hesap girdileri: hangi veriyle hesaplandigi yeniden uretilebilsin
    input_snapshot TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, user_id, period),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_period
    ON payroll_runs(tenant_id, period);

-- Bahsis havuzu: katsayili dagitim. Havuz bir kayit, dagitim bir kayit.
CREATE TABLE IF NOT EXISTS tip_pool_entries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    period TEXT NOT NULL,
    order_id TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    -- H_avuz = SUM(amount_cents); her calisan icin pay = katsayi * taban
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tip_distributions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    period TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    -- Kullanicinin havuzdan alacagi pay taban: genelde calisma saati veya fiis adedi
    basis_cents INTEGER NOT NULL DEFAULT 0,
    multiplier_percent INTEGER NOT NULL DEFAULT 100,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, period, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Vardiya planlamasi: `shifts` gerceklesen KASA hareketidir (muhasebeye bagli),
-- planlama ayri tabloda tutulur. Iki kavram birlestirilirse tablo iki isleve
-- sahip olur ve planlama degisikligi muhasebe kaydini bozar.
CREATE TABLE IF NOT EXISTS shift_plans (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    user_id TEXT NOT NULL,
    -- YYYY-MM-DD
    plan_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    planned_break_minutes INTEGER NOT NULL DEFAULT 0,
    role_required TEXT NOT NULL DEFAULT 'WAITER',
    station TEXT,
    -- Planlandi | Onaylandi | Tamamlandi | Iptal
    status TEXT NOT NULL DEFAULT 'Planned',
    realized_shift_id TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, user_id, plan_date, start_time),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shift_plans_date
    ON shift_plans(tenant_id, plan_date);

-- Izin talebi: durum gecmisi `status` ile tutulur, gecmis silinmez.
CREATE TABLE IF NOT EXISTS leave_requests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'YILLIK',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason TEXT,
    -- Bekliyor | Onaylandi | Reddedildi | Iptal
    status TEXT NOT NULL DEFAULT 'Bekliyor',
    approver_id TEXT,
    decided_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_user
    ON leave_requests(tenant_id, user_id, start_date);

-- Zimmet: personele teslim edilen malzeme. Iade tarihi dolunca acik kalir.
CREATE TABLE IF NOT EXISTS custody_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    user_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    -- Teslim | Iade | Hasarli
    status TEXT NOT NULL DEFAULT 'Teslim',
    delivered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    returned_at DATETIME,
    notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custody_open
    ON custody_records(tenant_id, user_id, status);

-- Tutanak sicili: sohbet, kaza, sikayet gibi kayitlar. Yonetici gormeli,
-- personel erisememelidir; bu yuzden ayri tablo ve ayri yetki kapisi.
CREATE TABLE IF NOT EXISTS staff_incidents (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'NOT',
    severity TEXT NOT NULL DEFAULT 'Dusuk',
    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    summary TEXT NOT NULL,
    details TEXT,
    resolution TEXT,
    -- ACIK | Inceleniyor | Kapandi
    status TEXT NOT NULL DEFAULT 'ACIK',
    recorded_by TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staff_incidents_status
    ON staff_incidents(tenant_id, status);-- ===========================================================================
-- FAZ 12 · MENÜ & STOK DERİNLEŞTİRME
-- ===========================================================================
-- Kapsam: dinamik tarife, happy hour, 86'd, fiyat dondurma, öğle/akşam menü,
-- toplu fiyat güncelleme, yarı mamul reçete, randıman/fire, kör sayım, birim
-- çevrim, raf ömrü, tedarikçi karşılaştırma.
--
-- Tasarım kuralları (AGENTS.md):
--   · Tüm tablolarda `tenant_id` NOT NULL ve her sorguda filtrelenir.
--   · Tüm tutarlar `*_cents` INTEGER; float YASAK.
--   · Kimlikler prefixed ULID (id_generator), AUTOINCREMENT YASAK.
--   · `audit_ledger` gibi değişmez tablolara yazılmaz; bunun yerine kendi
--     değişmez günlük tabloları tutulur.

-- ---------------------------------------------------------------------------
-- BİRİM ÇEVRİM — "1 kg = 4 adet" gibi dönüşümler
-- ---------------------------------------------------------------------------
-- Neden ayrı tablo: reçete ve sayım miktarları farklı birimlerle gelir
-- (kilo, gram, adet, litre, paket). Çevrim olmadan stok ile tüketim
-- kıyaslanamaz; elle "/4" yazmak sessiz hata üretir.
CREATE TABLE IF NOT EXISTS unit_conversions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    from_unit TEXT NOT NULL,
    to_unit TEXT NOT NULL,
    -- Kaç `from_unit`, kaç `to_unit` eder. REAL: dönüşüm oranı tam sayı olmak
    -- zorunda değildir (1 L = 1000 mL). TUTAR DEĞİLDİR; kuruş kuralı geçerli
    -- değildir.
    factor REAL NOT NULL CHECK (factor > 0),
    is_bidirectional BOOLEAN NOT NULL DEFAULT 0,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    UNIQUE(tenant_id, from_unit, to_unit)
);
CREATE INDEX IF NOT EXISTS idx_unit_conv_lookup
    ON unit_conversions(tenant_id, from_unit);

-- ---------------------------------------------------------------------------
-- TEDARİKÇİ — Fiyat ve performans karşılaştırması
-- ---------------------------------------------------------------------------
-- Not: `directories.type='SUPPLIER'` yalnız bir kişi/şirket kaydıdır; sipariş
-- fiyatı, teslim süresi ve performans burada tutulur. Ayırmak zorunluydu,
-- çünkü karşılaştırma sayısal fiyat ister, dizin kaydı sayısal taşımaz.
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    tax_number TEXT,
    address TEXT,
    -- Ödeme vadesi (gün). Geç ödeme riski raporlanabilsin diye saklanır.
    payment_term_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_term_days >= 0),
    -- Teslim süresi (gün). Karşılaştırma tablosunda gösterilir.
    lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
    is_active BOOLEAN NOT NULL DEFAULT 1,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_suppliers_active
    ON suppliers(tenant_id, is_active);

-- Tedarikçi → ürün fiyatı ve minimum sipariş miktarı.
CREATE TABLE IF NOT EXISTS supplier_products (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    -- Tek birim alış fiyatı (kuruş). `*_cents` kuralı: float YASAK.
    unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
    -- Minimum sipariş miktarı (ürünün kendi birimi).
    min_order_quantity REAL NOT NULL DEFAULT 1 CHECK (min_order_quantity > 0),
    pack_size TEXT,
    is_preferred BOOLEAN NOT NULL DEFAULT 0,
    valid_from TEXT,
    valid_to TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, supplier_id, product_id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_supplier_products_product
    ON supplier_products(tenant_id, product_id);

-- Satın alma siparişi: fiyat geçmişi ve fire kökeni buradan izlenir.
CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    order_number TEXT NOT NULL,
    -- TASI | ALINDI | Iptal
    status TEXT NOT NULL DEFAULT 'TASI'
        CHECK (status IN ('TASI', 'ALINDI', 'IPTAL')),
    ordered_at TEXT NOT NULL,
    expected_at TEXT,
    received_at TEXT,
    -- Sipariş toplamı (kuruş). Hesaplanmış alan: satırlar girildikçe
    -- güncellenir. float YASAK.
    total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
    created_by TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, order_number),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);
CREATE INDEX IF NOT EXISTS idx_po_status
    ON purchase_orders(tenant_id, status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    purchase_order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    -- Sipariş anındaki birim fiyat (kuruş). Kasıtlanan maliyettir; sonradan
    -- değişirse geçmiş fatura ile karşılaştırılabilir olsun diye dondurulur.
    unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
    received_quantity REAL NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_poi_order
    ON purchase_order_items(tenant_id, purchase_order_id);

-- ---------------------------------------------------------------------------
-- YARI MAMUL REÇETE (BOM) — Spec §2.12
-- ---------------------------------------------------------------------------
-- Neden gerekli: "kruasan" tek başına satılmayan, un + yağ + maya + tuz'dan
-- yapılan bir yarı mamuldür. Reçetesiz satış, maliyeti ve fireyi
-- görünmez kılar. Satılan ürünün maliyeti reçete + randıman ile çözülür.
CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    -- Üretim verimi yüzdesi: 100 gram hamurdan 80 gram mayalı hamur
    -- çıkıyorsa verim 80'dir. Fire bu oranın eksiğidir. 0-100.
    yield_percent REAL NOT NULL DEFAULT 100
        CHECK (yield_percent > 0 AND yield_percent <= 100),
    -- Standart üretim miktarı (ürün birimi). Maliyet bu miktara göre
    -- normalize edilir, böylece kısmi üretim yanlış maliyet vermez.
    output_quantity REAL NOT NULL DEFAULT 1 CHECK (output_quantity > 0),
    output_unit TEXT NOT NULL DEFAULT 'adet',
    -- Aktif reçete tek olmalıdır: aynı ürün için iki "aktif" reçete maliyeti
    -- belirsizleştirir. Kısmi benzersiz indeks bunu veritabanında garanti
    -- eder (aşağıda).
    is_active BOOLEAN NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
-- NOT: SQLite kısmi UNIQUE indeks destekler; aynı ürün için ikinci bir aktif
-- reçete eklenemez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_active_unique
    ON recipes(tenant_id, product_id) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_recipes_product
    ON recipes(tenant_id, product_id);

CREATE TABLE IF NOT EXISTS recipe_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    recipe_id TEXT NOT NULL,
    -- Malzeme ya da alt yarı mamul. `is_sub_recipe` ayrımı, maliyet
    -- çözümünün rekürsif olmasını sağlar.
    component_product_id TEXT NOT NULL,
    is_sub_recipe BOOLEAN NOT NULL DEFAULT 0,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    -- Fire payı yüzdesi: temel kayıp (kırpma, buharlaşma) kayıtta tutulur;
    -- randımandan ayrıdır çünkü üretim kaybı değil işleme kaybıdır.
    waste_percent REAL NOT NULL DEFAULT 0
        CHECK (waste_percent >= 0 AND waste_percent < 100),
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (component_product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe
    ON recipe_items(tenant_id, recipe_id);

-- ---------------------------------------------------------------------------
-- RAF ÖMRÜ
-- ---------------------------------------------------------------------------
-- `inventory_batches.expiry_date` ile birlikte çalışır: parti tarihi bilinir,
-- kalan miktar bilinir, raf ömrü dolmuşsa fire yazılır.
CREATE TABLE IF NOT EXISTS shelf_life_policies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    -- Raf ömrü gün sayısı. Üretim tarihine eklenerek son kullanma tarihi
    -- hesaplanır; tarih elle girilmez, yanlış girilmesi engellenir.
    shelf_life_days INTEGER NOT NULL CHECK (shelf_life_days > 0),
    -- Uyarı eşiği: kalan günler bu değere düşünce "yaklaşıyor" sayılır.
    warning_days INTEGER NOT NULL DEFAULT 3 CHECK (warning_days >= 0),
    storage_instruction TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, product_id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- FİYAT LİSTELERİ VE DİNAMİK TARİFE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_lists (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    -- PERAKENDE | TOPTAN | KAMPANYA
    kind TEXT NOT NULL DEFAULT 'PERAKENDE'
        CHECK (kind IN ('PERAKENDE', 'TOPTAN', 'KAMPANYA')),
    -- Opsiyonel etkinlik penceresi. Kapalıysa liste uygulanmaz.
    valid_from TEXT,
    valid_to TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    UNIQUE(tenant_id, name),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS price_list_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    price_list_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, price_list_id, product_id),
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Dinamik tarife ve happy hour aynı tabloda: ikisi de "belirli saatlerde
-- indirim" kuralıdır, ayrı tablolar kuralı iki yerde çoğaltırdı.
CREATE TABLE IF NOT EXISTS dynamic_pricing_rules (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    -- HAPPY_HOUR | OGLE | AKSAM | OZEL
    kind TEXT NOT NULL DEFAULT 'HAPPY_HOUR'
        CHECK (kind IN ('HAPPY_HOUR', 'OGLE', 'AKSAM', 'OZEL')),
    -- İndirim oranı yüzde (1-90). Yüzde 100+ indirim değil, fiyat sıfırlamadır;
    -- kapsam dışı bırakıldı.
    discount_percent INTEGER NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 90),
    -- `HH:MM` biçiminde. Gün sonu 23:59.
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    -- 1=Pazartesi ... 7=Pazar. Boşsa kural her gün geçerlidir.
    days_of_week TEXT,
    -- Kural yalnız bu ürünlere uygulanır; boşsa tüm menüye.
    product_ids TEXT,
    category_ids TEXT,
    valid_from TEXT,
    valid_to TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    -- Öncelik: çakışan kurallar için yüksek değer kazanır.
    priority INTEGER NOT NULL DEFAULT 100,
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    -- Pencere gün sonunu aşabilir ("22:00"-"02:00"): bu yüzden sıralama değil
    -- eşitlik yasaklanır. `end_time > start_time` kısıtı gece yarısını aşan
    -- kuralı veritabanı katmanında sessizce öldürürdü, kural kaydedilmez ve
    -- "kuralım çalışmıyor" sebebi görünmez olurdu.
    CHECK (end_time <> start_time)
);
CREATE INDEX IF NOT EXISTS idx_dpr_active
    ON dynamic_pricing_rules(tenant_id, is_active);

-- Fiyat dondurma: zam geldiğinde "bu fiyat şu tarihe kadar değişmeyecek"
-- taahhüdü. Zamdan etkilenen ürünlerde menü fiyatını sabit tutar.
CREATE TABLE IF NOT EXISTS price_freezes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    frozen_price_cents INTEGER NOT NULL CHECK (frozen_price_cents >= 0),
    reason TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (valid_to >= valid_from),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_freezes_active
    ON price_freezes(tenant_id, is_active, product_id);

-- Öğle/akşam menü: hangi ürün hangi dilimde satılır.
CREATE TABLE IF NOT EXISTS menu_service_windows (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    -- Kahvaltı | OGLE | AKSAM | GECE
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS menu_window_products (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    window_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, window_id, product_id),
    FOREIGN KEY (window_id) REFERENCES menu_service_windows(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- FIRE (ZAYİ) VE KÖR SAYIM
-- ---------------------------------------------------------------------------
-- Neden `waste_records` ayrı tablo: `stock_movements` hareketi kaydeder ama
-- firein **gerekçesi** (bozulan, son kullanma tarihi geçen, kırılan, fire
-- edilen) finansal raporda ayrı satır olmalıdır. Zararın kaynağı bilinmeden
-- "stok farkı" denmez.
CREATE TABLE IF NOT EXISTS waste_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    inventory_item_id TEXT,
    -- BOZULDU | RAF_OMRU_DOLDI | KIRILDI | SIZINTI | HATA_GIRIS | FIRE_EDILDI
    reason TEXT NOT NULL
        CHECK (reason IN ('BOZULDU', 'RAF_OMRU_DOLDI', 'KIRILDI', 'SIZINTI', 'HATA_GIRIS', 'FIRE_EDILDI')),
    quantity REAL NOT NULL CHECK (quantity > 0),
    -- Fire edilen partinin maliyeti. Kuruş cinsinden; parti bilinmiyorsa
    -- NULL (uydurulmaz) ve raporda "maliyeti bilinmiyor" görünür.
    unit_cost_cents INTEGER,
    total_cost_cents INTEGER,
    occurred_at TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_waste_product
    ON waste_records(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_waste_date
    ON waste_records(tenant_id, occurred_at);

-- Kör sayım: sayılan miktar, sistem miktarı GÖSTERİLMEZ. Farkı sayan kişi
-- gerçeği kendi ölçümüyle belirler; beklenen değeri görüp ona göre yazarsa
-- sayım anlamını yitirir.
CREATE TABLE IF NOT EXISTS stock_counts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    -- ACIK | KAPALI | UYGULANDI
    status TEXT NOT NULL DEFAULT 'ACIK'
        CHECK (status IN ('ACIK', 'KAPALI', 'UYGULANDI')),
    location TEXT,
    started_by TEXT NOT NULL,
    started_at TEXT NOT NULL,
    closed_by TEXT,
    closed_at TEXT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_status
    ON stock_counts(tenant_id, status);

CREATE TABLE IF NOT EXISTS stock_count_lines (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    stock_count_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    inventory_item_id TEXT,
    -- Sayılan miktar. Beklenen miktar bilinçli olarak tutulmaz; kapanışta
    -- hesaplanır ve defterde fark olarak yazılır.
    counted_quantity REAL NOT NULL DEFAULT 0 CHECK (counted_quantity >= 0),
    counted_by TEXT,
    counted_at TEXT,
    -- Kapanışta dolar: beklenen miktar ve fark.
    expected_quantity REAL,
    variance_quantity REAL,
    variance_cost_cents INTEGER,
    adjustment_applied BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, stock_count_id, product_id),
    FOREIGN KEY (stock_count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_count_lines_count
    ON stock_count_lines(tenant_id, stock_count_id);

-- ===========================================================================
-- FAZ 14 · YASAL & ÖZEL GÜN
-- ===========================================================================
-- Kapsam: ruhsat/yangın/HACCP/vergi/SGK takvimi, özel günler, kampanya,
-- kampanya şablonu, sigorta poliçesi, telif (MESAM/MSG), e-Arşiv KDV.
--
-- Tasarım kuralları (AGENTS.md):
--   · Kiracıya ait tablolarda `tenant_id` NOT NULL ve her sorguda filtrelenir.
--     Tek istisna `campaign_templates` sistem kataloğudur (kiracı verisi yok).
--   · Tüm tutarlar `*_cents` INTEGER; float YASAK. KDV oranı da tam sayıdır
--     (`kdv_rate_percent`), çünkü oranı float'ta tutmak kuruşta yuvarlama
--     hatası üretir.
--   · Tarihler `TEXT` ve `YYYY-AA-GG`: ISO metni sözlüksel sıralanır, saat
--     dilimi karışıklığı yoktur.
--   · Kimlikler prefixed ULID (id_generator), AUTOINCREMENT YASAK.
--   · Silme yok: tüm tablolarda `is_active` ile soft-delete uygulanır, çünkü
--     bu kayıtlar denetim izidir ve kaybolması uyum boşluğu doğurur.

-- ---------------------------------------------------------------------------
-- RUHSAT / YANGIN / HACCP / VERGİ / SGK
-- ---------------------------------------------------------------------------
-- Neden ayrı tablo: bu belgelerin ortak noktası "son kullanma tarihi +
-- Hatırlatma". Farklı belge türleri farklı otorite ve numara taşır; bir
-- `documents` tablosunda her tür için NULL dolgu yapmak okunability'i düşürür.
CREATE TABLE IF NOT EXISTS legal_documents (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    doc_type TEXT NOT NULL
        CHECK (doc_type IN ('RUHSAT','YANGIN','HACCP','VERGI','SGK','DIGER')),
    title TEXT NOT NULL,
    authority TEXT,
    document_number TEXT,
    issue_date TEXT,
    expiry_date TEXT NOT NULL,
    reminder_days INTEGER NOT NULL DEFAULT 30,
    file_path TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_legal_docs_tenant ON legal_documents(tenant_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_legal_docs_expiry ON legal_documents(tenant_id, expiry_date);

-- ---------------------------------------------------------------------------
-- ÖZEL GÜNLER
-- ---------------------------------------------------------------------------
-- `recurring_yearly`: 29 Kasım (Kara Cuma) her yıl tekrarlar; `advance_days`
-- indirimin başlamasından kaç gün önce başlayacağıdır.
CREATE TABLE IF NOT EXISTS special_days (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    recurring_yearly INTEGER NOT NULL DEFAULT 0,
    advance_days INTEGER NOT NULL DEFAULT 7,
    discount_percent INTEGER NOT NULL DEFAULT 0
        CHECK (discount_percent >= 0 AND discount_percent <= 90),
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_special_days_tenant ON special_days(tenant_id, date);

-- ---------------------------------------------------------------------------
-- KAMPANYA
-- ---------------------------------------------------------------------------
-- `rule_json` bir kural tanımıdır (örneğin {"min_total_cents": 5000,
-- "discount_percent": 10, "product_ids": [...]}). Sadece kupon kodu değil,
-- satın alma toplamı, ürün kapsamı ve saat aralığı gibi kural da saklanır.
-- Kural **tipli** okunur (services/legal360/campaigns.rs): geçersiz JSON veya
-- alan dışı değer reddedilir, varsayılana sessizce dönülmez.
-- `usage_count`: kupon kaç kez kullanıldı; `max_usage` NULL ise sınırsızdır.
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
    coupon_code TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0,
    max_usage INTEGER,
    valid_from TEXT,
    valid_to TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_campaigns_coupon ON campaigns(tenant_id, coupon_code);

-- ---------------------------------------------------------------------------
-- KAMPANYA ŞABLONU (10 hazır şablon, is_system=1)
-- ---------------------------------------------------------------------------
-- Sistem şablonları tenant'a kopyalanır; tenant kendi şablonlarını ekler.
-- `is_system` kolonu bu ayrımı yapar. Şablonlar tenant_id taşmaz.
CREATE TABLE IF NOT EXISTS campaign_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
    is_system INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- SİGORTA POLİÇESİ
-- ---------------------------------------------------------------------------
-- İşyeri sorumluluk, kasko, SGK primi. `premium_cents` aylık prim (kuruş).
CREATE TABLE IF NOT EXISTS insurance_policies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    policy_type TEXT NOT NULL
        CHECK (policy_type IN ('ISYERI','SORUMLULUK','SGK','KASKO','DIGER')),
    insurance_company TEXT NOT NULL,
    policy_number TEXT NOT NULL,
    premium_cents INTEGER NOT NULL DEFAULT 0,
    coverage_cents INTEGER,
    issue_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    reminder_days INTEGER NOT NULL DEFAULT 30,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_insurance_tenant ON insurance_policies(tenant_id, expiry_date);

-- ---------------------------------------------------------------------------
-- MÜZİK LİSENSİ (MESAM / MSG / BİLGİ)
-- ---------------------------------------------------------------------------
-- Telif bedeli: MESAM (müzik hakları), MSG (sesli mesaj), Bilgi Sistemi.
-- `amount_cents` yıl basisinde ödenen toplam telif (kuruş).
CREATE TABLE IF NOT EXISTS music_licenses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    license_type TEXT NOT NULL
        CHECK (license_type IN ('MESAM','MSG','BILGI','DIGER')),
    year INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    expiry_date TEXT NOT NULL,
    reminder_days INTEGER NOT NULL DEFAULT 30,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_music_licenses_tenant ON music_licenses(tenant_id, expiry_date);

-- ---------------------------------------------------------------------------
-- E-ARSİV / E-FATURA KUYRUK (KDV %1 / %10 / %20)
-- ---------------------------------------------------------------------------
-- Fatura kalem KDV oranları Türk vergi sistemine göre: %1 (indirimi),
-- %10 (temel), %20 (yüksek). `status`: PENDING → SENT → ACCEPTED / REJECTED.
--
-- Neden oran float değil: oranı REAL tutmak, KDV'yi kuruşta değil ondalıkta
-- yuvarlamaya yol açar. `kdv_rate_percent` tam sayıdır ve tek kabul edilen
-- değerler 1 / 10 / 20'dir; `CHECK` bunu veritabanı seviyesinde dondurur.
--
-- `total_cents` KDV **dahil** toplamdır (orders.total_cents ile aynı anlam).
-- KDV ve matrah toplamdan geri çözülür:
--   kdv_cents    = total_cents * oran / (100 + oran)
--   matrah_cents = total_cents - kdv_cents
-- KDV gönderimde yeniden hesaplanmaz; gönderilen ile saklanan aynı olmalıdır.
--
-- `order_id` yabancı anahtar **değildir**: sipariş iptalinde kayıt silinmez,
-- e-Arşiv izi korunur. Sahiplik sorgusu `tenant_id` filtresiyle yapılır.
CREATE TABLE IF NOT EXISTS e_invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_id TEXT,
    invoice_number TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','SENT','ACCEPTED','REJECTED','CANCELLED')),
    kdv_rate_percent INTEGER NOT NULL
        CHECK (kdv_rate_percent IN (1,10,20)),
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    kdv_cents INTEGER NOT NULL CHECK (kdv_cents >= 0),
    matrah_cents INTEGER NOT NULL CHECK (matrah_cents >= 0),
    payload TEXT,
    sent_at DATETIME,
    response TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_e_invoices_tenant ON e_invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_e_invoices_order ON e_invoices(tenant_id, order_id);

-- ============================================================================
-- FAZ 15 · GÜVENLİK SERTLEŞTİRME
-- ============================================================================

-- Giriş deneme sayacı (kaba kuvvet koruması).
--
-- `scope` kapsam anahtarıdır ve iki biçimde kurulur:
--   * `hesap:<kucuk harf kimlik>` — e-posta/kullanıcı adıyla giriş (kimlik
--     doğrulanmadan önce bilinmez, bu yüzden kapsam kimlik metnidir),
--   * `pin:<tenant_id>`          — PIN ile giriş (PIN kiracı içinde benzersizdir).
--
-- Neden `locked_until INTEGER` ve `DATETIME` değil: kilit süresi bir süre
-- hesabıdır (`now + 300`). Metin karşılaştırması saat dilimi ve biçim
-- farklarına açıktır; Unix saniyesi belirsizlik taşımaz.
--
-- Neden tablo, RAM değil: uygulama yeniden başlayınca sayaç sıfırlanıyordu.
-- Kilit yeniden başlatmayla kaybolursa kaba kuvvet koruması her yeniden
-- başlatmada bedava deneme hakkı kazandırır.
CREATE TABLE IF NOT EXISTS login_attempts (
    scope TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- PIN geçmişi: aynı PIN'in yeniden kullanılmasını engeller.
--
-- Neden gerekir: personel PIN'i unutur, eskisini geri yazar. Kısa ve tahmin
-- edilebilir bir PIN (4 hane) için son 5 PIN'i reddetmek, tahmin alanını
-- kaldırmadan unuttuğu PIN'i geri yazmasını da engeller.
--
-- `pin_hash` düz metin değil Argon2id PHC'dir: geçmiş tablosu bir kimlik
-- döküm tablosuna dönüşmemelidir.
CREATE TABLE IF NOT EXISTS pin_history (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pin_history_user ON pin_history(tenant_id, user_id);

-- Çift onay eşiği (D3).
--
-- Kapsam **tüm para çıkışları**: indirim, ikram, ödeme toplamı, kasa çıkışı
-- (`cash_out`) ve gün sonu (`close_day`). Bu yüzden tablo adı "discount"
-- değil, genel bir eşik adı taşır: kapsam sonradan genişlediğinde tablo
-- ismi yalan söylememeli.
--
-- Neden satır başına eşik: eşik sabit kod içindeydi (`LARGE_DISCOUNT_CENTS`)
-- ve işletme büyüklüğüne göre değiştirilemiyordu. "500 TL üzeri yöneticiden
-- onay ister" kuralı her kafede farklıdır.
--
-- Satır yoksa **varsayılan** kullanılır (mevcut davranış korunur); eşik
-- silinince kiracı varsayılana döner.
CREATE TABLE IF NOT EXISTS approval_thresholds (
    tenant_id TEXT PRIMARY KEY,
    amount_cents INTEGER NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (amount_cents > 0)
);

-- Oturumlar (D1).
--
-- `token_hash` jetonun **özeti**dir; jetonun kendisi hiçbir yere yazılmaz.
-- Veritabanını okuyan bir saldırgan (yedekleme, kopyalanan dosya) doğrudan
-- oturum çalma yapamaz.
--
-- `expires_at` Unix saniyesi: oturum kayıp bir cihazda sonsuza dek geçerli
-- kalmamalıdır. Vardiya günü aşmaz.
--
-- `revoked_at` satır silmek yerine işaretleme: "kim, ne zaman, hangi cihazdan
-- çıkış yaptı" denetim izi kalsın. `audit_ledger` de silmeye kapalıdır;
-- burada aynı fikir oturum kaydına da uygulanır.
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    device_label TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at INTEGER NOT NULL,
    revoked_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(tenant_id, user_id);

-- Oturum zorunluluğu anahtarı (D1).
--
-- Neden tablo: oturum doğrulaması yüksek riskli komutlara eklenir, ama arayüz
-- henüz jeton göndermez (Faz 17). Kapıyı her komutta koşulsuz açmak mevcut
-- çağrı sözleşmesini kırar ve kasayı durdurur; hiç açmamak ise güvenlik
-- sağlamaz. Bu bayrak iki durumu da adıyla saklar: işletme sahibi jeton
-- göndermeye başladığında `enforced = 1` yapar ve kapı **fail-closed** olarak
-- çalışır (jeton yoksa hata).
--
-- Varsayılan `0`: arayüz Faz 17'de jeton gönderene kadar davranış değişmez.
CREATE TABLE IF NOT EXISTS session_policies (
    tenant_id TEXT PRIMARY KEY,
    is_enforced INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (is_enforced IN (0, 1))
);

-- İki faktörlü doğrulama (D2: backend-only, kapalı).
--
-- `secret_hash` sırrın **özeti**dir, sır kalıcı olarak saklanmaz. Bu bilinçli bir
-- sınırdır: doğrulama kodu yalnız kayıt anında elde edilen sırla üretilebilir,
-- geri yükleme mümkün değildir. 2FA girişe zorunlu olmadığı için (arayüz Faz
-- 17'de) bu kabul edilebilir.
--
-- `pending_secret` bu sınırı **kayıt anında** çözer: sır yalnız ilk doğrulama
-- yapılana kadar düz metin tutulur, sonra `NULL`'lanır. Kalıcı tablo hâlinde
-- sır bulunmaz, ama kullanıcı "sırrı kaydettim" dediğinde gerçekten kod
-- girebildiği kanıtlanır. `pending_secret` dolu bir satır, 2FA'nın henüz
-- kullanıma hazır **olmadığı** anlamına gelir.
--
-- `failed_attempts`/`locked_until` 2FA'yı kaba kuvvet hedefi olmaktan
-- çıkarır: 6 haneli kod tek başına çok zayıftır, sınırsız deneme yeter.
-- Eşikler giriş kilidiyle aynı (5 deneme / 300 saniye).
CREATE TABLE IF NOT EXISTS two_factor_secrets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    pending_secret TEXT,
    label TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, user_id)
);

-- 2FA'nın gerçekten kullanılabilir olduğunun kanıtı: kullanıcı ilk kodu
-- girdikten sonra bir satır yazılır. Kayıt tek başına yeterli değildir;
-- yanlış sırla kayıt açılabilir.
CREATE TABLE IF NOT EXISTS two_factor_verifications (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, user_id)
);

-- ============================================================================
-- FAZ 16 — DIŞ AKTÖRLER (dosya tabanlı takas)
-- ============================================================================
--
-- ERİŞİM MODELİ KARARI (C-8): dış aktörler **ağa çıkmaz**.
--
-- Neden: uygulama local-first'tir — tek Tauri süreci, gömülü SQLite, sunucu
-- yoktur. AGENTS.md §3.1 harici bulutu zaten yasaklıyor. Müşteri, tedarikçi veya
-- mali müşavirin canlı bağlanabilmesi için dinleyen bir servis kurmak gerekirdi;
-- bu hem saldırı yüzeyini genişletir hem de personel dışı aktörler için ikinci
-- bir kimlik alanı (auth realm) açar. Bunun yerine takas **dosya üzerinden**
-- yapılır: QR menü statik dosya, mali müşavir/tedarikçi imzalı dışa aktarım +
-- içe aktarım, WhatsApp/e-posta kuyruk + sahte sağlayıcı.
--
-- SONUÇ: bu fazda **hiçbir yeni port açılmaz**.
--
-- Para ve bütünlük kuralları:
--   * Tutarlar `*_cents INTEGER` (AGENTS.md §2). Dış aktör JSON'u **fiyat
--     taşımaz**: `customer_orders.items` yalnız ürün kimliği + adet + not içerir,
--     fiyat sunucuda `orders`/`menu` üzerinden çözülür. Aksi halde müşteri
--     fiyatı kendisi belirler ve bu bir fiyat kayması açığı olurdu (P0-7).
--   * Her tabloda `tenant_id` zorunludur; filtrelemesiz sorgu yazılmaz.
--   * Dışa aktarılan her dosya HMAC ile imzalanır; imzasız dosya içe alınmaz.

-- 0) Dış aktör imza anahtarı.
--
-- Neden ayrı tablo: dışa aktarılan dosyalar HMAC ile imzalanır, ama anahtar
-- `tenants` içinde bir sütun değildir ve olmamalıdır — kimlik bilgisi ile
-- imza anahtarı aynı satırda durursa, biri sızarsa diğeri de düşer.
--
-- Neden `key_id`: dosya, hangi anahtarla doğrulandığını bilmeden taşınamaz.
-- `key_id`, anahtarın özetinin ilk yarısıdır; doğrulayıcı anahtarı bu bilgiyle
-- seçer, anahtarın kendisi dosyada **bulunmaz**.
--
-- Neden tek satır (anahtar döndürme satırı tutulmaz): döndürme eski imzaları
-- geçersiz kılar. Bu bilinçli bir seçimdir — müşavir elindeki dosyayı
-- doğrulayamaz hale gelirse dosyayı yeniden ister; tersi durumda eski anahtar
-- sonsuza kadar geçerli kalır ve imza güvenliği zamanla erir.
CREATE TABLE IF NOT EXISTS external_signing_keys (
    tenant_id TEXT PRIMARY KEY,
    key_hex TEXT NOT NULL,
    key_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1) Müşteri oturumu (QR menü erişimi).
--
-- Neden ayrı tablo: müşteri bir personel değildir. `users` tablosuna yazılsaydı
-- personel yetki matrisiyle karışır, şifre/PIN zorunluluğu yanlış yere biner.
-- Müşterinin kimliği **jeton**dır; jeton tabloya yalnız HMAC olarak girer.
--
-- Neden `qr_token` düz metin değil: dosya kopyasını okuyan biri (yedek, ortak
-- klasör) müşteri oturumunu doğrudan kullanmasın. `session.rs` ile aynı yaklaşım.
CREATE TABLE IF NOT EXISTS customer_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    qr_token_hash TEXT NOT NULL,
    customer_label TEXT NOT NULL DEFAULT '',
    -- Zaman damgaları saniye cinsinden epoch; `session.rs` ile aynı ölçek.
    expires_at INTEGER NOT NULL,
    revoked_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, qr_token_hash)
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_tenant
    ON customer_sessions(tenant_id, expires_at);

-- 2) Müşteri siparişi (QR menüden gelen talep).
--
-- Neden ayrı tablo, `orders` değil: dışarıdan gelen talep **onaylanmamış**dır.
-- `orders` tablosu KDS/POS akışının sahibidir ve para hareketi üretir; müşterinin
-- gönderdiği istek doğrudan oraya yazılırsa onaysız satış doğar. Buradaki satır
-- personel tarafından onaylanınca `orders`'a taşınır.
--
-- `items` JSON yalnız talebi taşır: `[{ "product_id": "...", "qty": 2, "note": "..." }]`.
-- Fiyat burada **bulunmaz**; fiyat onay anında ürün tablosundan okunur.
CREATE TABLE IF NOT EXISTS customer_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    items TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDING',
    -- Onaylandığında `orders` tablosuna yazılan gerçek sipariş kimliği.
    order_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE,
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED'))
);
CREATE INDEX IF NOT EXISTS idx_customer_orders_tenant_status
    ON customer_orders(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_orders_session
    ON customer_orders(tenant_id, session_id);

-- 3) Müşteri geri bildirimi.
--
-- Neden siparişe bağlanmaz: geri bildirim zorunlu olarak bir siparişe ait
-- olmak zorunda değildir; bağlansaydı müşteri "değerlendirdim" diyemezdi.
CREATE TABLE IF NOT EXISTS customer_feedback (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 1–5 aralığı DB'de sınırlanır: uygulama hatası 0 ya da 9 puan yazmasın.
    CHECK (rating BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS idx_customer_feedback_tenant
    ON customer_feedback(tenant_id, created_at);

-- 4) Tedarikçiye gönderilen sipariş talebi (WhatsApp kuyruğuna bağlanır).
--
-- Neden `suppliers` tablosuna FK: dış aktör tanımı zaten `inventory360/suppliers`
-- tarafından yönetiliyor; ikinci bir tedarikçi tablosu iki gerçek üretirdi.
--
-- `whatsapp_message_id` boşsa talep gönderilmemiş demektir; kuyruk kaydı
-- ayrı tablodadır ve bu alan yalnız bağlantı noktasıdır.
CREATE TABLE IF NOT EXISTS supplier_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    -- Aynı sözleşme: `[{ "product_id": "...", "qty": 10 }]`, fiyat yok.
    items TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    whatsapp_message_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    CHECK (status IN ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'CANCELLED'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_tenant_status
    ON supplier_orders(tenant_id, status, created_at);

-- 5) Mali müşavir raporu.
--
-- Neden `period`: dışa aktarım dönemseldir; raporun hangi dönemi kapsadığı
-- dosya adından tahmin edilemez.
--
-- Neden `sent_at` ayrı: dosya üretildiği an ile müşavire **ulaştığı** an farklıdır.
-- Teslim edilmediği halde "gönderildi" işaretlenmiş rapor, mali müşavirin
-- eksik dosya farkına yol açar (sessiz hata).
CREATE TABLE IF NOT EXISTS accountant_reports (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    -- Dosya kimin ürettiğini gösterir: aktarım yazılırken imzadaki etiket.
    created_by TEXT NOT NULL,
    sent_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (period_start <= period_end)
);
CREATE INDEX IF NOT EXISTS idx_accountant_reports_tenant_period
    ON accountant_reports(tenant_id, period_start, period_end);

-- 6) Teknik servis kaydı (yedek parça / arıza / bakım).
--
-- Neden `severity` ayrı alan: "bakım" ile "arıza" aynı akışta çözülemez;
-- aciliyeti bilmeden önceliklendirme yapılamaz.
CREATE TABLE IF NOT EXISTS service_tickets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'OPEN',
    -- Personel kimliği (`users.id`); yabancı teknisyen hesap değildir.
    assigned_to TEXT,
    resolved_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'RESOLVED', 'CLOSED'))
);
CREATE INDEX IF NOT EXISTS idx_service_tickets_tenant_status
    ON service_tickets(tenant_id, status, severity, created_at);

-- 7) WhatsApp gönderim kuyruğu.
--
-- Neden kuyruk ve neden sahte sağlayıcı: AGENTS.md §3.1 harici bulutu
-- yasaklıyor; gerçek Meta API çağrısı bu fazda yapılamaz. Kuyruk + sahte
-- sağlayıcı, gerçek entegrasyonun istediği durum makinesini (kuyruk → gönderim →
-- teslim) şimdiden test edilebilir kılar; Faz 17'de sağlayıcı değişir, veri
-- modeli değişmez.
--
-- Neden `provider_flag`: sahte sağlayıcı üzerinden gönderilen mesaj, gerçek
-- gönderilmiş gibi görünmemeli. Kolon "bu bir simülasyondur" bilgisini
-- saklar; müşteriye giden gerçek bir mesajın test kaydıyla karışmasını engeller.
CREATE TABLE IF NOT EXISTS whatsapp_queue (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    recipient TEXT NOT NULL,
    message TEXT NOT NULL,
    -- Bağlı olduğu talep (sağlamsa). Zorunlu değil: genel duyuru da kuyruğa girer.
    supplier_order_id TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    provider_flag TEXT NOT NULL DEFAULT 'FAKE',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_order_id) REFERENCES supplier_orders(id),
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
    CHECK (provider_flag IN ('FAKE', 'REAL'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_tenant_status
    ON whatsapp_queue(tenant_id, status, created_at);

-- 8) E-posta gönderim kuyruğu (SMTP).
--
-- Neden WhatsApp tablosuyla aynı: SMTP için ayrı bir kuyruk kuralı yazılsaydı,
-- iki kuyruk farklı hatalarda ayrışır. Aynı durum makinesi, aynı yeniden
-- deneme mantığı, tek fark taşıyıcı.
CREATE TABLE IF NOT EXISTS email_queue (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    attachment_path TEXT,
    accountant_report_id TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    provider_flag TEXT NOT NULL DEFAULT 'FAKE',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (accountant_report_id) REFERENCES accountant_reports(id),
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
    CHECK (provider_flag IN ('FAKE', 'REAL'))
);
CREATE INDEX IF NOT EXISTS idx_email_queue_tenant_status
    ON email_queue(tenant_id, status, created_at);

-- ============================================================================
-- FAZ 17 · OFFLINE / COMPENSATION — Çatışma Günlüğü ve Ters İşlemler
-- ============================================================================

-- ---------------------------------------------------------------------------
-- OFFLINE ÇATIŞMA GÜNLÜĞÜ
-- ---------------------------------------------------------------------------
-- İki terminal aynı masa / sipariş ID'sine yazarken çelişen kalemler bu tabloya
-- kaydedilir: kullanıcı müdahale edene kadar PENDING, ardından çözümleme yapılır.
--
-- Neden `tenant_id` NOT NULL: çapraz-tenant çatışma kaydı, başka bir işletmenin
-- verisine erişim hakkına dönüşür (AGENTS.md §3.3).
CREATE TABLE IF NOT EXISTS conflict_log (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    table_id            TEXT NOT NULL,
    order_id            TEXT NOT NULL,
    conflict_type       TEXT NOT NULL
        CHECK (conflict_type IN ('LINE_ITEM_DUPLICATE', 'LINE_ITEM_PRICE_MISMATCH', 'ORDER_STATUS_CONFLICT')),
    terminal_a          TEXT NOT NULL,
    terminal_b          TEXT NOT NULL,
    payload             TEXT NOT NULL CHECK (json_valid(payload)),
    status              TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RESOLVED_MERGE', 'RESOLVED_REJECT', 'AUTO_MERGED')),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at         DATETIME,
    resolved_by         TEXT,
    resolution          TEXT
);
CREATE INDEX IF NOT EXISTS idx_conflict_log_tenant
    ON conflict_log(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conflict_log_order
    ON conflict_log(tenant_id, order_id);

-- ---------------------------------------------------------------------------
-- GERİ ÖDEME / COMPENSATION KAYITLARI
-- ---------------------------------------------------------------------------
-- `refunds` tablosu, ters para hareketlerinin kalıcı izidir. `create_compensation_refund`
-- bu tabloyu yazar; aynı zamanda `audit_ledger.action = 'payment:compensation_refund'`
-- kaydı da eklenir. İki kayıt birbirini takip eder: tablo para akışı sorgulamasını
-- hızlandırır, defter zinciri bütünlüğünü korur.
--
-- Neden ayrı tablo: audit_ledger append-only'dir; REFUND'ı sorgulamak için her
-- satırı taramak malgındır. `refunds` sadece ters hareketi tutar.
CREATE TABLE IF NOT EXISTS refunds (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    original_transaction_id TEXT NOT NULL,
    original_order_id   TEXT,
    compensation_txn_id TEXT NOT NULL,
    amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
    reason              TEXT NOT NULL,
    method              TEXT NOT NULL
        CHECK (method IN ('CASH', 'CREDIT_CARD', 'BANK_TRANSFER', 'VERESIYE', 'COMPENSATION')),
    actor_id            TEXT NOT NULL,
    approval_token_hash TEXT,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (original_order_id) REFERENCES orders(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_refunds_tenant
    ON refunds(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_original_txn
    ON refunds(tenant_id, original_transaction_id);
