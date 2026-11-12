import { create } from 'zustand';
import type { ProductCategory, Product, OrderItem, OrderItemModifier, ModifierGroup } from '../types/pos';
import type { LastSale } from '../types/payment';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { orderErrorText } from '../lib/orderError';
import { printKitchenTickets } from '../lib/kitchenPrint';
import {
  lineTotalCents,
  mapServerItem,
  toSubmitItem,
  type CartItemWire,
} from '../lib/orderMath';

// Sepetin iki parçası vardır: sunucudaki adisyon (tek doğruluk kaynağı) ve bu
// cihazda henüz mutfağa gönderilmemiş taslak. Tutar taslak dışında istemcide
// hesaplanmaz.

export const COUNTER_TABLE = 'COUNTER';

export interface OrderBalance {
  totalCents: number;
  paidCents: number;
  remainingCents: number;
}

interface ModifierGroupWire {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number | null;
  options: { id: string; name: string; priceCents: number }[];
}

interface ProductWire {
  id: string;
  name: string;
  priceCents: number;
  taxRateBp: number;
  categoryId: string;
  station?: string | null;
  inStock: boolean;
  is86?: boolean;
  barcode?: string | null;
}

interface PosStore {
  activeTableId: string | null;
  activeTableName: string;
  isWalkin: boolean;
  guestCount: number;
  activeOrderId: string | null;
  balance: OrderBalance | null;
  categories: ProductCategory[];
  products: Product[];
  selectedCategoryId: string;
  searchQuery: string;
  ticketItems: OrderItem[];
  drafts: Record<string, OrderItem[]>;
  orderError: string | null;
  isSending: boolean;
  lastSale: LastSale | null;
  remoteNotice: string | null;
  activeTariffName: string | null;
  activeModifierProduct: Product | null;
  selectedTicketItemId: string | null;

  loadCatalog: () => Promise<void>;
  loadActiveOrder: () => Promise<void>;
  watchActiveOrder: () => Promise<void>;
  dismissRemoteNotice: () => void;
  dismissOrderError: () => void;
  openOrderForTable: (tableId: string, tableName: string, guests?: number) => Promise<void>;
  openWalkinOrder: () => Promise<void>;
  bindWalkinToTable: (tableId: string, tableName: string) => Promise<void>;
  setSelectedCategoryId: (catId: string) => void;
  setSearchQuery: (query: string) => void;
  openModifierModal: (product: Product) => void;
  loadModifierGroups: (productId: string) => Promise<ModifierGroup[] | null>;
  closeModifierModal: () => void;
  selectTicketItem: (itemId: string | null) => void;
  addItemToTicket: (
    product: Product,
    selectedModifiers?: OrderItemModifier[],
    cookingDegree?: string,
    notes?: string
  ) => void;
  updateItemQty: (itemId: string, delta: number) => void;
  removeItem: (itemId: string) => void;
  setItemNote: (itemId: string, notes: string) => void;
  clearTicket: () => void;
  setLastSale: (sale: LastSale | null) => void;
  sendToKitchen: () => Promise<boolean>;
  calculateTotalCents: () => number;
}

function orderKey(state: Pick<PosStore, 'isWalkin' | 'activeTableId'>): string | null {
  return state.isWalkin ? COUNTER_TABLE : state.activeTableId;
}

function withDraft(state: PosStore, draft: OrderItem[]): Partial<PosStore> {
  const key = orderKey(state);
  const sent = state.ticketItems.filter((item) => item.isSentToKitchen);
  return {
    ticketItems: [...sent, ...draft],
    drafts: key ? { ...state.drafts, [key]: draft } : state.drafts,
  };
}

function draftOf(state: PosStore): OrderItem[] {
  return state.ticketItems.filter((item) => !item.isSentToKitchen);
}

// Son okunan sunucu görünümü. Bu cihazın kendi yazması `loadActiveOrder` ile bunu
// tazeler; izleme farkı görürse değişikliği başka cihaz yapmıştır.
let serverSignature = '';
let loadEpoch = 0;

function signatureOf(orderId: string | null, balance: OrderBalance | null, wire: CartItemWire[]): string {
  return JSON.stringify([orderId, balance, wire]);
}

async function readServerOrder(key: string, tenantId: string | undefined) {
  const orderId = await invokeIPC<string | null>('get_active_order_id', { tableId: key, tenantId });
  const wire = await invokeIPC<CartItemWire[]>('get_order_items', { tableId: key, tenantId });
  const balance = orderId
    ? await invokeIPC<OrderBalance>('get_order_balance', { orderId, tenantId })
    : null;
  return { orderId, wire, balance };
}

function mapProduct(wire: ProductWire): Product {
  const station = wire.station ? wire.station.toLocaleUpperCase('tr-TR') : 'MUTFAK';
  return {
    id: wire.id,
    categoryId: wire.categoryId,
    name: wire.name,
    unitPriceCents: wire.priceCents,
    vatRate: wire.taxRateBp / 100,
    taxRateBp: wire.taxRateBp,
    station,
    isAvailable: wire.inStock,
    is86d: wire.is86,
    barcode: wire.barcode ?? undefined,
  };
}

