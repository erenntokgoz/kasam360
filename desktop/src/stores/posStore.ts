import { create } from 'zustand';
import type { ProductCategory, Product, OrderItem, OrderItemModifier } from '../types/pos';
import { invokeIPC } from '../services/tauriClient';
import { INITIAL_DEMO_TICKETS } from '../services/mockOrders';

interface PosStore {
  activeTableId: string | null;
  activeTableName: string;
  isWalkin: boolean;
  guestCount: number;
  categories: ProductCategory[];
  products: Product[];
  selectedCategoryId: string;
  searchQuery: string;
  ticketItems: OrderItem[];
  tableTickets: Record<string, OrderItem[]>;
  tablePaidCents: Record<string, number>;
  activeModifierProduct: Product | null;
  selectedTicketItemId: string | null;

  loadCatalog: () => Promise<void>;
  openOrderForTable: (tableId: string, tableName: string, guests?: number) => void;
  openWalkinOrder: () => void;
  bindWalkinToTable: (tableId: string, tableName: string) => void;
  getTableTicketItems: (tableId: string) => OrderItem[];
  setSelectedCategoryId: (catId: string) => void;
  setSearchQuery: (query: string) => void;
  openModifierModal: (product: Product) => void;
  closeModifierModal: () => void;
  selectTicketItem: (itemId: string | null) => void;
  addItemToTicket: (
    product: Product,
    selectedModifiers?: OrderItemModifier[],
    cookingDegree?: string,
    course?: 1 | 2 | 3,
    notes?: string
  ) => void;
  updateItemQty: (itemId: string, delta: number) => void;
  removeItem: (itemId: string) => void;
  setItemCourse: (itemId: string, course: 1 | 2 | 3) => void;
  setItemNote: (itemId: string, notes: string) => void;
  deductPaidItems: (selectedQuantities: Record<string, number>) => void;
  deductPaidAmount: (amountCents: number) => void;
  clearTicket: () => void;
  markItemsSentToKitchen: () => void;
  calculateSubtotalCents: () => number;
  calculateTaxCents: () => number;
  calculateTotalCents: () => number;
}

