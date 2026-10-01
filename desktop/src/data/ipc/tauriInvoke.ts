import { invoke, InvokeArgs } from '@tauri-apps/api/core';
import { useAuthStore } from '../../presentation/store/useAuthStore';

// ---------------------------------------------------------------------------
// Tarayıcı modu: stateful mock veri (Tauri/backend olmadan çalışmak için)
// ---------------------------------------------------------------------------

export interface MockTable {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  openedAt?: string;
  waiterId?: string;
  currentTotal: number;
}

export interface MockCategory {
  id: string;
  tenant_id: string;
  name: string;
  display_order: number;
  icon?: string;
}

export interface MockProduct {
  id: string;
  tenant_id: string;
  sku: string;
  barcode?: string;
  name: string;
  price_cents: number;
  tax_rate: number;
  category_id: string;
  category?: string;
  description?: string;
  is_active: boolean;
  stock_quantity?: number;
}

export interface MockModifierOption {
  id: string;
  name: string;
  priceCents: number;
}

export interface MockModifierGroup {
  id: string;
  tenant_id: string;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  options: MockModifierOption[];
}

export interface MockStaffMember {
  id: string;
  name: string;
  role: string;
  tenant_id: string;
  pin?: string;
  email?: string;
  password?: string;
  license_key?: string;
}

export interface MockBranch {
  id: string;
  tenant_id: string;
  name: string;
  address: string | null;
  status: string;
  created_at: string;
}

export interface MockReceipt {
  id: string;
  tenant_id: string;
  table_id: string;
  total_cents: number;
  created_at: string;
  cashier_id: string | null;
}

export interface MockInventoryItem {
  id: string;
  tenant_id: string;
  name: string;
  sku: string | null;
  current_stock: number;
  unit: string;
  min_stock_alert: number | null;
}

export interface MockShift {
  id: string;
  tenant_id: string;
  cashierId: string;
  cashierName: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string | null;
  expectedAmountCents: number;
  actualAmountCents?: number | null;
  differenceCents?: number | null;
}

export interface MockTenant {
  id: string;
  name: string;
  status: string;
  modules: string[];
  created_at: string;
}

export interface MockPlan {
  id: string;
  name: string;
  monthly_price_cents: number;
  price_monthly_cents?: number;
  max_devices: number;
  max_branches?: number;
  max_users: number;
  features?: string[];
  badge?: string;
}

export interface MockSubscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  renews_at: string | null;
}

export interface MockDevice {
  id: string;
  tenant_id: string;
  name: string;
  device_type: string;
  status: string;
  last_heartbeat: string | null;
}

// ─── LOCALSTORAGE PERSIST KATMANI ───────────────────────────────────────────
const LS_PREFIX = 'kasam360_mock_';

