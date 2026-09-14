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
  plan_id: string | null;
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
let mockTables: MockTable[] = lsLoad<MockTable[]>('tables', []);

// 2. Kategoriler
let mockCategories: MockCategory[] = lsLoad<MockCategory[]>('categories', []);

// 3. Ürünler
let mockProducts: MockProduct[] = lsLoad<MockProduct[]>('products', []);

// 4. Değiştiriciler (Modifiers)
let mockModifierGroups: MockModifierGroup[] = lsLoad<MockModifierGroup[]>('modifier_groups', []);

// 5. Masa Siparişleri (Order Items)
const mockOrderItems: Record<string, unknown[]> = lsLoad<Record<string, unknown[]>>('order_items', {});

// 6. Personel (Staff) - Master Admin preserved for tenant creation
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
];
let mockStaff: MockStaffMember[] = lsLoad<MockStaffMember[]>('staff', DEFAULT_STAFF);
// Master Admin her zaman mevcut olsun:
if (!mockStaff.find((s) => s.id === 'usr_master')) {
  mockStaff = [DEFAULT_STAFF[0], ...mockStaff];
  lsSave('staff', mockStaff);
}

// 7. Şubeler (Branches)
let mockBranches: MockBranch[] = lsLoad<MockBranch[]>('branches', []);

// 8. Fişler (Receipts)
let mockReceipts: MockReceipt[] = lsLoad<MockReceipt[]>('receipts', []);

// 9. Envanter (Inventory)
let mockInventory: MockInventoryItem[] = lsLoad<MockInventoryItem[]>('inventory', []);

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
    badge: 'Temel',
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
    badge: 'En Popüler',
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
    badge: 'Limitsiz Güç',
    features: ['Sınırsız KDS & Mutfak İstasyonları', '20 Terminal / Cihaz', '10 Şubeye Kadar Konsolide', '7/24 Öncelikli Destek & API', 'SHA-256 Denetim & Tam İzolasyon'],
  },
];
let mockPlans: MockPlan[] = lsLoad<MockPlan[]>('plans', DEFAULT_PLANS);
// Default planlar eksikse tamamla:
for (const dp of DEFAULT_PLANS) {
  if (!mockPlans.find((p) => p.id === dp.id)) {
    mockPlans.push(dp);
  }
}
lsSave('plans', mockPlans);

let mockSubscriptions: MockSubscription[] = lsLoad<MockSubscription[]>('subscriptions', []);

let mockDevices: MockDevice[] = lsLoad<MockDevice[]>('devices', []);

// 10b. Vardiyalar (Shifts)
let mockShifts: MockShift[] = lsLoad<MockShift[]>('shifts', []);

// 11. Canlı Operasyonlar, Onaylar ve Denetim Kayıtları
const mockLiveOrders: Record<string, unknown>[] = lsLoad<Record<string, unknown>[]>('live_orders', []);
let mockPendingApprovals: Record<string, unknown>[] = lsLoad<Record<string, unknown>[]>('pending_approvals', []);
const mockAuditLogs: Record<string, unknown>[] = [];
let mockPlatformAuditLogs: Record<string, unknown>[] = [];

// 12. KDS İstasyonları & Siparişleri
const mockKdsStations = [
  { id: 'Grill', name: 'Izgara / Grill' },
  { id: 'Prep', name: 'Sıcak Hazırlık & Prep' },
  { id: 'Bar', name: 'Bar & İçecek' },
  { id: 'Fryer', name: 'Kızartma / Fryer' },
  { id: 'Pizza', name: 'Pizza & Taş Fırın' },
];

let mockKdsTickets: Record<string, unknown>[] = lsLoad<Record<string, unknown>[]>('kds_tickets', []);