export const usePosStore = create<PosStore>((set, get) => ({
  activeTableId: 'tbl_01',
  activeTableName: 'Masa 01',
  isWalkin: false,
  guestCount: 2,
  categories: [],
  products: [],
  selectedCategoryId: 'cat_all',
  searchQuery: '',
  ticketItems: [],
  tableTickets: { ...INITIAL_DEMO_TICKETS },
  tablePaidCents: {},
  activeModifierProduct: null,
  selectedTicketItemId: null,

  loadCatalog: async () => {
    const [cats, prods] = await Promise.all([
      invokeIPC<ProductCategory[]>('pos_get_categories'),
      invokeIPC<Product[]>('pos_get_products'),
    ]);
    set({ categories: cats || [], products: prods || [] });
  },

  openOrderForTable: (tableId, tableName, guests = 2) => {
    const currentKey = get().isWalkin ? 'walkin' : (get().activeTableId || 'tbl_01');
    const updatedMap = {
      ...get().tableTickets,
      [currentKey]: get().ticketItems,
    };

    const targetItems = updatedMap[tableId] || [];

    set({
      activeTableId: tableId,
      activeTableName: tableName,
      isWalkin: false,
      guestCount: guests,
      selectedTicketItemId: null,
      tableTickets: updatedMap,
      ticketItems: targetItems,
    });
  },

  openWalkinOrder: () => {
    const currentKey = get().isWalkin ? 'walkin' : (get().activeTableId || 'tbl_01');
    const updatedMap = {
      ...get().tableTickets,
      [currentKey]: get().ticketItems,
    };

    const walkinItems = updatedMap['walkin'] || [];

    set({
      activeTableId: null,
      activeTableName: 'Tezgah Satışı (Al-Götür)',
      isWalkin: true,
      guestCount: 1,
      selectedTicketItemId: null,
      tableTickets: updatedMap,
      ticketItems: walkinItems,
    });
  },

  bindWalkinToTable: (tableId, tableName) => {
    const walkinItems = get().ticketItems;
    set((state) => ({
      activeTableId: tableId,
      activeTableName: tableName,
      isWalkin: false,
      tableTickets: {
        ...state.tableTickets,
        [tableId]: [...(state.tableTickets[tableId] || []), ...walkinItems],
        walkin: [],
      },
      ticketItems: [...(state.tableTickets[tableId] || []), ...walkinItems],
    }));
  },

  getTableTicketItems: (tableId: string) => {
    if (get().activeTableId === tableId) {
      return get().ticketItems;
    }
    return get().tableTickets[tableId] || [];
  },

  setSelectedCategoryId: (selectedCategoryId) => set({ selectedCategoryId }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  openModifierModal: (product) => set({ activeModifierProduct: product }),

  closeModifierModal: () => set({ activeModifierProduct: null }),

  selectTicketItem: (selectedTicketItemId) => set({ selectedTicketItemId }),

  addItemToTicket: (product, selectedModifiers = [], cookingDegree, course = 1, notes) => {
    const modifierTotalCents = selectedModifiers.reduce((acc, m) => acc + m.priceDeltaCents, 0);
    const unitPriceWithMods = product.unitPriceCents + modifierTotalCents;

    set((state) => {
      const hasCustomization =
        selectedModifiers.length > 0 || !!cookingDegree || !!notes || course !== 1;

      if (!hasCustomization) {
        const existingIdx = state.ticketItems.findIndex(
          (i) => i.productId === product.id && !i.notes && !i.cookingDegree && i.course === 1
        );
        if (existingIdx >= 0) {
          const updated = [...state.ticketItems];
          const item = updated[existingIdx];
          const newQty = item.quantity + 1;
          updated[existingIdx] = {
            ...item,
            quantity: newQty,
            totalCents: newQty * item.unitPriceCents,
          };
          const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
          return {
            ticketItems: updated,
            tableTickets: { ...state.tableTickets, [currentKey]: updated },
          };
        }
      }

      const newItem: OrderItem = {
        id: `oi_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        productId: product.id,
        name: product.name,
        quantity: 1,
        unitPriceCents: unitPriceWithMods,
        vatRate: product.vatRate,
        station: product.station,
        course,
        cookingDegree,
        notes,
        selectedModifiers,
        totalCents: unitPriceWithMods,
        isSentToKitchen: false,
      };

      const updated = [...state.ticketItems, newItem];
      const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
      return {
        ticketItems: updated,
        tableTickets: { ...state.tableTickets, [currentKey]: updated },
      };
    });
  },

  updateItemQty: (itemId, delta) => {
    set((state) => {
      const updated = state.ticketItems
        .map((i) => {
          if (i.id === itemId) {
            const newQty = Math.max(0, i.quantity + delta);
            return {
              ...i,
              quantity: newQty,
              totalCents: newQty * i.unitPriceCents,
            };
          }
          return i;
        })
        .filter((i) => i.quantity > 0);

      const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
      return {
        ticketItems: updated,
        tableTickets: { ...state.tableTickets, [currentKey]: updated },
      };
    });
  },

  removeItem: (itemId) => {
    set((state) => {
      const updated = state.ticketItems.filter((i) => i.id !== itemId);
      const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
      return {
        ticketItems: updated,
        tableTickets: { ...state.tableTickets, [currentKey]: updated },
        selectedTicketItemId: state.selectedTicketItemId === itemId ? null : state.selectedTicketItemId,
      };
    });
  },

  setItemCourse: (itemId, course) => {
    set((state) => {
      const updated = state.ticketItems.map((i) => (i.id === itemId ? { ...i, course } : i));
      const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
      return {
        ticketItems: updated,
        tableTickets: { ...state.tableTickets, [currentKey]: updated },
      };
    });
  },

  setItemNote: (itemId, notes) => {
    set((state) => {
      const updated = state.ticketItems.map((i) => (i.id === itemId ? { ...i, notes } : i));
      const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
      return {
        ticketItems: updated,
        tableTickets: { ...state.tableTickets, [currentKey]: updated },
      };
    });
  },

  deductPaidItems: (selectedQuantities: Record<string, number>) => {
    set((state) => {
      const updated = state.ticketItems
        .map((item) => {
          const qtyToDeduct = selectedQuantities[item.id] || 0;
          if (qtyToDeduct <= 0) return item;
          const remainingQty = Math.max(0, item.quantity - qtyToDeduct);
          return {
            ...item,
            quantity: remainingQty,
            totalCents: remainingQty * item.unitPriceCents,
          };
        })
        .filter((item) => item.quantity > 0);

      const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
      return {
        ticketItems: updated,
        tableTickets: { ...state.tableTickets, [currentKey]: updated },
      };
    });
  },

  deductPaidAmount: (amountCents: number) => {
    set((state) => {
      const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
      const currentPaid = state.tablePaidCents[currentKey] || 0;
      return {
        tablePaidCents: {
          ...state.tablePaidCents,
          [currentKey]: currentPaid + amountCents,
        },
      };
    });
  },

  clearTicket: () => {
    set((state) => {
      const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
      return {
        ticketItems: [],
        selectedTicketItemId: null,
        tableTickets: { ...state.tableTickets, [currentKey]: [] },
        tablePaidCents: { ...state.tablePaidCents, [currentKey]: 0 },
      };
    });
  },

  markItemsSentToKitchen: () => {
    set((state) => {
      const updated = state.ticketItems.map((i) => ({ ...i, isSentToKitchen: true }));
      const currentKey = state.isWalkin ? 'walkin' : (state.activeTableId || 'tbl_01');
      return {
        ticketItems: updated,
        tableTickets: { ...state.tableTickets, [currentKey]: updated },
      };
    });
  },

  calculateSubtotalCents: () => {
    const total = get().calculateTotalCents();
    return Math.round(total / 1.1);
  },

  calculateTaxCents: () => {
    const total = get().calculateTotalCents();
    const subtotal = get().calculateSubtotalCents();
    return total - subtotal;
  },

  calculateTotalCents: () => {
    const currentKey = get().isWalkin ? 'walkin' : (get().activeTableId || 'tbl_01');
    const grossTotal = get().ticketItems.reduce((acc, i) => acc + i.totalCents, 0);
    const paid = get().tablePaidCents[currentKey] || 0;
    return Math.max(0, grossTotal - paid);
  },
}));
