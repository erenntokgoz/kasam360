import { create } from 'zustand';
import { IPOSRepository } from '../../domain/repositories/IPOSRepository';
import {
  CartItem,
  CartTotals,
  ItemDiscount,
  PaymentMethod,
  PaymentPayload,
  PaymentResult,
  POSCategory,
  POSProduct,
  SplitPaymentDetail,
  ModifierOption,
} from '../types';
import { TauriPOSRepository } from '../../data/ipc/TauriPOSRepository';

const getRepo = (stateRepo?: IPOSRepository | null): IPOSRepository => {
  return stateRepo || TauriPOSRepository.getInstance();
};

/**
 * NOT: Modül yükleme sırasında TauriPOSRepository.getInstance() fonksiyonunu ÇAĞIRMAYIN.
 * Tauri WebView IPC köprüsü (window.__TAURI_INTERNALS__) JS paketi değerlendirildikten
 * SONRA asenkron olarak enjekte edilir. Bu enjeksiyondan önce invoke() fonksiyonuna erişmek
 * şu hataya neden olur:
 *   TypeError: Cannot read properties of undefined (reading 'invoke')
 * Aşağıdaki posRepository alanı null olarak başlatılır ve uygulama giriş noktasından
 * çağrılan setPOSRepository() aracılığıyla ilk kullanımda tembel olarak doldurulur.
 */

export function calculateItemAmounts(
  unitPrice: number,
  quantity: number,
  taxRate: number,
  discount?: ItemDiscount
): { subtotal: number; taxAmount: number; total: number; discountAmount: number } {
  const grossCents = Math.round(unitPrice) * Math.round(quantity);
  let discountAmountCents = 0;

  if (discount && discount.value > 0) {
    if (discount.type === 'PERCENTAGE') {
      discountAmountCents = Math.round(grossCents * (Math.min(100, discount.value) / 100));
    } else if (discount.type === 'FIXED_AMOUNT') {
      discountAmountCents = Math.min(Math.round(discount.value), grossCents);
    }
  }

  const subtotalCents = Math.round(Math.max(0, grossCents - discountAmountCents));
  const taxAmountCents = Math.round(subtotalCents * (taxRate / 100));
  const totalCents = Math.round(subtotalCents + taxAmountCents);

  return {
    subtotal: subtotalCents,
    taxAmount: taxAmountCents,
    total: totalCents,
    discountAmount: discountAmountCents,
  };
}

export interface CartStoreState {
  currentView: 'FLOOR' | 'POS' | 'MANAGEMENT' | 'KDS' | 'RECEIPTS' | 'END_OF_DAY' | 'OWNER_DASHBOARD' | 'CASHIER' | 'PLATFORM';
  activeTableId: string | null;
  navigate: (view: 'FLOOR' | 'POS' | 'MANAGEMENT' | 'KDS' | 'RECEIPTS' | 'END_OF_DAY' | 'OWNER_DASHBOARD' | 'CASHIER' | 'PLATFORM') => void;
  selectTable: (tableId: string) => Promise<void>;

  items: CartItem[];
  selectedItemId: string | null;
  globalDiscount: ItemDiscount | undefined;
  orderNote: string;
  customerRef: string;

  products: POSProduct[];
  categories: POSCategory[];
  activeCategory: string;
  searchQuery: string;
  isLoadingCatalog: boolean;
  catalogError: string | null;

  isPaymentModalOpen: boolean;
  isProcessingPayment: boolean;
  lastPaymentResult: PaymentResult | null;

  /**
   * Aşama 2 — Etki eşitsizliği (Idempotency) koruması.
   * Her ödeme gönderim denemesi için oluşturulan bir UUID. Arka ucun (backend)
   * yinelenen gönderimleri tespit edip reddedebilmesi için veri yüküne (payload) eklenir.
   * Bir sonuç (başarı veya başarısızlık) alındıktan sonra null olarak sıfırlanır.
   */
  idempotencyKey: string | null;

  /**
   * Aşama 2 — Çifte gönderim koruması.
   * processPayment girişinde senkron olarak true değerine ayarlanır ve
   * finally bloğunda temizlenir. True iken yapılan herhangi bir yeniden giriş anında
   * geri dönerek, aynı store örneğinden çift tıklamaları ve eşzamanlı gönderimleri engeller.
   */
  isSubmitting: boolean;

  // Temiz Mimari Soyut Depo Köprüsü
  posRepository: IPOSRepository;

  getTotals: () => CartTotals;