export const usePosStore = create<PosStore>((set, get) => ({
  activeTableId: null,
  activeTableName: 'Masa seçilmedi',
  isWalkin: false,
  guestCount: 2,
  activeOrderId: null,
  balance: null,
  categories: [],
  products: [],
  selectedCategoryId: 'cat_all',
  searchQuery: '',
  ticketItems: [],
  drafts: {},
  orderError: null,
  isSending: false,
  lastSale: null,
  remoteNotice: null,
  activeTariffName: null,
  activeModifierProduct: null,
  selectedTicketItemId: null,

  loadCatalog: async () => {
    const { tenantId } = sessionArgs();
    const [cats, prods, tariff] = await Promise.all([
      invokeIPC<{ id: string; name: string; icon?: string }[]>('pos_get_categories', { tenantId }),
      invokeIPC<ProductWire[]>('pos_get_products', { tenantId }),
      invokeIPC<{ name: string } | null>('get_active_price_tariff', { tenantId }),
    ]);
    set({
      activeTariffName: tariff?.name ?? null,
      categories: cats.map((cat, orderIndex) => ({ ...cat, orderIndex })),
      products: prods.map(mapProduct),
    });
  },

  loadActiveOrder: async () => {
    const key = orderKey(get());
    if (!key) {
      set({ ticketItems: [], activeOrderId: null, balance: null });
      return;
    }
    const { tenantId } = sessionArgs();
    loadEpoch += 1;
    try {
      const { orderId, wire, balance } = await readServerOrder(key, tenantId);
      serverSignature = signatureOf(orderId, balance, wire);
      const sent = wire.map(mapServerItem).filter((item): item is OrderItem => item !== null);
      set((state) => ({
        activeOrderId: orderId,
        balance,
        ticketItems: [...sent, ...(state.drafts[key] ?? [])],
        orderError: null,
      }));
    } catch (error) {
      // Okunamayan adisyon boş gösterilmez: boş masa sanılıp ikinci adisyon açılır.
      set({ ticketItems: [], activeOrderId: null, balance: null, orderError: String(error) });
    }
  },

  // Aynı masaya ikinci cihaz dokunduğunda ekran eski adisyonla kalmaz. Okuma
  // hatası burada yutulur: geçici kopma açık adisyonu boş göstermemelidir.
  watchActiveOrder: async () => {
    const before = get();
    const key = orderKey(before);
    if (!key || before.isSending) return;
    const epoch = loadEpoch;
    try {
      const { orderId, wire, balance } = await readServerOrder(key, sessionArgs().tenantId);
      if (epoch !== loadEpoch || orderKey(get()) !== key) return;
      const signature = signatureOf(orderId, balance, wire);
      if (signature === serverSignature) return;
      serverSignature = signature;
      const sent = wire.map(mapServerItem).filter((item): item is OrderItem => item !== null);
      set((state) => ({
        activeOrderId: orderId,
        balance,
        ticketItems: [...sent, ...(state.drafts[key] ?? [])],
        remoteNotice: before.activeOrderId && !orderId
          ? 'Bu adisyon başka cihazda kapatıldı.'
          : 'Bu adisyon başka cihazda değişti, güncel hali yüklendi.',
      }));
    } catch {
      return;
    }
  },

  dismissRemoteNotice: () => set({ remoteNotice: null }),

  dismissOrderError: () => set({ orderError: null }),

  openOrderForTable: async (tableId, tableName, guests = 2) => {
    set({
      remoteNotice: null,
      activeTableId: tableId,
      activeTableName: tableName,
      isWalkin: false,
      guestCount: guests,
      selectedTicketItemId: null,
    });
    await get().loadActiveOrder();
  },

  openWalkinOrder: async () => {
    set({
      remoteNotice: null,
      activeTableId: null,
      activeTableName: 'Tezgah Satışı (Al-Götür)',
      isWalkin: true,
      guestCount: 1,
      selectedTicketItemId: null,
    });
    await get().loadActiveOrder();
  },

  // Taslak masaya taşınır. Mutfağa gitmiş tezgâh adisyonu burada taşınmaz.
  bindWalkinToTable: async (tableId, tableName) => {
    const state = get();
    if (state.activeOrderId) {
      set({ orderError: 'Mutfağa gönderilmiş tezgâh adisyonu masaya bağlanamaz.' });
      return;
    }
    const draft = draftOf(state);
    set((current) => ({
      activeTableId: tableId,
      activeTableName: tableName,
      isWalkin: false,
      drafts: {
        ...current.drafts,
        [COUNTER_TABLE]: [],
        [tableId]: [...(current.drafts[tableId] ?? []), ...draft],
      },
    }));
    await get().loadActiveOrder();
  },

  setSelectedCategoryId: (selectedCategoryId) => set({ selectedCategoryId }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  openModifierModal: (product) => set({ activeModifierProduct: product }),

  // Okunamayan seçenek "seçenek yok" sayılmaz: zorunlu seçim atlanırdı.
  loadModifierGroups: async (productId) => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const groups = await invokeIPC<ModifierGroupWire[]>('get_product_modifiers', { productId, tenantId, actorRole });
      return groups.map((group) => ({
        id: group.id,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections ?? group.options.length,
        options: group.options.map((option) => ({
          id: option.id,
          name: option.name,
          priceDeltaCents: option.priceCents,
        })),
      }));
    } catch (error) {
      set({ orderError: String(error) });
      return null;
    }
  },

  closeModifierModal: () => set({ activeModifierProduct: null }),

  selectTicketItem: (selectedTicketItemId) => set({ selectedTicketItemId }),

  addItemToTicket: (product, selectedModifiers = [], cookingDegree, notes) => {
    const taxRateBp = product.taxRateBp ?? Math.round(product.vatRate * 100);
    const unitPrice = selectedModifiers.reduce((sum, m) => sum + m.priceDeltaCents, product.unitPriceCents);
    set((state) => {
      const draft = draftOf(state);
      const isPlain = selectedModifiers.length === 0 && !cookingDegree && !notes;
      const same = isPlain
        ? draft.find((i) => i.productId === product.id && !i.notes && !i.cookingDegree &&
            i.selectedModifiers.length === 0)
        : undefined;
      if (same) {
        const quantity = same.quantity + 1;
        const totalCents = lineTotalCents(same.unitPriceCents, quantity);
        return withDraft(state, draft.map((i) => (i === same ? { ...i, quantity, totalCents } : i)));
      }
      const item: OrderItem = {
        id: `drf_${crypto.randomUUID()}`,
        productId: product.id,
        name: product.name,
        quantity: 1,
        unitPriceCents: unitPrice,
        vatRate: product.vatRate,
        taxRateBp,
        station: product.station,
        cookingDegree,
        notes,
        selectedModifiers,
        totalCents: lineTotalCents(unitPrice, 1),
        isSentToKitchen: false,
      };
      return withDraft(state, [...draft, item]);
    });
  },

  // Sunucudaki kalem burada değişmez; iptal onaylı akıştan geçer.
  updateItemQty: (itemId, delta) => {
    set((state) => {
      const draft = draftOf(state)
        .map((item) => {
          if (item.id !== itemId) return item;
          const quantity = Math.max(0, item.quantity + delta);
          const totalCents = lineTotalCents(item.unitPriceCents, quantity);
          return { ...item, quantity, totalCents };
        })
        .filter((item) => item.quantity > 0);
      return withDraft(state, draft);
    });
  },

  removeItem: (itemId) => {
    set((state) => ({
      ...withDraft(state, draftOf(state).filter((item) => item.id !== itemId)),
      selectedTicketItemId: state.selectedTicketItemId === itemId ? null : state.selectedTicketItemId,
    }));
  },

  setItemNote: (itemId, notes) => {
    set((state) => withDraft(state, draftOf(state).map((i) => (i.id === itemId ? { ...i, notes } : i))));
  },

  clearTicket: () => {
    set((state) => ({ ...withDraft(state, []), selectedTicketItemId: null }));
  },

  setLastSale: (lastSale) => set({ lastSale }),

  sendToKitchen: async () => {
    const state = get();
    const key = orderKey(state);
    const draft = draftOf(state);
    if (!key || draft.length === 0 || state.isSending) return false;
    const { actorId, actorRole, tenantId } = sessionArgs();
    const alreadySent = new Set(state.ticketItems.filter((item) => item.isSentToKitchen).map((item) => item.id));
    set({ isSending: true, orderError: null });
    try {
      await invokeIPC('submit_order', {
        payload: { orderId: '', tableId: key, items: draft.map(toSubmitItem), notes: null, waiterId: actorId, guestCount: state.guestCount },
        tenantId,
        actorId,
        actorRole,
      });
      set((current) => ({ drafts: { ...current.drafts, [key]: [] } }));
      await get().loadActiveOrder();
      // Kayıt = istasyon fişi: yeni sunucu kalemleri yazıcıya gider, hatası kalıcı uyarı olur.
      const after = get();
      const fresh = after.ticketItems.filter((item) => item.isSentToKitchen && !alreadySent.has(item.id)).map((item) => item.id);
      await printKitchenTickets(after.activeOrderId, fresh, actorRole, tenantId);
      return true;
    } catch (error) {
      // Taslak durur; yeniden denemeden önce sunucu görünümü tazelenir ki
      // sonucu belirsiz gönderim ikinci kez yazılmasın. Başarılı okuma hatayı
      // silmesin diye mesaj tazelemeden sonra yazılır.
      await get().loadActiveOrder();
      set({ orderError: orderErrorText(error, 'sipariş gönderilmedi, taslak bu cihazda duruyor') });
      return false;
    } finally {
      set({ isSending: false });
    }
  },

  // Kalan bakiye sunucudandır; yalnız gönderilmemiş taslak üstüne eklenir.
  calculateTotalCents: () => {
    const state = get();
    const pending = draftOf(state).reduce((sum, item) => sum + item.totalCents, 0);
    return (state.balance?.remainingCents ?? 0) + pending;
  },
}));