function isBrowser(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return !('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window);
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
    if (pin === '1111') {
      return {
        id: 'usr_master',
        pin: '1111',
        role: 'MASTER',
        name: 'Master Admin',
        tenant_id: '',
        branch_id: '',
        branch_name: '',
      } as unknown as T;
    }

    const staffMember = mockStaff.find((s) => s.pin === pin);
    if (staffMember) {
      const branch = mockBranches.find((b) => b.tenant_id === staffMember.tenant_id);
      return {
        id: staffMember.id,
        pin: pin,
        role: staffMember.role,
        name: staffMember.name,
        tenant_id: staffMember.tenant_id,
        branch_id: branch?.id || '',
        branch_name: branch?.name || '',
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
  if (
    cmd === 'process_payment' ||
    cmd === 'process_split_payment' ||
    cmd === 'void_order'
  ) {
    const payload = (args.payload as Record<string, unknown>) || {};
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
      id: `cat-${Date.now().toString().slice(-4)}`,
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
      id: `prd-${Date.now().toString().slice(-4)}`,
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
    // Pakete bağlı personel sınırı kontrolü (Master Admin sayaca dahil edilmez)
    if (tenantId) {
      const tenant = mockTenants.find(t => t.id === tenantId);
      const sub = mockSubscriptions.find(s => s.tenant_id === tenantId);
      const planId = tenant?.plan_id || sub?.plan_id;
      if (planId) {
        const plan = mockPlans.find(p => p.id === planId);
        if (plan) {
          const currentStaffCount = mockStaff.filter(
            s => s.tenant_id === tenantId && s.id !== 'usr_master' && s.tenant_id !== '' && s.role !== 'MASTER'
          ).length;
          if (currentStaffCount >= plan.max_users) {
            throw new Error(
              `Paketinizin azami personel limiti (${plan.max_users} kişi) dolmuştur! Yeni personel eklemek için lütfen paketinizi yükseltin veya plan limitini güncelleyin.`
            );
          }
        }
      }
    }

    const pin = (args.pin || args.pin_code || String(Math.floor(1000 + Math.random() * 8999))) as string;

    // PIN format doğrulama: 4-6 haneli sayısal
    if (!/^\d{4,6}$/.test(pin)) {
      throw new Error('PIN 4-6 haneli sayısal olmalıdır.');
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
    return newItem as unknown as T;
  }
  if (cmd === 'adjust_stock') {
    const id = (args.inventoryItemId || args.itemId || args.id) as string;
    const delta = Number(args.quantityDelta || args.quantityChange || args.delta || 0);
    mockInventory = mockInventory.map((item) =>
      item.id === id
        ? { ...item, current_stock: Math.max(0, item.current_stock + delta) }
        : item
    );
    lsSave('inventory', mockInventory);
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
  if (cmd === 'get_pending_approvals') {
    return mockPendingApprovals.filter((a) => matchesTenant(a.tenant_id as string | undefined)) as unknown as T;
  }
  if (cmd === 'request_approval') {
    const newAppr = {
      id: `appr_${Date.now().toString().slice(-4)}`,
      tenant_id: (args.tenantId || args.tenant_id || callerTenantId || '') as string,
      action_type: (args.actionType || args.action_type || 'VOID_ORDER') as string,
      request_type: (args.actionType || args.action_type || 'VOID_ORDER') as string,
      resource_id: (args.resourceId || args.resource_id || 'res_001') as string,
      requester_id: (args.requesterId || args.requester_id || 'Kasiyer') as string,
      requested_by: (args.requesterId || args.requester_id || 'Kasiyer') as string,
      status: 'PENDING',
      approver_id: null,
      payload: (args.reason || args.payload || 'Onay Talebi') as string,
      created_at: new Date().toISOString(),
      resolved_at: null,
    };
    mockPendingApprovals = [...mockPendingApprovals, newAppr];
    lsSave('pending_approvals', mockPendingApprovals);
    return { success: true, id: newAppr.id } as unknown as T;
  }
  if (cmd === 'process_approval') {
    const approvalId = (args.approvalId || args.id) as string;
    const action = (args.action as string) || 'APPROVE';
    const managerPin = args.managerPin as string | undefined;
    if (managerPin && managerPin.length > 0) {
      const validPins = ['1111', '2222', '3333', ...mockStaff.map(s => s.pin).filter(Boolean)];
      if (!validPins.includes(managerPin)) {
        throw new Error('Geçersiz müdür PIN kodu.');
      }
    }
    mockPendingApprovals = mockPendingApprovals.filter((a) => a.id !== approvalId);
    lsSave('pending_approvals', mockPendingApprovals);
    return { success: true, message: `İşlem ${action === 'APPROVE' ? 'onaylandı' : 'reddedildi'}.` } as unknown as T;
  }
  if (cmd === 'get_audit_logs') {
    return mockAuditLogs.filter((l) => matchesTenant(l.tenant_id as string | undefined)) as unknown as T;
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
    const planId = (args.planId || args.plan_id || null) as string | null;
    const rawStatus = (args.status as string) || 'ACTIVE';
    const status = rawStatus.toUpperCase();
    const contactPerson = (args.contactPerson || args.contact_person || '') as string;
    const email = (args.email || '') as string;
    const phone = (args.phone || '') as string;
    const newId = (args.id as string) || `tenant_${Date.now()}`;

    const newTenant = {
      id: newId,
      name,
      status,
      plan_id: planId,
      contact_person: contactPerson,
      email,
      phone,
      created_at: new Date().toISOString(),
    };
    mockTenants = [newTenant as unknown as MockTenant, ...mockTenants];
    lsSave('tenants', mockTenants);

    if (planId) {
      mockSubscriptions = [
        {
          id: `sub_${Date.now()}`,
          tenant_id: newId,
          plan_id: planId,
          status,
          renews_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        },
        ...mockSubscriptions,
      ];
      lsSave('subscriptions', mockSubscriptions);
    }

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
    mockSubscriptions = mockSubscriptions.map((s) =>
      s.tenant_id === tenantId ? { ...s, status: 'SUSPENDED' } : s
    );
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
    mockSubscriptions = mockSubscriptions.map((s) =>
      s.tenant_id === tenantId ? { ...s, status: 'ACTIVE' } : s
    );
    return (updatedTenant || { success: true, status: 'ACTIVE' }) as unknown as T;
  }
  if (cmd === 'update_tenant_subscription') {
    const tenantId = (args.tenantId || args.tenant_id) as string;
    const planId = (args.planId || args.plan_id) as string;
    const addDays = Number(args.addDays || args.add_days || 30);

    let updatedTenant: MockTenant | null = null;
    mockTenants = mockTenants.map((t) => {
      if (t.id === tenantId) {
        updatedTenant = { ...t, plan_id: planId };
        return updatedTenant;
      }
      return t;
    });

    const newRenewsAt = new Date(Date.now() + addDays * 86400000).toISOString();
    const existing = mockSubscriptions.find((s) => s.tenant_id === tenantId);
    if (existing) {
      mockSubscriptions = mockSubscriptions.map((s) =>
        s.tenant_id === tenantId
          ? { ...s, plan_id: planId, status: 'ACTIVE', renews_at: newRenewsAt }
          : s
      );
    } else {
      mockSubscriptions = [
        {
          id: `sub_${Date.now()}`,
          tenant_id: tenantId,
          plan_id: planId,
          status: 'ACTIVE',
          renews_at: newRenewsAt,
        },
        ...mockSubscriptions,
      ];
    }
    return (updatedTenant || { success: true, plan_id: planId }) as unknown as T;
  }
  if (cmd === 'get_plans') {
    return [...mockPlans] as unknown as T;
  }
  if (cmd === 'create_plan') {
    const rawId = (args.id as string) || '';
    const name = (args.name as string) || 'Yeni Paket';
    const planId = rawId.trim() || `plan_${Date.now().toString().slice(-6)}`;
    const monthlyPriceCents = Number(args.monthlyPriceCents ?? args.monthly_price_cents ?? 0);
    const maxDevices = Number(args.maxDevices ?? args.max_devices ?? 1);
    const maxUsers = Number(args.maxUsers ?? args.max_users ?? 1);
    const maxBranches = Number(args.maxBranches ?? args.max_branches ?? 1);
    const badge = (args.badge as string) || undefined;
    const features = Array.isArray(args.features) ? (args.features as string[]) : [];

    const existingIndex = mockPlans.findIndex(p => p.id === planId);
    if (existingIndex >= 0) {
      throw new Error(`'${planId}' koduna sahip bir paket zaten mevcut.`);
    }

    const newPlan: MockPlan = {
      id: planId,
      name,
      monthly_price_cents: monthlyPriceCents,
      price_monthly_cents: monthlyPriceCents,
      max_devices: maxDevices,
      max_users: maxUsers,
      max_branches: maxBranches,
      badge,
      features,
    };

    mockPlans = [...mockPlans, newPlan];
    return newPlan as unknown as T;
  }
  if (cmd === 'update_plan') {
    const planId = (args.id as string) || '';
    const target = mockPlans.find(p => p.id === planId);
    if (!target) {
      throw new Error(`Güncellenecek paket (${planId}) bulunamadı.`);
    }

    const name = args.name !== undefined ? (args.name as string) : target.name;
    const monthlyPriceCents = args.monthlyPriceCents !== undefined || args.monthly_price_cents !== undefined
      ? Number(args.monthlyPriceCents ?? args.monthly_price_cents)
      : target.monthly_price_cents;
    const maxDevices = args.maxDevices !== undefined || args.max_devices !== undefined
      ? Number(args.maxDevices ?? args.max_devices)
      : target.max_devices;
    const maxUsers = args.maxUsers !== undefined || args.max_users !== undefined
      ? Number(args.maxUsers ?? args.max_users)
      : target.max_users;
    const maxBranches = args.maxBranches !== undefined || args.max_branches !== undefined
      ? Number(args.maxBranches ?? args.max_branches)
      : target.max_branches;
    const badge = args.badge !== undefined ? (args.badge as string) : target.badge;
    const features = args.features !== undefined && Array.isArray(args.features)
      ? (args.features as string[])
      : target.features;

    const updatedPlan: MockPlan = {
      ...target,
      name,
      monthly_price_cents: monthlyPriceCents,
      price_monthly_cents: monthlyPriceCents,
      max_devices: maxDevices,
      max_users: maxUsers,
      max_branches: maxBranches,
      badge,
      features,
    };

    mockPlans = mockPlans.map(p => p.id === planId ? updatedPlan : p);
    return updatedPlan as unknown as T;
  }
  if (cmd === 'delete_plan') {
    const planId = (args.id || args.planId || args.plan_id) as string;
    // Silme koruması: aktif abonelik kontrolü
    const activeSubCount = mockSubscriptions.filter(
      s => s.plan_id === planId && s.status === 'ACTIVE'
    ).length;
    const tenantCount = mockTenants.filter(t => t.plan_id === planId).length;

    if (activeSubCount > 0 || tenantCount > 0) {
      throw new Error(
        `Bu pakete tanımlı ${activeSubCount || tenantCount} adet aktif işletme/abone bulunmaktadır! Paketi silmeden önce aboneleri başka bir pakete taşıyınız.`
      );
    }

    mockPlans = mockPlans.filter(p => p.id !== planId);
    return { success: true, message: `Paket '${planId}' silindi.` } as unknown as T;
  }
  if (cmd === 'get_subscriptions') {
    return [...mockSubscriptions] as unknown as T;
  }
  if (cmd === 'get_devices') {
    return [...mockDevices] as unknown as T;
  }
  if (cmd === 'register_device') {
    const tenantId = (args.tenantId || args.tenant_id || '') as string;
    if (tenantId) {
      const tenant = mockTenants.find(t => t.id === tenantId);
      const sub = mockSubscriptions.find(s => s.tenant_id === tenantId);
      const planId = tenant?.plan_id || sub?.plan_id;
      if (planId) {
        const plan = mockPlans.find(p => p.id === planId);
        if (plan) {
          const currentDeviceCount = mockDevices.filter(d => d.tenant_id === tenantId).length;
          if (currentDeviceCount >= plan.max_devices) {
            throw new Error(
              `Paketinizin azami cihaz limiti (${plan.max_devices} adet) dolmuştur! Yeni terminal bağlamak için lütfen paketinizi yükseltin veya plan limitini güncelleyin.`
            );
          }
        }
      }
    }

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

  if (cmd === 'change_user_pin') {
    const userId = args.user_id as string;
    const newPin = args.new_pin as string;
    if (!newPin || !/^\d{4,6}$/.test(newPin)) {
      throw new Error('PIN 4-6 haneli sayısal olmalıdır.');
    }
    const target = mockStaff.find((s) => s.id === userId);
    if (!target) throw new Error(`Kullanıcı (${userId}) bulunamadı.`);
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
    // Kriptografik SHA-256 zincir doğrulama simülasyonu
    const total = mockPlatformAuditLogs.length;
    return {
      isValid: true,
      verifiedCount: total,
      timestamp: new Date().toISOString(),
      algorithm: 'SHA-256 (HMAC-Secured Append-Only Ledger)',
      rootHash: total > 0 ? mockPlatformAuditLogs[0].hash : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      status: 'VERIFIED_GENUINE',
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
      hash: Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2),
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
      hash: Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2) + Date.now().toString(16),
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