  addItem: (product: POSProduct, quantity?: number, modifiers?: ModifierOption[], note?: string) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  incrementQuantity: (itemId: string) => void;
  decrementQuantity: (itemId: string) => void;
  applyItemDiscount: (itemId: string, discount: ItemDiscount | undefined) => void;
  applyGlobalDiscount: (discount: ItemDiscount | undefined) => void;
  setItemNote: (itemId: string, note?: string) => void;
  selectItem: (itemId: string | null) => void;
  clearCart: () => void;
  setOrderNote: (note: string) => void;
  setCustomerRef: (ref: string) => void;

  setActiveCategory: (category: string) => void;
  setSearchQuery: (query: string) => void;
  fetchCatalog: (category?: string, query?: string) => Promise<void>;
  fetchCategories: () => Promise<void>;
  scanBarcode: (barcode: string) => Promise<boolean>;

  setPaymentModalOpen: (isOpen: boolean) => void;
  processPayment: (
    method: PaymentMethod,
    amountTendered: number,
    splits?: SplitPaymentDetail[]
  ) => Promise<PaymentResult>;

  // Temiz Mimari ve Birim Testi için Bağımlılık Enjeksiyonu
  setPOSRepository: (repo: IPOSRepository) => void;

  submitOrder: () => Promise<void>;
  voidOrder: (tableId: string, orderId: string, reason: string, actorRole: string, managerPin?: string) => Promise<void>;
}