function lsLoad<T>(key: string, defaultValue: T): T {
  try {
    if (typeof localStorage === 'undefined') return defaultValue;
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function lsSave<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // quota exceeded veya private mode — sessizce yoksay
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// 1. Masalar (Floor)
const DEFAULT_TABLES: MockTable[] = Array.from({ length: 12 }, (_, i) => ({
  id: `tbl-${String(i + 1).padStart(3, '0')}`,
  tenant_id: 'DEFAULT_TENANT',
  name: `Masa ${i + 1}`,
  status: 'AVAILABLE',
  currentTotal: 0,
}));
let mockTables: MockTable[] = lsLoad<MockTable[]>('tables', DEFAULT_TABLES);
if (mockTables.length === 0) {
  mockTables = [...DEFAULT_TABLES];
  lsSave('tables', mockTables);
}

// 2. Kategoriler
const DEFAULT_CATEGORIES: MockCategory[] = [
  { id: 'cat-001', tenant_id: 'DEFAULT_TENANT', name: 'Sıcak İçecekler', display_order: 1, icon: '☕' },
  { id: 'cat-002', tenant_id: 'DEFAULT_TENANT', name: 'Soğuk İçecekler', display_order: 2, icon: '🥤' },
  { id: 'cat-003', tenant_id: 'DEFAULT_TENANT', name: 'Yiyecekler', display_order: 3, icon: '🍽️' },
];
let mockCategories: MockCategory[] = lsLoad<MockCategory[]>('categories', DEFAULT_CATEGORIES);
if (mockCategories.length === 0) {
  mockCategories = [...DEFAULT_CATEGORIES];
  lsSave('categories', mockCategories);
}

// 3. Ürünler
const DEFAULT_PRODUCTS: MockProduct[] = [
  { id: 'prd-001', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-CAF-001', name: 'Türk Kahvesi', price_cents: 2000, tax_rate: 8.0, category_id: 'cat-001', is_active: true },
  { id: 'prd-002', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-CAF-002', name: 'Espresso', price_cents: 1800, tax_rate: 8.0, category_id: 'cat-001', is_active: true },
  { id: 'prd-003', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-CAF-003', name: 'Sütlü Kahve', price_cents: 2500, tax_rate: 8.0, category_id: 'cat-001', is_active: true },
  { id: 'prd-004', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-CAF-004', name: 'Çay', price_cents: 1200, tax_rate: 8.0, category_id: 'cat-001', is_active: true },
  { id: 'prd-005', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-ICE-001', name: 'Ayran', price_cents: 1500, tax_rate: 8.0, category_id: 'cat-002', is_active: true },
  { id: 'prd-006', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-ICE-002', name: 'Limonata', price_cents: 2200, tax_rate: 8.0, category_id: 'cat-002', is_active: true },
  { id: 'prd-007', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-ICE-003', name: 'Soğuk Çay', price_cents: 1800, tax_rate: 8.0, category_id: 'cat-002', is_active: true },
  { id: 'prd-008', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-FD-001', name: 'Sigara Böreği', price_cents: 3500, tax_rate: 10.0, category_id: 'cat-003', is_active: true },
  { id: 'prd-009', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-FD-002', name: 'Karışık Tost', price_cents: 4500, tax_rate: 10.0, category_id: 'cat-003', is_active: true },
  { id: 'prd-010', tenant_id: 'DEFAULT_TENANT', sku: 'SKU-FD-003', name: 'Gözleme', price_cents: 5000, tax_rate: 10.0, category_id: 'cat-003', is_active: true },
];
let mockProducts: MockProduct[] = lsLoad<MockProduct[]>('products', DEFAULT_PRODUCTS);
if (mockProducts.length === 0) {
  mockProducts = [...DEFAULT_PRODUCTS];
  lsSave('products', mockProducts);
}

// 4. Değiştiriciler (Modifiers)
let mockModifierGroups: MockModifierGroup[] = lsLoad<MockModifierGroup[]>('modifier_groups', []);

// 5. Masa Siparişleri (Order Items)
const mockOrderItems: Record<string, unknown[]> = lsLoad<Record<string, unknown[]>>('order_items', {});

// 6. Personel (Staff) - Master Admin and seed users preserved
const DEFAULT_STAFF: MockStaffMember[] = [
  {
    id: 'usr_master',
    name: 'Master Admin',
    role: 'MASTER',
    tenant_id: '',
    pin: '1111',
    email: 'admin@kasam360.com',
    password: 'admin123',
    license_key: 'LIC-MASTER-GLOBAL-KEY-360',
  },
  {
    id: 'usr_owner',
    name: 'Owner (Patron)',
    role: 'OWNER',
    tenant_id: 'DEFAULT_TENANT',
    pin: '2222',
    email: 'patron@kasam360.com',
    password: 'admin123',
  },
  {
    id: 'usr_manager',
    name: 'Manager (Müdür)',
    role: 'MANAGER',
    tenant_id: 'DEFAULT_TENANT',
    pin: '3333',
    email: 'mudur@kasam360.com',
    password: 'admin123',
  },
  {
    id: 'usr_cashier',
    name: 'Cashier (Kasiyer)',
    role: 'CASHIER',
    tenant_id: 'DEFAULT_TENANT',
    pin: '4444',
    email: 'kasiyer@kasam360.com',
    password: 'admin123',
  },
  {
    id: 'usr_waiter',
    name: 'Waiter (Garson)',
    role: 'WAITER',
    tenant_id: 'DEFAULT_TENANT',
    pin: '5555',
    email: 'garson@kasam360.com',
    password: 'admin123',
  },
  {
    id: 'usr_cook',
    name: 'Kitchen (Aşçı)',
    role: 'KITCHEN',
    tenant_id: 'DEFAULT_TENANT',
    pin: '6666',
    email: 'mutfak@kasam360.com',
    password: 'admin123',
  },
];
let mockStaff: MockStaffMember[] = lsLoad<MockStaffMember[]>('staff', DEFAULT_STAFF);
// Ensure all seed users exist in mockStaff
for (const seed of DEFAULT_STAFF) {
  if (!mockStaff.find((s) => s.pin === seed.pin)) {
    mockStaff.push(seed);
  }
}
lsSave('staff', mockStaff);

// Testler ve oturum sıfırlaması için mock personel listesini fabrika ayarlarına döndür
export function resetMockStaff(): void {
  mockStaff = JSON.parse(JSON.stringify(DEFAULT_STAFF));
  lsSave('staff', mockStaff);
}

// 7. Şubeler (Branches)
let mockBranches: MockBranch[] = lsLoad<MockBranch[]>('branches', []);

// 8. Fişler (Receipts)
let mockReceipts: MockReceipt[] = lsLoad<MockReceipt[]>('receipts', []);

// 9. Envanter (Inventory)
const DEFAULT_INVENTORY_ITEMS: MockInventoryItem[] = [
  { id: 'inv-001', name: 'Dana Kıyma (Et)', sku: 'RAW-ET-001', current_stock: 25.0, unit: 'Kg', min_stock_alert: 5.0, tenant_id: 'DEFAULT_TENANT' },
  { id: 'inv-002', name: 'Tam Yağlı Süt', sku: 'RAW-SUT-001', current_stock: 35.0, unit: 'Lt', min_stock_alert: 8.0, tenant_id: 'DEFAULT_TENANT' },
  { id: 'inv-003', name: 'Köy Yumurtası', sku: 'RAW-YUM-001', current_stock: 150, unit: 'Adet', min_stock_alert: 30, tenant_id: 'DEFAULT_TENANT' },
  { id: 'inv-004', name: 'Kaşar Peyniri', sku: 'RAW-PEY-001', current_stock: 12.0, unit: 'Kg', min_stock_alert: 3.0, tenant_id: 'DEFAULT_TENANT' },
  { id: 'inv-005', name: 'Kahve Çekirdeği (Espresso)', sku: 'RAW-KAH-001', current_stock: 5000, unit: 'Gram', min_stock_alert: 1000, tenant_id: 'DEFAULT_TENANT' },
];
let mockInventory: MockInventoryItem[] = lsLoad<MockInventoryItem[]>('inventory', DEFAULT_INVENTORY_ITEMS);
if (mockInventory.length === 0) {
  mockInventory = [...DEFAULT_INVENTORY_ITEMS];
  lsSave('inventory', mockInventory);
}

// 10. Platform (Tenants, Plans, Subscriptions, Devices)
let mockTenants: MockTenant[] = lsLoad<MockTenant[]>('tenants', []);

const DEFAULT_PLANS: MockPlan[] = [
  {
    id: 'plan_starter',
    name: 'Başlangıç (Starter)',
    monthly_price_cents: 49900,
    price_monthly_cents: 49900,
    max_devices: 2,
    max_branches: 1,
    max_users: 3,
    badge: 'Standart',
    features: ['Hızlı POS Satış', '2 Terminal / Cihaz', 'Temel Raporlar', 'Günlük Kasa Kapanışı'],
  },
  {
    id: 'plan_pro',
    name: 'Profesyonel (Pro)',
    monthly_price_cents: 99900,
    price_monthly_cents: 99900,
    max_devices: 5,
    max_branches: 3,
    max_users: 10,
    badge: 'Kurumsal',
    features: ['Hızlı POS & KDS Desteği', '5 Terminal / Cihaz', 'Çoklu Şube (3 Şube)', 'Gelişmiş Stok & Reçete', 'Garson Mobil El Terminali'],
  },
  {
    id: 'plan_enterprise',
    name: 'Enterprise Plus',
    monthly_price_cents: 199900,
    price_monthly_cents: 199900,
    max_devices: 20,
    max_branches: 10,
    max_users: 50,
    badge: 'Enterprise',
    features: ['Sınırsız KDS & Mutfak İstasyonları', '20 Terminal / Cihaz', '10 Şubeye Kadar Konsolide', '7/24 Öncelikli Destek & API', 'SHA-256 Denetim & Tam İzolasyon'],
  },
];
let mockPlans: MockPlan[] = lsLoad<MockPlan[]>('plans', DEFAULT_PLANS);
// Kurumsal rozet sanitizasyonu ve eksik planları tamamlama:
mockPlans = mockPlans.map((p) => {
  if (p.badge === 'Limitsiz Güç') return { ...p, badge: 'Enterprise' };
  if (p.badge === 'En Popüler') return { ...p, badge: 'Kurumsal' };
  if (p.badge === 'Temel') return { ...p, badge: 'Standart' };
  return p;
});
for (const dp of DEFAULT_PLANS) {
  if (!mockPlans.find((p) => p.id === dp.id)) {
    mockPlans.push(dp);
  }
}
lsSave('plans', mockPlans);


let mockDevices: MockDevice[] = lsLoad<MockDevice[]>('devices', []);

// 10b. Vardiyalar (Shifts)
let mockShifts: MockShift[] = lsLoad<MockShift[]>('shifts', []);

// 11. Canlı Operasyonlar ve Denetim Kayıtları
// Faz 3 (K4): onay kuyruğu (`mockPendingApprovals`) kaldırıldı. Onay artık
// anlık PIN ile alınır ve tek kullanımlık jetonla doğrulanır; kuyruk verisi
// hiçbir yerde tutulmaz.
const mockLiveOrders: Record<string, unknown>[] = lsLoad<Record<string, unknown>[]>('live_orders', []);

/**
 * Denetim kayıtları ham SHA-256 **taşımaz**: yalnızca `sealed` mührü ve
 * kategori bulunur. Hash'i backend'de kalıp burada gizlemek, iki gerçek
 * (ikinci hash zinciri) üretmemek içindir.
 */
const DEFAULT_AUDIT_LOGS: Record<string, unknown>[] = [
  {
    id: 'aud-001',
    sequence: 1,
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
    actor_id: 'Fatma Kasiyer',
    actor_role: 'CASHIER',
    category: 'FINANS',
    action: 'shift:opened',
    resource_id: 'Kasa-01 (Sabah Vardiyası)',
    payload: { shiftId: 'shf_001' },
    sealed: true,
    tenant_id: 'DEFAULT_TENANT',
  },
  {
    id: 'aud-002',
    sequence: 2,
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
    actor_id: 'Ahmet Garson',
    actor_role: 'WAITER',
    category: 'SIPARIS_MASA',
    action: 'order:submitted',
    resource_id: 'Masa 3 (Sipariş #102)',
    payload: { orderId: 'ord_102' },
    sealed: true,
    tenant_id: 'DEFAULT_TENANT',
  },
  {
    id: 'aud-003',
    sequence: 3,
    timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
    actor_id: 'Patron',
    actor_role: 'OWNER',
    category: 'MENU',
    action: 'stock:movement_in',
    resource_id: 'Dana Kıyma (Et) (+10 Kg İkmal)',
    payload: { quantity: 10, movementType: 'IN' },
    sealed: true,
    tenant_id: 'DEFAULT_TENANT',
  },
  {
    id: 'aud-004',
    sequence: 4,
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    actor_id: 'Patron',
    actor_role: 'OWNER',
    category: 'MENU',
    action: 'stock:movement_out',
    resource_id: 'Tam Yağlı Süt (-2 Lt Fire)',
    payload: { quantity: -2, movementType: 'OUT', reason: 'Bozulma' },
    sealed: true,
    tenant_id: 'DEFAULT_TENANT',
  },
  {
    id: 'aud-005',
    sequence: 5,
    timestamp: new Date(Date.now() - 3600000 * 1).toISOString(),
    actor_id: 'Mehmet Müdür',
    actor_role: 'MANAGER',
    category: 'SIPARIS_MASA',
    action: 'order:voided',
    resource_id: 'Masa 1 Adisyon İptali (ord_099)',
    payload: { orderId: 'ord_099', reason: 'Müşteri iptali' },
    sealed: true,
    tenant_id: 'DEFAULT_TENANT',
  },
  {
    id: 'aud-006',
    sequence: 6,
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    actor_id: 'Fatma Kasiyer',
    actor_role: 'CASHIER',
    category: 'FINANS',
    action: 'cash:movement_in',
    resource_id: 'Kasa-01 (Bozuk Para Girişi)',
    payload: { amountCents: 50000, movementType: 'IN' },
    sealed: true,
    tenant_id: 'DEFAULT_TENANT',
  },
  {
    id: 'aud-007',
    sequence: 7,
    timestamp: new Date(Date.now() - 900000).toISOString(),
    actor_id: 'Fatma Kasiyer',
    actor_role: 'CASHIER',
    category: 'ODEME',
    action: 'payment:settled_fifo',
    resource_id: 'txn_7781',
    payload: { transactionId: 'txn_7781', totalAmount: 4600, discountCents: 0 },
    sealed: true,
    tenant_id: 'DEFAULT_TENANT',
  },
  {
    id: 'aud-008',
    sequence: 8,
    timestamp: new Date(Date.now() - 600000).toISOString(),
    actor_id: 'Mehmet Müdür',
    actor_role: 'MANAGER',
    category: 'ODEME',
    action: 'payment:settled_fifo',
    resource_id: 'txn_7782',
    payload: { transactionId: 'txn_7782', totalAmount: 1800, discountCents: 1200 },
    sealed: true,
    tenant_id: 'DEFAULT_TENANT',
  },
  {
    id: 'aud-009',
    sequence: 9,
    timestamp: new Date(Date.now() - 300000).toISOString(),
    actor_id: 'Mehmet Müdür',
    actor_role: 'MANAGER',
    category: 'SIPARIS_MASA',
    action: 'table:move',
    resource_id: 'Masa 3 → Masa 7',
    payload: { from: 'tbl_003', to: 'tbl_007' },
    sealed: true,
    tenant_id: 'DEFAULT_TENANT',
  },
];
let mockAuditLogs: Record<string, unknown>[] = lsLoad<Record<string, unknown>[]>('audit_logs', DEFAULT_AUDIT_LOGS);
if (mockAuditLogs.length === 0) {
  mockAuditLogs = [...DEFAULT_AUDIT_LOGS];
  lsSave('audit_logs', mockAuditLogs);
}
let mockPlatformAuditLogs: Record<string, unknown>[] = [];

/** Stok yazan komutlar yalnızca işletme sahibi ve müdüre açıktır (backend ile aynı). */
function assertStockWriteRole(args: Record<string, unknown>): void {
  const role = (args.callerRole || args.caller_role) as string | undefined;
  if (!role) {
    throw new Error('UNAUTHORIZED: caller_role is required');
  }
  const normalized = role.trim().toUpperCase();
  if (normalized !== 'OWNER' && normalized !== 'MANAGER') {
    throw new Error('UNAUTHORIZED: Bu işlem için yetki yok (izin: OWNER, MANAGER).');
  }
}

interface MockAuditLogInput {
  tenantId: string;
  actorId: string;
  actorRole: string;
  category: string;
  action: string;
  resourceId: string;
  payload: Record<string, unknown>;
}

/**
 * Mock denetim kaydı ekler. Hash **üretilmez**: gerçek zinciri yalnızca backend
 * kurar, mock yalnızca kaydın istemciye giden şeklini taklit eder.
 */
function pushMockAuditLog(input: MockAuditLogInput): void {
  const nextSequence = mockAuditLogs.reduce(
    (max, row) => Math.max(max, Number(row.sequence) || 0),
    0,
  ) + 1;
  mockAuditLogs.unshift({
    id: `aud-${nextSequence}`,
    sequence: nextSequence,
    timestamp: new Date().toISOString(),
    actor_id: input.actorId,
    actor_role: input.actorRole,
    category: input.category,
    action: input.action,
    resource_id: input.resourceId,
    payload: input.payload,
    sealed: true,
    tenant_id: input.tenantId,
  });
  lsSave('audit_logs', mockAuditLogs);
}

// 12. KDS İstasyonları & Siparişleri
const mockKdsStations = [
  { id: 'Grill', name: 'Izgara / Grill' },
  { id: 'Prep', name: 'Sıcak Hazırlık & Prep' },
  { id: 'Bar', name: 'Bar & İçecek' },
  { id: 'Fryer', name: 'Kızartma / Fryer' },
  { id: 'Pizza', name: 'Pizza & Taş Fırın' },
];

let mockKdsTickets: Record<string, unknown>[] = lsLoad<Record<string, unknown>[]>('kds_tickets', []);

// 13. Cari & Finans Hub (Hesap Defteri)
export interface MockDirectory {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  phone?: string;
  email?: string;
  taxNo?: string;
  taxOffice?: string;
  address?: string;
  creditLimitCents: number;
  notes?: string;
  createdAt: string;
  balanceCents: number;
}

export interface MockDebt {
  id: string;
  tenantId: string;
  directoryId: string;
  directoryName?: string;
  type: string;
  totalAmountCents: number;
  remainingAmountCents: number;
  dueDate?: string;
  status: string;
  isCash: boolean;
  orderId?: string;
  description?: string;
  createdAt: string;
}

export interface MockExpense {
  id: string;
  tenantId: string;
  category: string;
  amountCents: number;
  paymentMethod: string;
  directoryId?: string;
  directoryName?: string;
  shiftId?: string;
  actorId: string;
  description?: string;
  expenseDate: string;
  createdAt: string;
}

const DEFAULT_DIRECTORIES: MockDirectory[] = [
  { id: 'dir_001', tenantId: 'DEFAULT_TENANT', name: 'Öz Gıda Toptan A.Ş.', type: 'SUPPLIER', phone: '0212 555 1010', creditLimitCents: 5000000, createdAt: new Date().toISOString(), balanceCents: -1250000 },
  { id: 'dir_002', tenantId: 'DEFAULT_TENANT', name: 'Ahmet Yılmaz (Masa 4 Veresiye)', type: 'CUSTOMER', phone: '0532 111 2233', creditLimitCents: 100000, createdAt: new Date().toISOString(), balanceCents: 35000 },
  { id: 'dir_003', tenantId: 'DEFAULT_TENANT', name: 'Mehmet Usta (Aşçıbaşı)', type: 'STAFF', phone: '0544 333 4455', creditLimitCents: 200000, createdAt: new Date().toISOString(), balanceCents: 0 },
  { id: 'dir_004', tenantId: 'DEFAULT_TENANT', name: 'Dükkan Sahibi (Mülk Sahibi)', type: 'FIXED_EXPENSE', phone: '0533 777 8899', creditLimitCents: 0, createdAt: new Date().toISOString(), balanceCents: 0 },
  { id: 'dir_005', tenantId: 'DEFAULT_TENANT', name: 'Eren Bey (Patron Şahsi)', type: 'OWNER_PERSONAL', phone: '0530 000 0001', creditLimitCents: 0, createdAt: new Date().toISOString(), balanceCents: 0 },
];
const mockDirectories: MockDirectory[] = lsLoad<MockDirectory[]>('directories', DEFAULT_DIRECTORIES);

const DEFAULT_DEBTS: MockDebt[] = [
  { id: 'dbt_001', tenantId: 'DEFAULT_TENANT', directoryId: 'dir_001', directoryName: 'Öz Gıda Toptan A.Ş.', type: 'TAKEN', totalAmountCents: 1250000, remainingAmountCents: 1250000, status: 'PENDING', isCash: false, description: 'Et ve Süt Ürünleri Alış Faturası', createdAt: new Date(Date.now() - 86400000 * 2).toISOString() },
  { id: 'dbt_002', tenantId: 'DEFAULT_TENANT', directoryId: 'dir_002', directoryName: 'Ahmet Yılmaz (Masa 4 Veresiye)', type: 'GIVEN', totalAmountCents: 35000, remainingAmountCents: 35000, status: 'PENDING', isCash: false, description: 'Öğle Yemeği Veresiye Adisyonu', createdAt: new Date(Date.now() - 3600000 * 4).toISOString() },
];
const mockDebts: MockDebt[] = lsLoad<MockDebt[]>('debts', DEFAULT_DEBTS);

const DEFAULT_EXPENSES: MockExpense[] = [
  { id: 'exp_001', tenantId: 'DEFAULT_TENANT', category: 'RENT', amountCents: 3500000, paymentMethod: 'BANK_TRANSFER', directoryId: 'dir_004', directoryName: 'Dükkan Sahibi (Mülk Sahibi)', actorId: 'Patron', description: 'Nisan 2026 Dükkan Kirası', expenseDate: new Date().toISOString(), createdAt: new Date().toISOString() },
  { id: 'exp_002', tenantId: 'DEFAULT_TENANT', category: 'UTILITIES', amountCents: 245000, paymentMethod: 'CREDIT_CARD', actorId: 'Müdür', description: 'Elektrik Faturası (BEDAŞ)', expenseDate: new Date().toISOString(), createdAt: new Date().toISOString() },
  { id: 'exp_003', tenantId: 'DEFAULT_TENANT', category: 'STAFF_ADVANCE', amountCents: 150000, paymentMethod: 'CASH', directoryId: 'dir_003', directoryName: 'Mehmet Usta (Aşçıbaşı)', actorId: 'Kasiyer', description: 'Haftalık Personel Avansı', expenseDate: new Date().toISOString(), createdAt: new Date().toISOString() },
];
const mockExpenses: MockExpense[] = lsLoad<MockExpense[]>('expenses', DEFAULT_EXPENSES);

function isBrowser(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return !('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window);
}

// ---------------------------------------------------------------------------
// Anlık PIN onayı — tarayıcı modu kuralları (backend ile aynı)
// ---------------------------------------------------------------------------

/**
 * Mock onay PIN'leri. Backend'de Argon2 ile doğrulanır; burada düz eşleşme
 * vardır ama **roller ve eşikler** backend ile aynıdır. Rol→PIN eşlemesi
 * kullanıcı rolleriyle (AGENTS.md §6) uyumludur.
 */
const MOCK_APPROVER_PINS: Record<string, string> = {
  '1111': 'MASTER',
  '2222': 'OWNER',
  '3333': 'MANAGER',
};

/** Her rolün kendi PIN'i: self-approval denetimi için. */
const MOCK_SELF_PIN: Record<string, string> = {
  MASTER: '1111',
  OWNER: '2222',
  MANAGER: '3333',
  CASHIER: '4444',
  WAITER: '5555',
  KITCHEN: '6666',
};

function mockResolveApproverRole(pin: string): string | null {
  return MOCK_APPROVER_PINS[pin] ?? null;
}

// Onay defteri ve deneme sayacı modül düzeyinde tutulur. `localStorage` yalnız
// ek dayanıklılıktır: test ortamında (jsdom'suz node) `localStorage` yoktur ve
// yalnız ona yazmak mock kurallarını sessizce devre dışı bırakırdı.
interface MockApprovalRecord {
  id: string;
  operation: string;
  resourceId: unknown;
  actorId: unknown;
  amountCents: unknown;
  approverRole: string;
  token: string;
  consumedAt: string | null;
  expiresAt: number;
}

let mockApprovalLedger: MockApprovalRecord[] = [];
let mockApprovalAttempts: Record<string, number> = {};

function bumpApprovalAttempts(scopeKey: string, current: number): void {
  mockApprovalAttempts[scopeKey] = current + 1;
  lsSave('approval_attempts', mockApprovalAttempts);
}

/** Ödeme payload'ında sunucu tarafında indirim üretecek bir alan var mı? */
function hasMockDiscount(payload: Record<string, unknown>): boolean {
  const globalDiscount = payload.globalDiscount as Record<string, unknown> | undefined;
  if (globalDiscount && Number(globalDiscount.value ?? 0) > 0) return true;
  const items = (payload.items as Record<string, unknown>[]) || [];
  return items.some((item) => {
    const discount = item.discount as Record<string, unknown> | undefined;
    return Boolean(discount && Number(discount.value ?? 0) > 0);
  });
}

/** Mock yüzeyi backend ile aynı: %100 indirim ikramdır, iptal kendi yüzeyidir. */
function operationForMockApproval(
  cmd: string,
  payload: Record<string, unknown>,
): string {
  if (cmd === 'void_order') return 'VOID_ORDER';
  const items = (payload.items as Record<string, unknown>[]) || [];
  const globalDiscount = payload.globalDiscount as Record<string, unknown> | undefined;
  const discountValues = items
    .map((item) => Number(((item.discount as Record<string, unknown>) || {}).value ?? 0))
    .concat(globalDiscount ? [Number(globalDiscount.value ?? 0)] : []);
  const total = Number(payload.totalAmount ?? 0);
  const hasDiscount = discountValues.some((value) => value > 0);
  if (!hasDiscount) return '';
  return total <= 0 ? 'COMPLIMENTARY' : 'DISCOUNT';
}

/**
 * Onay jetonunu tek kullanımlık olarak tüketir. Kapsam denetimi backend ile
 * aynı alanları karşılaştırır: yüzey, kaynak ve süre.
 *
 * Backend'in hata ayrımı korunur: "jeton yok" ile "jeton geçersiz/kullanılmış"
 * farklı kodlarla döner. Arayüz bu ayrımı kullanıcıya farklı metin gösterir.
 */
function consumeMockApproval(
  token: string,
  payload: Record<string, unknown>,
  expectedOperation: string,
): { ok: true } | { ok: false; code: string } {
  if (!expectedOperation) return { ok: true };
  if (!token) return { ok: false, code: 'APPROVAL_REQUIRED' };

  const record = mockApprovalLedger.find((item) => item.token === token);
  if (!record) return { ok: false, code: 'APPROVAL_TOKEN_INVALID' };
  if (record.consumedAt) return { ok: false, code: 'APPROVAL_TOKEN_USED' };
  if (record.expiresAt < Date.now()) return { ok: false, code: 'APPROVAL_TOKEN_EXPIRED' };
  if (record.operation !== expectedOperation) {
    return { ok: false, code: 'APPROVAL_TOKEN_SCOPE_MISMATCH' };
  }
  if (record.resourceId !== payload.orderId && record.resourceId !== payload.transactionId) {
    return { ok: false, code: 'APPROVAL_TOKEN_SCOPE_MISMATCH' };
  }

  record.consumedAt = new Date().toISOString();
  lsSave('approvals', mockApprovalLedger);
  return { ok: true };
}

function browserMock<T>(cmd: string, args: Record<string, unknown>): T {
  console.warn(`[Tarayıcı Modu] tauriInvoke mock: ${cmd}`, args);

  const callerTenantId = (args.tenant_id || args.tenantId || '') as string;
  const callerRole = ((args.actor_role || args.actorRole || args.callerRole || args.caller_role || '') as string).toUpperCase();
  const isMaster = callerRole === 'MASTER' || callerRole === 'SUPERADMIN';
  const matchesTenant = (itemTenantId: string | undefined | null): boolean => {
    if (isMaster) return true;
    if (!callerTenantId) return true;
    return itemTenantId === callerTenantId || !itemTenantId;
  };

  if (cmd === 'auth_login_credentials') {
    const rawEmail = (args.email || args.identifier || '') as string;
    const rawPassword = (args.password || args.secret || '') as string;
    const licenseKey = ((args.license_key || args.licenseKey || '') as string).trim();
    const identifier = rawEmail.trim().toLowerCase();
    const secret = rawPassword.trim();

    // ── Yol 1: Lisans Anahtarı ile giriş (email+şifre+licenseKey veya sadece licenseKey) ──
    if (licenseKey) {
      // Lisans anahtarını doğrula
      const licKeyMatch = mockStaff.find(
        (s) => s.license_key && s.license_key.trim() === licenseKey
      );
      if (!licKeyMatch) {
        throw new Error('Geçersiz lisans anahtarı! Lütfen Master Admin ile iletişime geçin.');
      }

      // Hem email hem licenseKey varsa → her ikisini de doğrula
      if (identifier) {
        const passOk = secret.length >= 3;
        const fullMatch = mockStaff.find((s) => {
          const emailMatches = s.email && s.email.trim().toLowerCase() === identifier;
          const nameMatches = s.name.toLowerCase().replace(/\s+/g, '') === identifier.replace(/\s+/g, '');
          const idMatches = s.id.toLowerCase() === identifier;
          const credMatch = emailMatches || nameMatches || idMatches;
          if (!credMatch) return false;
          const keyMatch = s.license_key && s.license_key.trim() === licenseKey;
          if (!keyMatch) return false;
          if (!passOk) return false;
          if (s.password && s.password.trim() === secret) return true;
          if (s.pin && s.pin === secret) return true;
          return false;
        });
        if (fullMatch) {
          const branch = mockBranches.find((b) => b.tenant_id === fullMatch.tenant_id);
          return {
            id: fullMatch.id,
            role: fullMatch.role,
            name: fullMatch.name,
            tenant_id: fullMatch.tenant_id,
            branch_id: branch?.id || '',
            branch_name: branch?.name || '',
            email: fullMatch.email || `${fullMatch.id}@kasam360.com`,
            license_key: fullMatch.license_key || '',
            token: `mock_jwt_${fullMatch.id}_${Date.now()}`,
          } as unknown as T;
        }
        throw new Error('E-posta, şifre veya lisans anahtarı eşleşmiyor!');
      }

      // Sadece licenseKey ile giriş (email girilmemişse) → License Key sahibini döndür
      const branch = mockBranches.find((b) => b.tenant_id === licKeyMatch.tenant_id);
      return {
        id: licKeyMatch.id,
        role: licKeyMatch.role,
        name: licKeyMatch.name,
        tenant_id: licKeyMatch.tenant_id,
        branch_id: branch?.id || '',
        branch_name: branch?.name || '',
        email: licKeyMatch.email || `${licKeyMatch.id}@kasam360.com`,
        license_key: licKeyMatch.license_key || '',
        token: `mock_jwt_${licKeyMatch.id}_${Date.now()}`,
      } as unknown as T;
    }

    // ── Yol 2: E-posta + Şifre ile standart giriş ──
    if (!identifier) {
      throw new Error('E-posta boş olamaz.');
    }
    if (!secret || secret.length < 3) {
      throw new Error('Şifre en az 3 karakter olmalıdır.');
    }

    const staffMatch = mockStaff.find((s) => {
      const emailMatches = s.email && s.email.trim().toLowerCase() === identifier;
      const nameMatches = s.name.toLowerCase().replace(/\s+/g, '') === identifier.replace(/\s+/g, '');
      const idMatches = s.id.toLowerCase() === identifier;
      const credMatch = emailMatches || nameMatches || idMatches;
      if (!credMatch) return false;

      // Şifre veya PIN eşleştir
      if (s.password && s.password.trim() === secret) return true;
      if (s.pin && s.pin === secret) return true;
      return false;
    });

    if (staffMatch) {
      const branch = mockBranches.find((b) => b.tenant_id === staffMatch.tenant_id);
      return {
        id: staffMatch.id,
        role: staffMatch.role,
        name: staffMatch.name,
        tenant_id: staffMatch.tenant_id,
        branch_id: branch?.id || '',
        branch_name: branch?.name || '',
        email: staffMatch.email || `${staffMatch.id}@kasam360.com`,
        license_key: staffMatch.license_key || '',
        token: `mock_jwt_${staffMatch.id}_${Date.now()}`,
      } as unknown as T;
    }

    throw new Error('Geçersiz e-posta veya şifre! Bilgilerinizi kontrol edin.');
  }

  // ----- KİMLİK DOĞRULAMA (Auth) -----
  if (cmd === 'auth_login') {
    const pin = (args.pin as string) || '';
    const targetTenantId = (args.tenant_id || args.tenantId || callerTenantId || '') as string;

    if (pin === '1111') {
      return {
        id: 'usr_master',
        pin: '1111',
        role: 'MASTER',
        name: 'Master Admin',
        tenant_id: targetTenantId || '',
        branch_id: '',
        branch_name: '',
      } as unknown as T;
    }

    // 1. Öncelik: Eğer terminal bir işletmeye kayıtlıysa, öncelikle o işletmenin personelini eşleştir
    let staffMember = targetTenantId
      ? mockStaff.find((s) => s.pin === pin && (s.tenant_id === targetTenantId || s.role === 'MASTER'))
      : undefined;

    // 2. Öncelik: Bulunamazsa genel PIN eşleşmesini ara
    if (!staffMember) {
      staffMember = mockStaff.find((s) => s.pin === pin);
    }

    if (staffMember) {
      const branch = mockBranches.find((b) => b.tenant_id === staffMember.tenant_id) || mockBranches[0];
      return {
        id: staffMember.id,
        pin: pin,
        role: staffMember.role,
        name: staffMember.name,
        tenant_id: staffMember.tenant_id,
        branch_id: branch?.id || 'branch_main',
        branch_name: branch?.name || 'Kadıköy Merkez Şube',
      } as unknown as T;
    }

    throw new Error('Geçersiz PIN');
  }

  // ----- SALON (Floor) -----
  if (cmd === 'get_floor_plan') {
    return mockTables.filter((t) => matchesTenant(t.tenant_id)) as unknown as T;
  }
  if (cmd === 'add_table') {
    const tableTenantId = (args.tenantId || args.tenant_id || callerTenantId || '') as string;
    const newTable: MockTable = {
      id: (args.id as string) || `tbl-${Date.now().toString().slice(-4)}`,
      tenant_id: tableTenantId,
      name: (args.name as string) || 'Yeni Masa',
      status: 'AVAILABLE',
      currentTotal: 0,
    };
    mockTables = [...mockTables, newTable];
    lsSave('tables', mockTables);
    return mockTables.filter((t) => matchesTenant(t.tenant_id)) as unknown as T;
  }
  if (cmd === 'remove_table') {
    mockTables = mockTables.filter((t) => t.id !== args.id);
    delete mockOrderItems[args.id as string];
    lsSave('tables', mockTables);
    lsSave('order_items', mockOrderItems);
    return mockTables.filter((t) => matchesTenant(t.tenant_id)) as unknown as T;
  }
  if (cmd === 'update_table_name') {
    mockTables = mockTables.map((t) =>
      t.id === args.id ? { ...t, name: args.name as string } : t
    );
    lsSave('tables', mockTables);
    return mockTables.filter((t) => matchesTenant(t.tenant_id)) as unknown as T;
  }
  if (cmd === 'update_table_status') {
    const tableId = (args.tableId || args.table_id) as string;
    const status = args.status as string;
    mockTables = mockTables.map((t) =>
      t.id === tableId ? { ...t, status } : t
    );
    lsSave('tables', mockTables);
    return { success: true } as unknown as T;
  }
  if (cmd === 'move_table') {
    const fromId = args.fromId as string;
    const toId = args.toId as string;
    const fromTable = mockTables.find((t) => t.id === fromId);
    const toTable = mockTables.find((t) => t.id === toId);
    if (fromTable && toTable) {
      toTable.currentTotal = fromTable.currentTotal;
      toTable.status = 'OCCUPIED';
      fromTable.currentTotal = 0;
      fromTable.status = 'AVAILABLE';
      if (mockOrderItems[fromId]) {
        mockOrderItems[toId] = mockOrderItems[fromId];
        delete mockOrderItems[fromId];
      }
    }
    lsSave('tables', mockTables);
    lsSave('order_items', mockOrderItems);
    return mockTables.filter((t) => matchesTenant(t.tenant_id)) as unknown as T;
  }
  if (cmd === 'merge_tables') {
    const sourceId = (args.sourceTableId || args.source_table_id || args.sourceId) as string;
    const targetId = (args.targetTableId || args.target_table_id || args.targetId) as string;
    const sourceTable = mockTables.find((t) => t.id === sourceId);
    const targetTable = mockTables.find((t) => t.id === targetId);
    if (sourceTable && targetTable) {
      const sourceTotal = (sourceTable.currentTotal as number) || 0;
      const targetTotal = (targetTable.currentTotal as number) || 0;
      targetTable.currentTotal = targetTotal + sourceTotal;
      targetTable.status = 'OCCUPIED';
      sourceTable.currentTotal = 0;
      sourceTable.status = 'AVAILABLE';
      if (mockOrderItems[sourceId]) {
        mockOrderItems[targetId] = [...(mockOrderItems[targetId] || []), ...mockOrderItems[sourceId]];
        delete mockOrderItems[sourceId];
      }
    }
    lsSave('tables', mockTables);
    lsSave('order_items', mockOrderItems);
    return { success: true } as unknown as T;
  }
  if (cmd === 'reserve_table') {
    mockTables = mockTables.map((t) =>
      t.id === args.tableId ? { ...t, status: 'RESERVED' } : t
    );
    lsSave('tables', mockTables);
    return mockTables.filter((t) => matchesTenant(t.tenant_id)) as unknown as T;
  }
  if (cmd === 'get_table_ready_status') {
    return 'Ready' as unknown as T;
  }
  if (cmd === 'waiter_clock_in') {
    return { success: true } as unknown as T;
  }

  // ----- SİPARİŞ (Order / POS) -----
  if (cmd === 'pos_get_categories') {
    return mockCategories.filter((c) => matchesTenant(c.tenant_id)) as unknown as T;
  }
  if (cmd === 'pos_get_products') {
    return mockProducts.filter((p) => matchesTenant(p.tenant_id)) as unknown as T;
  }
  if (cmd === 'get_product_modifiers') {
    return mockModifierGroups.filter((g) => matchesTenant(g.tenant_id)) as unknown as T;
  }
  if (cmd === 'get_order_items') {
    return (mockOrderItems[args.tableId as string] || []) as unknown as T;
  }
  if (cmd === 'submit_order') {
    const payload = (args.payload || {}) as Record<string, unknown>;
    const rawTableId = (payload.tableId || args.tableId) as string | undefined;
    const items = (payload.items || args.items || []) as Record<string, unknown>[];
    const orderTenantId = (args.tenantId || args.tenant_id || payload.tenantId || payload.tenant_id || callerTenantId || '') as string;
    const isQuickSale = !rawTableId || rawTableId === 'PAKET' || rawTableId === 'HIZLI_SATIS' || rawTableId === 'null';
    
    const total = items.reduce(
      (acc, it) => acc + (Number(it.total) || Number(it.unitPrice) * Number(it.quantity) || 0),
      0
    );
    const orderId = `ord_${Date.now()}`;
    let tableName = 'Hızlı Satış / Paket';

    if (!isQuickSale && rawTableId) {
      mockOrderItems[rawTableId] = items;
      const targetTable = mockTables.find((t) => t.id === rawTableId);
      if (targetTable) {
        tableName = targetTable.name;
        mockTables = mockTables.map((t) =>
          t.id === rawTableId ? { ...t, status: 'OCCUPIED', currentTotal: total } : t
        );
      } else {
        tableName = rawTableId;
      }
      lsSave('tables', mockTables);
      lsSave('order_items', mockOrderItems);
    }

    mockLiveOrders.unshift({
      id: orderId,
      tenant_id: orderTenantId,
      table_name: tableName,
      status: 'IN_PROGRESS',
      total_cents: total,
      created_at: new Date().toISOString(),
      item_count: items.length,
    });

    mockKdsTickets.unshift({
      id: `kds_${orderId}`,
      tenant_id: orderTenantId,
      orderNumber: `ORD-${Date.now().toString().slice(-4)}`,
      tableNumber: tableName,
      status: 'Pending',
      createdAt: new Date().toISOString(),
      priority: 'NORMAL',
      items: items.map((it, idx) => {
        const prod = it.product as Record<string, unknown> | undefined;
        const name = (prod?.name as string) || (it.name as string) || 'Ürün';
        return {
          id: `kds_it_${idx}_${Date.now()}`,
          name,
          quantity: Number(it.quantity) || 1,
          station: 'Prep',
          complexityWeight: 1.0,
          status: 'Pending',
          notes: (it.note as string) || '',
        };
      }),
    });
    lsSave('live_orders', mockLiveOrders);
    lsSave('kds_tickets', mockKdsTickets);

    return true as unknown as T;
  }
  // ----- Anlık PIN onayı: tarayıcı modunda gerçek kurallar uygulanır -----
  //
  // Neden mock rastgele başarılı dönmez: mock, backend'in reddettiği bir durumu
  // kabul ederse tarayıcı modunda denen bir akış üretimde kırılır. Buradaki
  // üç kural backend ile aynıdır: kasa onaylayamaz, kendi işlemini onaylayan
  // onaylayamaz, hatalı PIN sayacı tükenince terminal kilitlenir.
  if (cmd === 'verify_manager_pin') {
    const payload = (args.payload as Record<string, unknown>) || {};
    const actorId = String(payload.actorId || '');
    const actorRole = String(payload.actorRole || '').toUpperCase();
    const operation = String(payload.operation || '');
    const pin = String(payload.pin || '');
    const scopeKey = `approval_attempts:${String(payload.tenantId || callerTenantId)}:${String(payload.terminalId || 'terminal_unknown')}:${operation}`;

    const attempts = mockApprovalAttempts[scopeKey] ?? 0;

    if (attempts >= 5) {
      throw `APPROVAL_LOCKED: Çok sayıda hatalı deneme. Terminal 300 saniye kilitli.`;
    }
    if (!/^\d{4,8}$/.test(pin)) {
      bumpApprovalAttempts(scopeKey, attempts);
      throw 'INVALID_APPROVAL_PIN: Onay PIN\'i hatalı.';
    }

    // Onaylayan rolleri backend ile aynı: MASTER, OWNER, MANAGER.
    // Büyük indirim ve ikram yüzeylerinde MASTER da dışlanır.
    const approverRole = mockResolveApproverRole(pin);
    if (!approverRole) {
      bumpApprovalAttempts(scopeKey, attempts);
      throw 'INVALID_APPROVAL_PIN: Onay PIN\'i hatalı.';
    }
    const privileged =
      operation === 'COMPLIMENTARY' ||
      operation === 'DISCOUNT' &&
        (Number(payload.discountPercent ?? 0) >= 20 ||
          Number(payload.amountCents ?? 0) >= 50000);
    if (privileged && approverRole !== 'OWNER' && approverRole !== 'MANAGER') {
      bumpApprovalAttempts(scopeKey, attempts);
      throw 'UNAUTHORIZED: Bu rol onay veremez (izin: MASTER, OWNER, MANAGER).';
    }
    if (approverRole === actorRole || pin === MOCK_SELF_PIN[actorRole]) {
      throw 'SELF_APPROVAL_FORBIDDEN: Onaylayan kişi işlemi yapan kişi olamaz.';
    }

    const token = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    mockApprovalLedger.push({
      id: `apr_${Date.now()}`,
      operation,
      resourceId: payload.resourceId,
      actorId,
      amountCents: payload.amountCents,
      approverRole,
      token,
      consumedAt: null,
      expiresAt: Date.now() + 30000,
    });
    lsSave('approvals', mockApprovalLedger);

    return {
      approved: true,
      approvalToken: token,
      approverId: `mock_${approverRole}`,
      approverName: approverRole,
      approverRole,
      resourceId: payload.resourceId,
      operation,
      remainingAttempts: 5,
    } as unknown as T;
  }

  if (
    cmd === 'process_payment' ||
    cmd === 'process_split_payment' ||
    cmd === 'void_order'
  ) {
    const payload = (args.payload as Record<string, unknown>) || {};
    // Onay zorunluluğu mock'ta da uygulanır: indirimli ödeme ve iptal
    // geçerli, tüketilmemiş bir onay jetonu olmadan ilerlemez.
    if (cmd === 'void_order' || hasMockDiscount(payload)) {
      const token = String(payload.approvalToken || '');
      const outcome = consumeMockApproval(
        token,
        payload,
        operationForMockApproval(cmd, payload),
      );
      if (!outcome.ok) {
        throw `${outcome.code}: Bu işlem için onay PIN'i gerekli.`;
      }
    }
    const tableId = (args.tableId || payload.customerRef || payload.tableId) as string;
    const totalAmount = Number(payload.totalAmount) || 0;
    const paymentTenantId = (args.tenantId || args.tenant_id || payload.tenantId || payload.tenant_id || callerTenantId || '') as string;

    if (tableId) {
      mockTables = mockTables.map((t) =>
        t.id === tableId ? { ...t, status: 'AVAILABLE', currentTotal: 0 } : t
      );
      delete mockOrderItems[tableId];
      lsSave('tables', mockTables);
      lsSave('order_items', mockOrderItems);
    }

    const receiptId = (payload.transactionId as string) || `RC-${Date.now()}`;
    const cashierUser = mockStaff.find(s => s.id === (payload.cashierId as string));
    const authUser = useAuthStore.getState().user;
    const cashierDisplayName = cashierUser?.name || (payload.cashierId as string) || authUser?.name || 'Kasiyer';

    mockReceipts = [
      {
        id: receiptId,
        tenant_id: paymentTenantId,
        table_id: tableId || 'Hızlı Satış',
        total_cents: totalAmount,
        created_at: new Date().toISOString(),
        cashier_id: cashierDisplayName,
      },
      ...mockReceipts,
    ];
    lsSave('receipts', mockReceipts);

    if (cmd === 'void_order') {
      return true as unknown as T;
    }

    return {
      success: true,
      transactionId: receiptId,
      timestamp: new Date().toISOString(),
      message: 'Tarayıcı modunda işlem başarılı.',
    } as unknown as T;
  }
  if (cmd === 'print_receipt') {
    return { success: true, message: 'Yazıcıya başarıyla gönderildi.' } as unknown as T;
  }

  // ----- MENÜ YÖNETİMİ (Menu Management) -----
  if (cmd === 'get_management_categories') {
    return mockCategories
      .filter((c) => matchesTenant(c.tenant_id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        display_order: c.display_order,
      })) as unknown as T;
  }
  if (cmd === 'create_category') {
    const catTenantId = (args.tenantId || args.tenant_id || callerTenantId || '') as string;
    const newCat: MockCategory = {
      id: (args.id as string) || `cat-${Date.now().toString().slice(-4)}`,
      tenant_id: catTenantId,
      name: (args.name as string) || 'Yeni Kategori',
      display_order: mockCategories.length + 1,
      icon: '📁',
    };
    mockCategories = [...mockCategories, newCat];
    lsSave('categories', mockCategories);
    return newCat as unknown as T;
  }
  if (cmd === 'update_category') {
    mockCategories = mockCategories.map((c) =>
      c.id === args.id ? { ...c, name: (args.name as string) || c.name } : c
    );
    lsSave('categories', mockCategories);
    return { success: true } as unknown as T;
  }
  if (cmd === 'delete_category') {
    mockCategories = mockCategories.filter((c) => c.id !== args.id);
    lsSave('categories', mockCategories);
    return { success: true } as unknown as T;
  }
  if (cmd === 'get_management_products') {
    return mockProducts
      .filter((p) => matchesTenant(p.tenant_id))
      .map((p) => ({
        id: p.id,
        category_id: p.category_id,
        name: p.name,
        price_cents: p.price_cents,
        is_active: p.is_active,
      })) as unknown as T;
  }
  if (cmd === 'create_product') {
    const prodTenantId = (args.tenantId || args.tenant_id || callerTenantId || '') as string;
    let priceCents = 0;
    if (args.priceCents !== undefined || args.price_cents !== undefined) {
      priceCents = Math.round(Number(args.priceCents ?? args.price_cents));
    } else if (args.price !== undefined) {
      priceCents = Math.round(Number(args.price) * 100);
    }

    const newProd: MockProduct = {
      id: (args.id as string) || `prd-${Date.now().toString().slice(-4)}`,
      tenant_id: prodTenantId,
      sku: `SKU-${Date.now().toString().slice(-4)}`,
      barcode: undefined,
      name: (args.name as string) || 'Yeni Ürün',
      price_cents: priceCents,
      tax_rate: 10,
      category_id: (args.categoryId || args.category_id || mockCategories[0]?.id || 'cat-001') as string,
      category: (args.categoryId || args.category_id || mockCategories[0]?.id || 'cat-001') as string,
      description: '',
      is_active: true,
      stock_quantity: 100,
    };
    mockProducts = [...mockProducts, newProd];
    lsSave('products', mockProducts);
    return newProd as unknown as T;
  }
  if (cmd === 'update_product') {
    let updatePriceCents: number | undefined = undefined;
    if (args.priceCents !== undefined || args.price_cents !== undefined) {
      updatePriceCents = Math.round(Number(args.priceCents ?? args.price_cents));
    } else if (args.price !== undefined) {
      updatePriceCents = Math.round(Number(args.price) * 100);
    }

    mockProducts = mockProducts.map((p) =>
      p.id === args.id
        ? {
            ...p,
            name: args.name !== undefined ? (args.name as string) : p.name,
            price_cents: updatePriceCents !== undefined ? updatePriceCents : p.price_cents,
            category_id: args.categoryId !== undefined ? (args.categoryId as string) : p.category_id,
            category: args.categoryId !== undefined ? (args.categoryId as string) : p.category,
            is_active: args.isActive !== undefined ? Boolean(args.isActive) : p.is_active,
          }
        : p
    );
    lsSave('products', mockProducts);
    return { success: true } as unknown as T;
  }
  if (cmd === 'update_product_status') {
    const id = args.id as string;
    const isActive = args.isActive !== undefined ? Boolean(args.isActive) : Boolean(args.is_active);
    mockProducts = mockProducts.map((p) =>
      p.id === id ? { ...p, is_active: isActive } : p
    );
    lsSave('products', mockProducts);
    return { success: true } as unknown as T;
  }
  if (cmd === 'delete_product') {
    mockProducts = mockProducts.filter((p) => p.id !== args.id);
    lsSave('products', mockProducts);
    return { success: true } as unknown as T;
  }

  // ----- MODIFIER GRUPLARI (Owner Modifiers) -----
  if (cmd === 'get_modifier_groups') {
    return mockModifierGroups.filter((g) => matchesTenant(g.tenant_id)) as unknown as T;
  }
  if (cmd === 'create_modifier_group') {
    const modTenantId = (args.tenantId || args.tenant_id || callerTenantId || '') as string;
    const newGrp: MockModifierGroup = {
      id: `grp-${Date.now().toString().slice(-4)}`,
      tenant_id: modTenantId,
      name: (args.name as string) || 'Yeni Grup',
      isRequired: Boolean(args.isRequired),
      minSelections: Number(args.minSelections) || 0,
      maxSelections: args.maxSelections ? Number(args.maxSelections) : null,
      options: [],
    };
    mockModifierGroups = [...mockModifierGroups, newGrp];
    lsSave('modifier_groups', mockModifierGroups);
    return newGrp as unknown as T;
  }
  if (cmd === 'add_modifier_option') {
    const groupId = (args.groupId || args.group_id) as string;
    let optionPriceCents = 0;
    if (args.priceCents !== undefined || args.price_cents !== undefined) {
      optionPriceCents = Math.round(Number(args.priceCents ?? args.price_cents));
    } else if (args.price !== undefined) {
      optionPriceCents = Math.round(Number(args.price) * 100);
    }
    const newOpt: MockModifierOption = {
      id: `opt-${Date.now().toString().slice(-4)}`,
      name: (args.name as string) || 'Yeni Seçenek',
      priceCents: optionPriceCents,
    };
    mockModifierGroups = mockModifierGroups.map((g) =>
      g.id === groupId ? { ...g, options: [...g.options, newOpt] } : g
    );
    lsSave('modifier_groups', mockModifierGroups);
    return newOpt as unknown as T;
  }
  if (cmd === 'delete_modifier_group') {
    const id = (args.groupId || args.id) as string;
    mockModifierGroups = mockModifierGroups.filter((g) => g.id !== id);
    lsSave('modifier_groups', mockModifierGroups);
    return { success: true } as unknown as T;
  }

  // ----- PERSONEL & ŞUBELER → aşağıda tanımlı (duplicate bloklar kaldırıldı) -----

  // ----- PERSONEL (Staff) -----
  if (cmd === 'get_staff') {
    return mockStaff.filter((s) => isMaster || !callerTenantId || s.tenant_id === callerTenantId || s.tenant_id === '') as unknown as T;
  }
    if (cmd === 'create_staff_member') {
      const tenantId = (args.tenantId || args.tenant_id || callerTenantId || '') as string;

    const pin = (args.pin || args.pin_code || String(Math.floor(1000 + Math.random() * 8999))) as string;

    // PIN format doğrulama: 4-8 haneli sayısal
    if (!/^\d{4,8}$/.test(pin)) {
      throw new Error('PIN 4-8 haneli sayısal olmalıdır.');
    }
    // PIN çakışma kontrolü — aynı tenant içinde
    const pinConflict = mockStaff.find(
      (s) => s.pin === pin && (s.tenant_id === tenantId || s.role === 'MASTER')
    );
    if (pinConflict) {
      throw new Error(`Bu PIN zaten kullanımda: ${pinConflict.name}. Farklı bir PIN seçin.`);
    }

    const name = (args.name as string) || 'Yeni Personel';
    const email = (args.email as string) || `${name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'staff'}_${Date.now().toString().slice(-4)}@kasam360.com`;
    const password = (args.password as string) || `Pass${pin}!`;
    const licenseKey = (args.licenseKey || args.license_key || `LIC-STAFF-${Date.now().toString().slice(-6)}`) as string;

    const newStaff: MockStaffMember = {
      id: `usr_${Date.now().toString().slice(-4)}`,
      name,
      role: (args.role as string) || 'WAITER',
      tenant_id: tenantId,
      pin,
      email,
      password,
      license_key: licenseKey,
    };
    mockStaff = [...mockStaff, newStaff];
    lsSave('staff', mockStaff);
    return newStaff as unknown as T;
  }
  if (cmd === 'delete_staff_member') {
    const id = (args.staffId || args.id) as string;
    if (id === 'usr_master') {
      throw new Error('UNAUTHORIZED: Master Admin hesabı silinemez.');
    }
    mockStaff = mockStaff.filter((s) => s.id !== id);
    lsSave('staff', mockStaff);
    return { success: true } as unknown as T;
  }

  // ----- ŞUBELER (Branches) -----
  if (cmd === 'get_branches') {
    return mockBranches.filter((b) => matchesTenant(b.tenant_id)) as unknown as T;
  }
  if (cmd === 'create_branch') {
    const newBranch: MockBranch = {
      id: `branch_${Date.now().toString().slice(-4)}`,
      tenant_id: (args.tenantId || args.tenant_id || callerTenantId || '') as string,
      name: (args.name as string) || 'Yeni Şube',
      address: (args.address as string) || null,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    };
    mockBranches = [...mockBranches, newBranch];
    lsSave('branches', mockBranches);
    return newBranch as unknown as T;
  }

  // ----- STOK & ENVANTER (Inventory) -----
  if (cmd === 'get_inventory' || cmd === 'get_inventory_items') {
    return mockInventory.filter((item) => matchesTenant(item.tenant_id)) as unknown as T;
  }
  if (cmd === 'get_low_stock_alerts') {
    return mockInventory.filter(
      (item) => matchesTenant(item.tenant_id) && item.min_stock_alert !== null && item.current_stock <= (item.min_stock_alert || 0)
    ) as unknown as T;
  }
  if (cmd === 'create_inventory_item') {
    assertStockWriteRole(args);
    const invTenantId = (args.tenantId || args.tenant_id || callerTenantId || '') as string;
    const newItem: MockInventoryItem = {
      id: `inv_${Date.now().toString().slice(-4)}`,
      tenant_id: invTenantId,
      name: (args.name as string) || 'Yeni Stok Kalemi',
      sku: (args.sku as string) || null,
      current_stock: Number(args.initialStock || args.initial_stock || 0),
      unit: (args.unit as string) || 'Adet',
      min_stock_alert: args.minStockAlert ? Number(args.minStockAlert) : null,
    };
    mockInventory = [...mockInventory, newItem];
    lsSave('inventory', mockInventory);
    pushMockAuditLog({
      tenantId: invTenantId,
      actorId: (args.actorId || args.actor_id || 'Sistem') as string,
      actorRole: (args.callerRole || args.caller_role || 'OWNER') as string,
      category: 'MENU',
      action: 'stock:created',
      resourceId: newItem.id,
      payload: { name: newItem.name, sku: newItem.sku, unit: newItem.unit },
    });
    return newItem as unknown as T;
  }
  if (cmd === 'adjust_stock') {
    assertStockWriteRole(args);
    // Hem camelCase hem snake_case parametreleri destekle
    const id = (args.inventoryItemId || args.itemId || args.item_id || args.id) as string;
    const delta = Number(args.quantityDelta || args.quantityChange || args.quantity_change || args.delta || 0);
    const targetItem = mockInventory.find((item) => item.id === id);
    mockInventory = mockInventory.map((item) =>
      item.id === id
        ? { ...item, current_stock: Math.max(0, item.current_stock + delta) }
        : item
    );
    lsSave('inventory', mockInventory);

    // Denetim kaydı (audit log): hash'siz, yalnızca mühürlü.
    if (targetItem) {
      pushMockAuditLog({
        tenantId: targetItem.tenant_id as string,
        actorId: (args.actorId || args.actor_id || 'Patron') as string,
        actorRole: (args.callerRole || args.caller_role || 'OWNER') as string,
        category: 'MENU',
        action: delta < 0 ? 'stock:movement_out' : 'stock:movement_in',
        resourceId: targetItem.id,
        payload: {
          quantity: delta,
          movementType: (args.movementType || args.movement_type || 'IN') as string,
          reason: (args.reason || null) as string | null,
        },
      });
    }
    return { success: true } as unknown as T;
  }

  // ----- VARDİYA (Shift / Cashier) -----
  if (cmd === 'get_active_shift') {
    const targetCashierId = (args.cashierId || args.cashier_id) as string | undefined;
    const active = mockShifts.find((s) => {
      if (s.status !== 'OPEN') return false;
      if (!matchesTenant(s.tenant_id)) return false;
      if (targetCashierId && s.cashierId !== targetCashierId) return false;
      return true;
    });
    return (active || null) as unknown as T;
  }
  if (cmd === 'get_open_shifts') {
    const openShifts = mockShifts.filter((s) => s.status === 'OPEN' && matchesTenant(s.tenant_id));
    return openShifts.map((s) => ({
      id: s.id,
      cashierId: s.cashierId,
      cashierName: s.cashierName,
      openedAt: s.openedAt,
      openingBalance: s.expectedAmountCents,
    })) as unknown as T;
  }
  if (cmd === 'open_shift') {
    const shiftTenantId = (args.tenantId || args.tenant_id || callerTenantId || '') as string;
    const targetCashierId = (args.cashierId || args.cashier_id || 'usr_cashier') as string;
    const staffMember = mockStaff.find((s) => s.id === targetCashierId);
    const cashierName = staffMember?.name || (args.cashierName as string) || 'Kasiyer';
    const openingAmount = Number(args.expectedAmountCents ?? args.expected_amount_cents ?? 0);

    const newShift: MockShift = {
      id: `shift_${Date.now()}`,
      tenant_id: shiftTenantId,
      cashierId: targetCashierId,
      cashierName,
      status: 'OPEN',
      openedAt: new Date().toISOString(),
      closedAt: null,
      expectedAmountCents: openingAmount,
      actualAmountCents: null,
      differenceCents: null,
    };
    mockShifts = [newShift, ...mockShifts];
    lsSave('shifts', mockShifts);
    return newShift as unknown as T;
  }
  if (cmd === 'close_shift') {
    const targetCashierId = (args.cashierId || args.cashier_id) as string | undefined;
    const targetShiftId = (args.shiftId || args.shift_id) as string | undefined;
    const closingAmount = Number(args.actualAmountCents ?? args.actual_amount_cents ?? 0);

    mockShifts = mockShifts.map((s) => {
      const isMatch = (targetShiftId && s.id === targetShiftId) ||
        (targetCashierId && s.cashierId === targetCashierId && s.status === 'OPEN') ||
        (!targetShiftId && !targetCashierId && s.status === 'OPEN');

      if (!isMatch) return s;
      return {
        ...s,
        status: 'CLOSED' as const,
        closedAt: new Date().toISOString(),
        actualAmountCents: closingAmount,
        differenceCents: closingAmount - s.expectedAmountCents,
      };
    });
    lsSave('shifts', mockShifts);
    return { success: true } as unknown as T;
  }
  if (cmd === 'get_shift_summary') {
    const targetShiftId = (args.shiftId || args.shift_id) as string | undefined;
    const shift = mockShifts.find((s) => s.id === targetShiftId) || mockShifts.find((s) => s.status === 'OPEN');
    const openingBalance = shift ? shift.expectedAmountCents : 10000;
    const totalSales = mockReceipts
      .filter((r) => matchesTenant(r.tenant_id))
      .reduce((sum, r) => sum + (r.total_cents || 0), 0);

    return {
      shiftId: targetShiftId || shift?.id || 'shift_default',
      totalSales,
      totalCashIn: 0,
      totalCashOut: 0,
      expectedBalance: openingBalance + totalSales,
      discrepancy: 0,
    } as unknown as T;
  }
  if (cmd === 'get_shift_history') {
    const closedShifts = mockShifts.filter((s) => s.status === 'CLOSED' && matchesTenant(s.tenant_id));
    if (closedShifts.length > 0) {
      return closedShifts as unknown as T;
    }
    // Fallback: If no closed shifts yet (e.g. initial view before any shift closed)
    return [] as unknown as T;
  }
  if (cmd === 'cash_in' || cmd === 'cash_out') {
    return { success: true } as unknown as T;
  }
  if (cmd === 'close_day') {
    return {
      success: true,
      message: 'Gün sonu başarıyla kapatıldı.',
      closedShiftsCount: mockShifts.filter(s => s.status === 'CLOSED').length || 1,
      totalRevenueCents: 173500,
      totalOrders: 48,
      closedAt: new Date().toISOString(),
    } as unknown as T;
  }

  // ----- OPERASYONLAR & ONAYLAR (Operations & Approvals) -----
  if (cmd === 'get_live_orders') {
    return mockLiveOrders.filter((o) => matchesTenant(o.tenant_id as string | undefined)) as unknown as T;
  }
  if (cmd === 'get_audit_logs') {
    // Backend ile aynı kapı: yalnızca işletme sahibi ve müdür. Rol alanı
    // gelmezse istek reddedilir (fail-closed).
    const role = (args.callerRole || args.caller_role) as string | undefined;
    if (!role) {
      throw new Error('UNAUTHORIZED: caller_role is required');
    }
    const normalized = role.trim().toUpperCase();
    if (normalized !== 'OWNER' && normalized !== 'MANAGER') {
      throw new Error('UNAUTHORIZED: Bu işlem için yetki yok (izin: OWNER, MANAGER).');
    }

    const filter = (args.filter || {}) as {
      actorId?: string;
      category?: string;
      search?: string;
      limit?: number;
      offset?: number;
    };
    const term = (filter.search || '').trim().toLowerCase();
    const rows = mockAuditLogs
      .filter((l) => matchesTenant(l.tenant_id as string | undefined))
      .filter((l) => (filter.actorId ? l.actor_id === filter.actorId : true))
      .filter((l) => (filter.category ? l.category === filter.category : true))
      .filter((l) =>
        term === ''
          ? true
          : [l.action, l.resource_id, l.actor_id]
              .filter((value): value is string => typeof value === 'string')
              .some((value) => value.toLowerCase().includes(term)),
      )
      .sort((a, b) => Number(b.sequence) - Number(a.sequence));

    const offset = Math.max(0, filter.offset ?? 0);
    const limit = Math.min(Math.max(1, filter.limit ?? 100), 500);
    // Backend DTO'su tenant_id döndürmez; mock de döndürmemeli.
    return rows.slice(offset, offset + limit).map(({ tenant_id: _ignored, ...rest }) => rest) as unknown as T;
  }

  // ----- FİŞLER & RAPORLAR (Receipts & Analytics) -----
  if (cmd === 'get_receipts') {
    return mockReceipts.filter((r) => matchesTenant(r.tenant_id)) as unknown as T;
  }
  if (cmd === 'get_daily_summary') {
    const filteredReceipts = mockReceipts.filter((r) => matchesTenant(r.tenant_id));
    const totalRevenue = filteredReceipts.reduce((acc, r) => acc + (r.total_cents || 0), 0);
    return {
      total_revenue_cents: totalRevenue,
      total_orders: filteredReceipts.length,
      payment_methods: totalRevenue > 0 ? { Nakit: Math.round(totalRevenue * 0.4), 'Kredi Kartı': Math.round(totalRevenue * 0.6) } : {},
    } as unknown as T;
  }
  if (cmd === 'get_analytics_dashboard_data') {
    const filteredReceipts = mockReceipts.filter((r) => matchesTenant(r.tenant_id));
    const totalSales = filteredReceipts.reduce((acc, r) => acc + (r.total_cents || 0), 0);
    const count = filteredReceipts.length;
    const avg = count > 0 ? Math.round(totalSales / count) : 0;
    return {
      total_sales_cents: totalSales,
      transaction_count: count,
      average_order_value_cents: avg,
      popular_categories: {},
    } as unknown as T;
  }

  // ----- PLATFORM (Master Admin) -----
  if (cmd === 'get_tenants') {
    const role = (args.callerRole || args.caller_role) as string;
    const tenantId = (args.callerTenantId || args.caller_tenant_id) as string;
    if (role === 'MASTER' || !tenantId) {
      return [...mockTenants] as unknown as T;
    }
    return mockTenants.filter((t) => t.id === tenantId) as unknown as T;
  }
  if (cmd === 'create_tenant') {
    const name = (args.name as string) || 'Yeni Müşteri';
    const modules = (args.modules || ['core']) as string[];
    const rawStatus = (args.status as string) || 'ACTIVE';
    const status = rawStatus.toUpperCase();
    const contactPerson = (args.contactPerson || args.contact_person || '') as string;
    const email = (args.email || '') as string;
    const phone = (args.phone || '') as string;
    const taxId = (args.taxId || args.tax_id || '') as string;
    const taxOffice = (args.taxOffice || args.tax_office || '') as string;
    const address = (args.address || '') as string;
    const newId = (args.id as string) || `tenant_${Date.now()}`;

    const newTenant = {
      id: newId,
      name,
      status,
      modules,
      contact_person: contactPerson,
      email,
      phone,
      tax_id: taxId,
      tax_office: taxOffice,
      address,
      created_at: new Date().toISOString(),
    };
    mockTenants = [newTenant as unknown as MockTenant, ...mockTenants];
    lsSave('tenants', mockTenants);

    // Automatically create an OWNER user for this tenant
    const ownerName = contactPerson ? `${contactPerson} (Patron)` : `${name} Patronu`;
    const ownerPin = (args.pin || args.ownerPin || args.owner_pin || args.pin_code || String(Math.floor(1000 + Math.random() * 8999))) as string;
    const cleanSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'musteri';
    const ownerEmail = (args.ownerEmail || args.email || `owner@${cleanSlug}.kasam360.com`) as string;
    const ownerPassword = (args.ownerPassword || args.password || `K360-${Math.random().toString(36).slice(2, 10).toUpperCase()}`) as string;
    const ownerLicKeyChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const ownerSeg = () => Array.from({ length: 4 }, () => ownerLicKeyChars[Math.floor(Math.random() * ownerLicKeyChars.length)]).join('');
    const ownerLicenseKey = (args.licenseKey || args.license_key || `K360-${ownerSeg()}-${ownerSeg()}-${ownerSeg()}`) as string;

    const ownerStaff: MockStaffMember = {
      id: `usr_owner_${newId}`,
      name: ownerName,
      role: 'OWNER',
      tenant_id: newId,
      pin: ownerPin,
      email: ownerEmail,
      password: ownerPassword,
      license_key: ownerLicenseKey,
    };
    mockStaff.push(ownerStaff);
    lsSave('staff', mockStaff);

    return newTenant as unknown as T;
  }
  if (cmd === 'update_tenant') {
    const tenantId = (args.id || args.tenantId || args.tenant_id) as string;
    const name = args.name as string;
    const contactPerson = (args.contactPerson || args.contact_person) as string | undefined;
    const email = args.email as string | undefined;
    const phone = args.phone as string | undefined;
    const taxId = (args.taxId || args.tax_id) as string | undefined;
    const taxOffice = (args.taxOffice || args.tax_office) as string | undefined;
    const address = args.address as string | undefined;

    let updatedTenant: MockTenant | null = null;
    mockTenants = mockTenants.map((t) => {
      if (t.id === tenantId) {
        updatedTenant = {
          ...t,
          ...(name ? { name } : {}),
          ...(contactPerson !== undefined ? { contact_person: contactPerson } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(taxId !== undefined ? { tax_id: taxId } : {}),
          ...(taxOffice !== undefined ? { tax_office: taxOffice } : {}),
          ...(address !== undefined ? { address } : {}),
        };
        return updatedTenant;
      }
      return t;
    });
    lsSave('tenants', mockTenants);
    return (updatedTenant || { id: tenantId, name }) as unknown as T;
  }
  if (cmd === 'suspend_tenant') {
    const tenantId = (args.tenantId || args.tenant_id) as string;
    let updatedTenant: MockTenant | null = null;
    mockTenants = mockTenants.map((t) => {
      if (t.id === tenantId) {
        updatedTenant = { ...t, status: 'SUSPENDED' };
        return updatedTenant;
      }
      return t;
    });
    return (updatedTenant || { success: true, status: 'SUSPENDED' }) as unknown as T;
  }
  if (cmd === 'activate_tenant') {
    const tenantId = (args.tenantId || args.tenant_id) as string;
    let updatedTenant: MockTenant | null = null;
    mockTenants = mockTenants.map((t) => {
      if (t.id === tenantId) {
        updatedTenant = { ...t, status: 'ACTIVE' };
        return updatedTenant;
      }
      return t;
    });
    return (updatedTenant || { success: true, status: 'ACTIVE' }) as unknown as T;
  }
  if (cmd === 'update_tenant_modules') {
    const tenantId = (args.tenantId || args.tenant_id) as string;
    const modules = (args.modules || ['core']) as string[];

    let updatedTenant: MockTenant | null = null;
    mockTenants = mockTenants.map((t) => {
      if (t.id === tenantId) {
        updatedTenant = { ...t, modules };
        return updatedTenant;
      }
      return t;
    });

    lsSave('tenants', mockTenants);
    return (updatedTenant || { success: true }) as unknown as T;
  }
  if (cmd === 'get_devices') {
    return [...mockDevices] as unknown as T;
  }
    if (cmd === 'register_device') {
      const tenantId = (args.tenantId || args.tenant_id || '') as string;


    const newDev = {
      id: (args.deviceId || args.device_id || `dev_${Date.now()}`) as string,
      tenant_id: tenantId,
      name: (args.name as string) || 'Yeni Cihaz',
      device_type: (args.deviceType || args.device_type || 'POS') as string,
      status: 'online',
      last_heartbeat: new Date().toISOString(),
    };
    mockDevices = [newDev as unknown as MockDevice, ...mockDevices];
    return newDev as unknown as T;
  }
  if (cmd === 'toggle_device_status') {
    const devId = (args.deviceId || args.device_id || args.id) as string;
    mockDevices = mockDevices.map((d) =>
      d.id === devId ? { ...d, status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } : d
    );
    return { success: true } as unknown as T;
  }
  if (cmd === 'delete_device') {
    const devId = (args.deviceId || args.device_id || args.id) as string;
    mockDevices = mockDevices.filter((d) => d.id !== devId);
    return { success: true } as unknown as T;
  }
  if (cmd === 'record_device_heartbeat') {
    const devId = (args.deviceId || args.device_id) as string;
    mockDevices = mockDevices.map((d) =>
      d.id === devId ? { ...d, last_heartbeat: new Date().toISOString() } : d
    );
    return { success: true } as unknown as T;
  }
  if (cmd === 'get_global_users') {
    return [...mockStaff] as unknown as T;
  }
  if (cmd === 'get_user_credentials') {
    const userId = (args.userId || args.user_id || args.id) as string;
    const providedPasscode = (args.authKey || args.auth_key || args.masterPasscode || args.master_passcode || args.passcode || '') as string;
    const expectedPasscode = (import.meta as unknown as { env?: { VITE_MASTER_VAULT_PASSCODE?: string } }).env?.VITE_MASTER_VAULT_PASSCODE || '3736';

    if (providedPasscode !== expectedPasscode) {
      throw new Error('Yetkisiz erişim: Süper Admin güvenlik parolası (3736) hatalı!');
    }

    const staff = mockStaff.find((s) => s.id === userId);
    if (!staff) {
      throw new Error(`Kullanıcı (${userId}) bulunamadı.`);
    }

    return {
      userId: staff.id,
      name: staff.name,
      role: staff.role,
      tenantId: staff.tenant_id,
      email: staff.email || `${staff.id}@kasam360.com`,
      password: staff.password || 'admin123',
      pin: staff.pin || '1111',
      licenseKey: staff.license_key || 'K360-DEFAULT-KEY',
    } as unknown as T;
  }

  // ----- KİMLİK BİLGİSİ YÖNETİMİ (Credential Management) -----

  if (cmd === 'reset_user_password') {
    const userId = args.user_id as string;
    const providedNewPassword = args.new_password as string | undefined;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const randSegment = () => Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const newPassword = providedNewPassword || `K360-${randSegment()}`;
    const target = mockStaff.find((s) => s.id === userId);
    if (!target) throw new Error(`Kullanıcı (${userId}) bulunamadı.`);
    mockStaff = mockStaff.map((s) =>
      s.id === userId ? { ...s, password: newPassword } : s
    );
    return { user_id: userId, new_password: newPassword } as unknown as T;
  }

  if (cmd === 'change_user_pin' || cmd === 'change_self_pin') {
    const userId = (args.user_id || args.userId) as string;
    const newPin = (args.new_pin || args.newPin) as string;
    const currentPin = (args.current_pin || args.currentPin) as string | undefined;
    if (!newPin || !/^\d{4,8}$/.test(newPin)) {
      throw new Error('PIN 4-8 haneli sayısal olmalıdır.');
    }
    const target = mockStaff.find((s) => s.id === userId);
    if (!target) throw new Error(`Kullanıcı (${userId}) bulunamadı.`);
    if (currentPin && target.pin && target.pin !== currentPin) {
      throw new Error('Mevcut PIN hatalı.');
    }
    // PIN çakışma kontrolü
    const pinConflict = mockStaff.find(
      (s) => s.id !== userId && s.pin === newPin && (s.tenant_id === target.tenant_id || s.role === 'MASTER')
    );
    if (pinConflict) {
      throw new Error(`Bu PIN zaten kullanımda: ${pinConflict.name}`);
    }
    mockStaff = mockStaff.map((s) =>
      s.id === userId ? { ...s, pin: newPin } : s
    );
    lsSave('staff', mockStaff);
    return { success: true, user_id: userId, new_pin: newPin } as unknown as T;
  }

  if (cmd === 'regenerate_license_key') {
    const userId = args.user_id as string;
    const target = mockStaff.find((s) => s.id === userId);
    if (!target) throw new Error(`Kullanıcı (${userId}) bulunamadı.`);
    const validChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seg = () => Array.from({ length: 4 }, () => validChars[Math.floor(Math.random() * validChars.length)]).join('');
    const newKey = `K360-${seg()}-${seg()}-${seg()}`;
    mockStaff = mockStaff.map((s) =>
      s.id === userId ? { ...s, license_key: newKey } : s
    );
    return { user_id: userId, new_key: newKey } as unknown as T;
  }

  if (cmd === 'get_platform_audit_logs') {
    return [...mockPlatformAuditLogs] as unknown as T;
  }
  if (cmd === 'verify_audit_ledger_integrity') {
    // Kriptografik zincir doğrulama simülasyonu: sonuç yalnızca geçerlilik ve
    // sayı döndürür, ham hash veya kök hash istemciye sızmaz (backend ile aynı sözleşme).
    const total = mockPlatformAuditLogs.length;
    return {
      isValid: true,
      verifiedCount: total,
      hasEntries: total > 0,
      timestamp: new Date().toISOString(),
      algorithm: 'SHA-256',
    } as unknown as T;
  }
  if (cmd === 'create_remote_session') {
    const tenantId = (args.tenantId || args.tenant_id || '') as string;
    const targetView = (args.targetView || 'POS') as string;
    const targetRole = (args.targetRole || 'OWNER') as string;
    const mode = (args.mode || 'READONLY') as string;

    const newAuditEntry = {
      id: `log_remote_${Date.now()}`,
      sequence: 1000 + mockPlatformAuditLogs.length + 1,
      timestamp: new Date().toISOString(),
      actorId: 'usr_master',
      actorRole: 'MASTER',
      action: `REMOTE_SESSION_ATTACH (${targetView}/${targetRole})`,
      resourceId: `tenant:${tenantId}`,
      sealed: true,
      tenantId,
      tenantName: mockTenants.find(t => t.id === tenantId)?.name || 'İşletme',
      severity: mode === 'INTERACTIVE' ? 'HIGH' : 'LOW',
      category: 'SECURITY',
      ipAddress: '10.0.0.1 (Master Console)',
      userAgent: 'KASAM360 IT Diagnostic Remote Engine v2.0',
      terminalId: 'master-ops-deck',
      payloadJson: { mode, targetView, targetRole, initiatedAt: new Date().toISOString() },
    };
    mockPlatformAuditLogs = [newAuditEntry, ...mockPlatformAuditLogs];

    return {
      success: true,
      sessionId: `sess_${Date.now()}`,
      ticket: `TICKET_${Math.random().toString(36).substring(2).toUpperCase()}`,
      mode,
    } as unknown as T;
  }
  if (cmd === 'execute_it_action') {
    const actionType = (args.actionType || args.action_type || '') as string;
    const tenantId = (args.tenantId || args.tenant_id || '') as string;
    const tenant = mockTenants.find(t => t.id === tenantId);
    const tenantName = tenant?.name || tenantId || 'Genel İşletme';

    let message = 'İşlem tamamlandı.';
    let pingMs: number | undefined = undefined;
    let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' = 'MEDIUM';
    const errorCode: string | undefined = undefined;
    let category: 'SYSTEM' | 'SYNC' | 'HARDWARE' | 'SECURITY' | 'PAYMENT' | 'ORDER' = 'SYSTEM';

    if (actionType === 'DIAGNOSTIC_PING') {
      pingMs = Math.floor(12 + Math.random() * 28);
      message = `Ağ ve IPC bağlantısı stabil. Gecikme: ${pingMs}ms.`;
      severity = 'INFO';
      category = 'HARDWARE';
    } else if (actionType === 'FORCE_RESYNC') {
      message = `${tenantName} terminallerine anlık senkronizasyon tetiklendi. Kuyruktaki bekleyen tüm paketler işlendi.`;
      severity = 'LOW';
      category = 'SYNC';
    } else if (actionType === 'CLEAR_CACHE') {
      message = `${tenantName} yerel önbelleği ve geçici bellek alanı boşaltıldı. Katalog yeniden çekiliyor.`;
      severity = 'MEDIUM';
      category = 'SYSTEM';
    } else if (actionType === 'FORCE_LOGOUT') {
      message = `${tenantName} altındaki tüm açık terminal oturumları sonlandırıldı ve PIN kilit ekranına yönlendirildi.`;
      severity = 'HIGH';
      category = 'SECURITY';
    }

    const itAuditEntry = {
      id: `log_it_${Date.now()}`,
      sequence: 1000 + mockPlatformAuditLogs.length + 1,
      timestamp: new Date().toISOString(),
      actorId: 'usr_master',
      actorRole: 'MASTER',
      action: `IT_OPERATIONAL_COMMAND: ${actionType}`,
      resourceId: `tenant:${tenantId}`,
      sealed: true,
      tenantId,
      tenantName,
      severity,
      errorCode,
      category,
      ipAddress: '10.0.0.1 (Master Console)',
      userAgent: 'KASAM360 IT Remote Diagnostic Toolkit',
      terminalId: 'master-ops-deck',
      payloadJson: { actionType, pingMs, executedAt: new Date().toISOString(), result: 'SUCCESS' },
    };
    mockPlatformAuditLogs = [itAuditEntry, ...mockPlatformAuditLogs];

    return {
      success: true,
      actionType,
      message,
      pingMs,
    } as unknown as T;
  }

  // ----- KDS (Mutfak Ekranı) -----
  if (cmd === 'get_stations') {
    return mockKdsStations as unknown as T;
  }
  if (cmd === 'get_active_tickets') {
    return mockKdsTickets as unknown as T;
  }
  if (cmd === 'kds_update_ticket_status') {
    const payload = (args.payload || {}) as Record<string, unknown>;
    const orderId = payload.orderId as string;
    const toStatus = payload.toStatus as string;
    const normStatus = (toStatus || '').toUpperCase();

    mockKdsTickets = mockKdsTickets.map((t) => {
      if (t.id !== orderId) return t;
      const rawItems = (t.items || []) as Record<string, unknown>[];
      const updatedItems = rawItems.map((it: Record<string, unknown>) =>
        normStatus === 'READY'
          ? { ...it, status: 'Ready' }
          : normStatus === 'PREPARING'
          ? { ...it, status: String(it.status || '').toUpperCase() === 'PENDING' ? 'Preparing' : it.status }
          : normStatus === 'SERVED'
          ? { ...it, status: 'SERVED' }
          : it
      );
      return {
        ...t,
        status: toStatus,
        items: updatedItems,
      };
    });
    return { success: true } as unknown as T;
  }
  if (cmd === 'update_kds_item_status') {
    const payload = (args.payload || {}) as Record<string, unknown>;
    const itemId = payload.itemId as string;
    const status = (payload.status as string) || 'Ready';
    mockKdsTickets = mockKdsTickets.map((t) => {
      const rawItems = (t.items || []) as Record<string, unknown>[];
      const hasItem = rawItems.some((it: Record<string, unknown>) => it.id === itemId);
      if (!hasItem) return t;
      const updatedItems = rawItems.map((it: Record<string, unknown>) =>
        it.id === itemId ? { ...it, status } : it
      );
      const allReady = updatedItems.every((it: Record<string, unknown>) => {
        const s = String(it.status || '').toUpperCase();
        return s === 'READY' || s === 'COMPLETED' || s === 'SERVED';
      });
      const anyPreparing = updatedItems.some(
        (it: Record<string, unknown>) => String(it.status || '').toUpperCase() === 'PREPARING'
      );
      let derivedStatus = t.status;
      if (allReady) derivedStatus = 'Ready';
      else if (anyPreparing && String(t.status || '').toUpperCase() === 'PENDING') derivedStatus = 'Preparing';

      return {
        ...t,
        items: updatedItems,
        status: derivedStatus,
      };
    });
    return { success: true } as unknown as T;
  }

  // ── Finans & Cari (Hesap Defteri) Mock Handlers ──
  if (cmd === 'get_directories') {
    const dType = args.directory_type as string | undefined;
    let list = mockDirectories.filter((d) => matchesTenant(d.tenantId));
    if (dType) {
      list = list.filter((d) => d.type === dType);
    }
    return list as unknown as T;
  }

  if (cmd === 'create_directory') {
    const payload = (args.payload || args) as Record<string, unknown>;
    const newDir: MockDirectory = {
      id: `dir_${Date.now()}`,
      tenantId: (payload.tenantId || payload.tenant_id || callerTenantId || 'DEFAULT_TENANT') as string,
      name: (payload.name as string) || 'Yeni Cari',
      type: (payload.type as string) || 'CUSTOMER',
      phone: payload.phone as string | undefined,
      email: payload.email as string | undefined,
      taxNo: payload.taxNo as string | undefined,
      taxOffice: payload.taxOffice as string | undefined,
      address: payload.address as string | undefined,
      creditLimitCents: Number(payload.creditLimitCents || 0),
      notes: payload.notes as string | undefined,
      createdAt: new Date().toISOString(),
      balanceCents: 0,
    };
    mockDirectories.push(newDir);
    lsSave('directories', mockDirectories);
    return newDir as unknown as T;
  }

  if (cmd === 'update_directory') {
    const payload = (args.payload || args) as Record<string, unknown>;
    const dirId = payload.id as string;
    const idx = mockDirectories.findIndex((d) => d.id === dirId);
    if (idx !== -1) {
      mockDirectories[idx] = {
        ...mockDirectories[idx],
        name: (payload.name as string) ?? mockDirectories[idx].name,
        phone: (payload.phone as string | undefined) ?? mockDirectories[idx].phone,
        email: (payload.email as string | undefined) ?? mockDirectories[idx].email,
        taxNo: (payload.taxNo as string | undefined) ?? mockDirectories[idx].taxNo,
        taxOffice: (payload.taxOffice as string | undefined) ?? mockDirectories[idx].taxOffice,
        address: (payload.address as string | undefined) ?? mockDirectories[idx].address,
        creditLimitCents: payload.creditLimitCents !== undefined ? Number(payload.creditLimitCents) : mockDirectories[idx].creditLimitCents,
        notes: (payload.notes as string | undefined) ?? mockDirectories[idx].notes,
      };
      lsSave('directories', mockDirectories);
      return mockDirectories[idx] as unknown as T;
    }
    return { success: true } as unknown as T;
  }

  if (cmd === 'get_debts') {
    const status = args.status as string | undefined;
    const dType = (args.debt_type || args.type) as string | undefined;
    let list = mockDebts.filter((d) => matchesTenant(d.tenantId));
    if (status) list = list.filter((d) => d.status === status);
    if (dType) list = list.filter((d) => d.type === dType);
    return list as unknown as T;
  }

  if (cmd === 'create_debt') {
    const payload = (args.payload || args) as Record<string, unknown>;
    const dir = mockDirectories.find((d) => d.id === payload.directoryId);
    const amount = Number(payload.totalAmountCents || 0);
    const newDebt: MockDebt = {
      id: `dbt_${Date.now()}`,
      tenantId: (payload.tenantId || payload.tenant_id || callerTenantId || 'DEFAULT_TENANT') as string,
      directoryId: (payload.directoryId as string) || '',
      directoryName: dir?.name,
      type: (payload.type as string) || 'TAKEN',
      totalAmountCents: amount,
      remainingAmountCents: amount,
      dueDate: payload.dueDate as string | undefined,
      status: 'PENDING',
      isCash: Boolean(payload.isCash),
      orderId: payload.orderId as string | undefined,
      description: payload.description as string | undefined,
      createdAt: new Date().toISOString(),
    };
    mockDebts.push(newDebt);
    lsSave('debts', mockDebts);

    // Cari kart bakiyesini güncelle
    if (dir) {
      dir.balanceCents += newDebt.type === 'GIVEN' ? amount : -amount;
      lsSave('directories', mockDirectories);
    }
    return newDebt as unknown as T;
  }

  if (cmd === 'pay_debt') {
    const payload = (args.payload || args) as Record<string, unknown>;
    const debtId = payload.debtId as string;
    const payAmount = Number(payload.amountCents || 0);
    const debt = mockDebts.find((d) => d.id === debtId);
    if (debt) {
      debt.remainingAmountCents = Math.max(0, debt.remainingAmountCents - payAmount);
      debt.status = debt.remainingAmountCents === 0 ? 'PAID' : 'PARTIAL';
      lsSave('debts', mockDebts);

      const dir = mockDirectories.find((d) => d.id === debt.directoryId);
      if (dir) {
        dir.balanceCents += debt.type === 'GIVEN' ? -payAmount : payAmount;
        lsSave('directories', mockDirectories);
      }
    }
    return {
      paymentId: `pmt_${Date.now()}`,
      debtId,
      amountCents: payAmount,
      remainingAmountCents: debt?.remainingAmountCents ?? 0,
      status: debt?.status ?? 'PAID',
      cashMovementId: payload.paymentMethod === 'CASH' ? `csh_${Date.now()}` : undefined,
    } as unknown as T;
  }

  if (cmd === 'get_expenses') {
    const cat = args.category as string | undefined;
    let list = mockExpenses.filter((e) => matchesTenant(e.tenantId));
    if (cat) list = list.filter((e) => e.category === cat);
    return list as unknown as T;
  }

  if (cmd === 'create_expense') {
    const payload = (args.payload || args) as Record<string, unknown>;
    const dir = mockDirectories.find((d) => d.id === payload.directoryId);
    const newExp: MockExpense = {
      id: `exp_${Date.now()}`,
      tenantId: (payload.tenantId || payload.tenant_id || callerTenantId || 'DEFAULT_TENANT') as string,
      category: (payload.category as string) || 'OTHER',
      amountCents: Number(payload.amountCents || 0),
      paymentMethod: (payload.paymentMethod as string) || 'CASH',
      directoryId: payload.directoryId as string | undefined,
      directoryName: dir?.name,
      shiftId: (payload.shiftId as string) || undefined,
      actorId: (payload.actorId as string) || 'Kasiyer',
      description: payload.description as string | undefined,
      expenseDate: (payload.expenseDate as string) || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    mockExpenses.push(newExp);
    lsSave('expenses', mockExpenses);
    return newExp as unknown as T;
  }

  if (cmd === 'get_financial_report') {
    const totalRev = mockShifts.reduce((acc, s) => acc + (s.expectedAmountCents || 0), 4500000);
    const totalExp = mockExpenses.reduce((acc, e) => acc + e.amountCents, 0);
    const totalReceivables = mockDebts.filter((d) => d.type === 'GIVEN' && d.status !== 'PAID').reduce((acc, d) => acc + d.remainingAmountCents, 0);
    const totalPayables = mockDebts.filter((d) => d.type === 'TAKEN' && d.status !== 'PAID').reduce((acc, d) => acc + d.remainingAmountCents, 0);

    const catMap = new Map<string, { totalCents: number; count: number }>();
    for (const exp of mockExpenses) {
      const existing = catMap.get(exp.category) || { totalCents: 0, count: 0 };
      catMap.set(exp.category, {
        totalCents: existing.totalCents + exp.amountCents,
        count: existing.count + 1,
      });
    }

    const expensesByCategory = Array.from(catMap.entries()).map(([category, val]) => ({
      category,
      totalCents: val.totalCents,
      count: val.count,
    }));

    return {
      totalRevenueCents: totalRev,
      totalExpensesCents: totalExp,
      netProfitCents: totalRev - totalExp,
      receivablesCents: totalReceivables,
      payablesCents: totalPayables,
      expensesByCategory,
      monthlyTrend: [
        { month: '2026-04', revenueCents: 4500000, expenseCents: 1200000, profitCents: 3300000 },
        { month: '2026-03', revenueCents: 4100000, expenseCents: 1100000, profitCents: 3000000 },
        { month: '2026-02', revenueCents: 3800000, expenseCents: 950000, profitCents: 2850000 },
      ],
    } as unknown as T;
  }

  if (cmd === 'get_all_table_statuses') {
    return mockTables.map((t) => ({
      tableId: t.id,
      status: t.status === 'OCCUPIED' ? 'Ready' : 'Unknown',
    })) as unknown as T;
  }

  // ----- GENEL: get_* / list_* → boş dizi fallback -----
  if (cmd.startsWith('get_') || cmd.startsWith('list_')) {
    return [] as unknown as T;
  }

  // ----- Tüm aksiyon komutları → başarılı -----
  return { success: true, message: 'Tarayıcı modunda işlem başarılı.' } as unknown as T;
}

// ---------------------------------------------------------------------------
// Ana export
// ---------------------------------------------------------------------------
export async function tauriInvoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  const finalArgs: Record<string, unknown> = {
    ...((args as Record<string, unknown>) || {}),
  };

  // Çoklu kiracı / denetim bağlamını enjekte et
  const user = useAuthStore.getState().user;
  if (user) {
    if (finalArgs.tenant_id === undefined) finalArgs.tenant_id = user.tenantId;
    if (finalArgs.actor_role === undefined) finalArgs.actor_role = user.role;
    if (finalArgs.actor_id === undefined) finalArgs.actor_id = user.userId;
    if (finalArgs.tenantId === undefined) finalArgs.tenantId = user.tenantId;
    if (finalArgs.actorRole === undefined) finalArgs.actorRole = user.role;
    if (finalArgs.actorId === undefined) finalArgs.actorId = user.userId;
    // Rol kapıları `caller_role` bekler ve rol alanı gelmezse reddeder. Değer
    // oturumdan gelir: çağıran bileşenin rolü kendi kafasında taşımaması,
    // yetkinin tek yerden (oturum) yönetilmesini sağlar.
    if (finalArgs.caller_role === undefined) finalArgs.caller_role = user.role;
    if (finalArgs.callerRole === undefined) finalArgs.callerRole = user.role;
    if (finalArgs.branchId === undefined && user.branchId) finalArgs.branchId = user.branchId;
    if (finalArgs.branch_id === undefined && user.branchId) finalArgs.branch_id = user.branchId;
  } else {
    if (finalArgs.tenant_id === undefined) finalArgs.tenant_id = '';
  }

  if (isBrowser()) {
    return browserMock<T>(cmd, finalArgs);
  }

  return await invoke<T>(cmd, finalArgs as InvokeArgs);
}