export const useCartStore = create<CartStoreState>((set, get) => ({
  currentView: 'FLOOR',
  activeTableId: null,

  items: [],
  selectedItemId: null,
  globalDiscount: undefined,
  orderNote: '',
  customerRef: '',

  products: [],
  categories: [],
  activeCategory: 'all',
  searchQuery: '',
  isLoadingCatalog: false,
  catalogError: null,

  isPaymentModalOpen: false,
  isProcessingPayment: false,
  lastPaymentResult: null,

  // Aşama 2 denetim korumaları — boşta (idle) duruma başlatıldı
  idempotencyKey: null,
  isSubmitting: false,

  // Tembel (Lazy) singleton: TauriPOSRepository ile başlatıldı
  posRepository: TauriPOSRepository.getInstance(),
  navigate: (view: 'FLOOR' | 'POS' | 'MANAGEMENT' | 'KDS' | 'RECEIPTS' | 'END_OF_DAY' | 'OWNER_DASHBOARD' | 'CASHIER' | 'PLATFORM') => set({ currentView: view }),
  selectTable: async (tableId: string) => {
    const isCashier = get().currentView === 'CASHIER';
    set({
      activeTableId: tableId,
      customerRef: tableId,
      ...(isCashier ? {} : { currentView: 'POS' }),
      items: [], // clear cart temporarily
      selectedItemId: null,
    });
    
    try {
      const repo = getRepo(get().posRepository);
      const existingItems = await repo.getOrderItems(tableId);
      if (existingItems && existingItems.length > 0) {
        set({ items: existingItems });
      }
    } catch (e) {
      console.warn('Masaya ait siparisler yuklenemedi', e);
    }
  },

  getTotals: (): CartTotals => {
    const { items, globalDiscount } = get();

    let itemCount = 0;
    let subtotalCents = 0;
    let taxTotalCents = 0;
    let discountTotalCents = 0;

    for (const item of items) {
      itemCount += item.quantity;
      subtotalCents += item.subtotal;
      taxTotalCents += item.taxAmount;

      const rawGrossCents = item.unitPrice * item.quantity;
      discountTotalCents += (rawGrossCents - item.subtotal);
    }

    let grandTotalCents = subtotalCents + taxTotalCents;

    if (globalDiscount && globalDiscount.value > 0) {
      let gDiscountCents = 0;
      if (globalDiscount.type === 'PERCENTAGE') {
        gDiscountCents = Math.round(grandTotalCents * (Math.min(100, globalDiscount.value) / 100));
      } else {
        gDiscountCents = Math.min(globalDiscount.value, grandTotalCents);
      }
      discountTotalCents += gDiscountCents;
      grandTotalCents = Math.max(0, grandTotalCents - gDiscountCents);
    }

    return {
      itemCount,
      subtotal: Math.round(subtotalCents),
      taxTotal: Math.round(taxTotalCents),
      discountTotal: Math.round(discountTotalCents),
      grandTotal: Math.round(grandTotalCents),
    };
  },

  addItem: (product: POSProduct, quantity = 1, modifiers?: ModifierOption[], note?: string) => {
    if (quantity <= 0) return;

    set((state) => {
      // If there are modifiers or note, group only if modifiers and note match
      const modifiersKey = modifiers ? JSON.stringify(modifiers.map(m => m.id).sort()) : '';
      const trimmedNote = note?.trim() || undefined;
      
      const existingIndex = state.items.findIndex(
        (item) => item.product.id === product.id && 
                  !item.discount && 
                  (item.note || undefined) === trimmedNote &&
                  (item.modifiers ? JSON.stringify(item.modifiers.map(m => m.id).sort()) : '') === modifiersKey
      );

      // Recalculate base unit price considering modifiers
      let baseUnitPrice = product.price;
      if (modifiers && modifiers.length > 0) {
          baseUnitPrice += modifiers.reduce((sum, mod) => sum + mod.priceCents, 0);
      }

      if (existingIndex > -1) {
        const existing = state.items[existingIndex];
        const newQty = existing.quantity + quantity;
        const financials = calculateItemAmounts(
          baseUnitPrice,
          newQty,
          existing.taxRate,
          existing.discount
        );

        const updatedItems = [...state.items];
        updatedItems[existingIndex] = {
          ...existing,
          quantity: newQty,
          subtotal: financials.subtotal,
          taxAmount: financials.taxAmount,
          total: financials.total,
        };

        return {
          items: updatedItems,
          selectedItemId: existing.id,
        };
      } else {
        const financials = calculateItemAmounts(
          baseUnitPrice,
          quantity,
          product.taxRate
        );

        const itemId = crypto.randomUUID();
        const newItem: CartItem = {
          id: itemId,
          product,
          quantity,
          unitPrice: baseUnitPrice,
          taxRate: product.taxRate,
          subtotal: financials.subtotal,
          taxAmount: financials.taxAmount,
          total: financials.total,
          modifiers,
          note: trimmedNote,
        };

        return {
          items: [...state.items, newItem],
          selectedItemId: itemId,
        };
      }
    });
  },

  removeItem: (itemId: string) => {
    set((state) => ({
      items: state.items.filter((item) => item.id !== itemId),
      selectedItemId: state.selectedItemId === itemId ? null : state.selectedItemId,
    }));
  },

  updateQuantity: (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(itemId);
      return;
    }

    set((state) => {
      const updatedItems = state.items.map((item) => {
        if (item.id !== itemId) return item;

        const financials = calculateItemAmounts(
          item.unitPrice,
          quantity,
          item.taxRate,
          item.discount
        );

        return {
          ...item,
          quantity,
          subtotal: financials.subtotal,
          taxAmount: financials.taxAmount,
          total: financials.total,
        };
      });

      return { items: updatedItems };
    });
  },

  incrementQuantity: (itemId: string) => {
    const item = get().items.find((i) => i.id === itemId);
    if (item) {
      get().updateQuantity(itemId, item.quantity + 1);
    }
  },

  decrementQuantity: (itemId: string) => {
    const item = get().items.find((i) => i.id === itemId);
    if (item) {
      get().updateQuantity(itemId, item.quantity - 1);
    }
  },

  applyItemDiscount: (itemId: string, discount: ItemDiscount | undefined) => {
    set((state) => {
      const updatedItems = state.items.map((item) => {
        if (item.id !== itemId) return item;

        const financials = calculateItemAmounts(
          item.unitPrice,
          item.quantity,
          item.taxRate,
          discount
        );

        return {
          ...item,
          discount,
          subtotal: financials.subtotal,
          taxAmount: financials.taxAmount,
          total: financials.total,
        };
      });

      return { items: updatedItems };
    });
  },

  applyGlobalDiscount: (discount: ItemDiscount | undefined) => {
    set({ globalDiscount: discount });
  },

  setItemNote: (itemId: string, note?: string) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === itemId ? { ...item, note } : item)),
    }));
  },

  selectItem: (itemId: string | null) => {
    set({ selectedItemId: itemId });
  },

  clearCart: () => {
    set({
      activeTableId: null,
      items: [],
      selectedItemId: null,
      globalDiscount: undefined,
      orderNote: '',
      customerRef: '',
    });
  },

  setOrderNote: (note: string) => set({ orderNote: note }),
  setCustomerRef: (ref: string) => set({ customerRef: ref }),

  setActiveCategory: (category: string) => {
    set({ activeCategory: category });
    void get().fetchCatalog(category, get().searchQuery);
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    void get().fetchCatalog(get().activeCategory, query);
  },

  fetchCatalog: async (category?: string, query?: string) => {
    set({ isLoadingCatalog: true, catalogError: null });
    try {
      const repo = getRepo(get().posRepository);
      const targetCategory = category ?? get().activeCategory;
      const targetQuery = query ?? get().searchQuery;
      const products = await repo.getProducts(targetCategory, targetQuery);
      set({ products, isLoadingCatalog: false });
    } catch (error) {
      set({
        catalogError: error instanceof Error ? error.message : 'Ürün kataloğu yüklenemedi.',
        isLoadingCatalog: false,
      });
    }
  },

  fetchCategories: async () => {
    try {
      const repo = getRepo(get().posRepository);
      const categories = await repo.getCategories();
      set({ categories });
    } catch (error) {
      console.warn('Failed to fetch categories:', error);
    }
  },

  scanBarcode: async (barcode: string): Promise<boolean> => {
    try {
      const repo = getRepo(get().posRepository);
      const product = await repo.getProductByBarcode(barcode);
      if (product) {
        get().addItem(product, 1);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  setPaymentModalOpen: (isOpen: boolean) => {
    set({ isPaymentModalOpen: isOpen });
  },

  processPayment: async (
    method: PaymentMethod,
    amountTendered: number,
    splits?: SplitPaymentDetail[]
  ): Promise<PaymentResult> => {
    // Aşama 2: Çifte gönderim koruması — herhangi bir await'ten önce senkron kontrol
    if (get().isSubmitting) {
      return {
        success: false,
        transactionId: '',
        timestamp: new Date().toISOString(),
        message: 'Ödeme işlemi zaten devam ediyor. Lütfen bekleyin.',
      };
    }

    const { items, globalDiscount, getTotals, orderNote, customerRef, posRepository } = get();
    const totals = getTotals();

    if (items.length === 0) {
      throw new Error('Sepet boşken ödeme alınamaz.');
    }

    if (amountTendered < totals.grandTotal && method !== 'SPLIT') {
      throw new Error('Alınan tutar toplam tutardan az olamaz.');
    }

    const idempotencyKey = crypto.randomUUID();

    set({ isSubmitting: true, isProcessingPayment: true, idempotencyKey });

    const repo = getRepo(posRepository);
    const user = (await import('../store/useAuthStore')).useAuthStore.getState().user;

    const payload: PaymentPayload = {
      transactionId: `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      orderId: `ORD_${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      method,
      amountTendered,
      totalAmount: totals.grandTotal,
      changeAmount: Math.max(0, amountTendered - totals.grandTotal),
      items,
      splits,
      notes: orderNote,
      customerRef: customerRef || undefined,
      cashierId: user?.userId || 'CASHIER_01',
      terminalId: 'POS_MAIN_01',
      idempotencyKey,
      globalDiscount: globalDiscount || undefined,
    };

    try {
      const isSplit = method === 'SPLIT' || (splits && splits.length > 0);
      const result = isSplit
        ? await repo.processSplitPayment(payload)
        : await repo.processPayment(payload);

      set({
        lastPaymentResult: result,
        isProcessingPayment: false,
      });

      if (result.success) {
        get().clearCart();
        repo.printReceipt(payload).catch(e => console.error('Print receipt failed', e));
      }

      return result;
    } catch (err) {
      const failure: PaymentResult = {
        success: false,
        transactionId: payload.transactionId,
        timestamp: new Date().toISOString(),
        message: err instanceof Error ? err.message : 'Ödeme işlemi başarısız oldu.',
      };
      set({ lastPaymentResult: failure, isProcessingPayment: false });
      return failure;
    } finally {
      set({ isSubmitting: false, idempotencyKey: null });
    }
  },

  setPOSRepository: (repo: IPOSRepository) => {
    set({ posRepository: repo });
  },

  submitOrder: async () => {
    if (get().isSubmitting) return;
    const { items, activeTableId, orderNote, posRepository, clearCart, navigate } = get();
    if (items.length === 0) return;

    set({ isSubmitting: true });

    const payload = {
      orderId: `ORD_${Date.now().toString().slice(-6)}`,
      tableId: activeTableId || 'HIZLI_SATIS',
      items,
      notes: orderNote,
    };

    try {
      const repo = getRepo(posRepository);
      const success = await repo.submitOrder(payload);
      if (success) {
        clearCart();
        if (activeTableId) {
          navigate('FLOOR');
        }
      }
    } catch (err) {
      console.error('Sipariş onaylanırken hata:', err);
      throw err;
    } finally {
      set({ isSubmitting: false });
    }
  },

  voidOrder: async (tableId: string, orderId: string, reason: string, actorRole: string, managerPin?: string) => {
    if (get().isSubmitting) return;
    set({ isSubmitting: true });

    try {
      const repo = getRepo(get().posRepository);
      const user = (await import('../store/useAuthStore')).useAuthStore.getState().user;
      const success = await repo.voidOrder({
        tableId,
        orderId,
        reason,
        actorId: user?.userId || 'CASHIER_01',
        actorRole: actorRole || user?.role || 'CASHIER',
        managerPin,
      });
      if (success) {
        get().clearCart();
        get().navigate('FLOOR');
      }
    } catch (err) {
      console.error('Sipariş iptal edilirken hata:', err);
      throw err;
    } finally {
      set({ isSubmitting: false });
    }
  },
}));
