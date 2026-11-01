import { create } from 'zustand';
import type { KdsTicket, KdsItemStatus } from '../types/kds';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { useUIStore } from './uiStore';

interface KdsItemWire {
  id: string;
  name: string;
  quantity: number;
  status?: string | null;
  station?: string | null;
  notes?: string | null;
  modifiers?: string[] | null;
}

interface KdsOrderWire {
  id: string;
  orderNumber: string;
  tableNumber?: string | null;
  waiterName?: string | null;
  items: KdsItemWire[];
  createdAt: string;
  elapsedSeconds: number;
}

const ITEM_STATUS: Record<string, KdsItemStatus> = {
  PENDING: 'PENDING',
  PREPARING: 'PREPARING',
  READY: 'READY',
  SERVED: 'SERVED',
  COMPLETED: 'SERVED',
};

const WIRE_STATUS: Record<KdsItemStatus, string> = {
  PENDING: 'Pending',
  PREPARING: 'Preparing',
  READY: 'Ready',
  SERVED: 'Served',
};

function stationOf(value?: string | null): 'MUTFAK' | 'BAR' | 'TATLI' {
  const upper = (value ?? '').toLocaleUpperCase('tr-TR');
  return upper === 'BAR' || upper === 'TATLI' ? upper : 'MUTFAK';
}

const statusOf = (item: KdsItemWire): KdsItemStatus => ITEM_STATUS[(item.status ?? 'PENDING').toUpperCase()] ?? 'PENDING';

/** Her istasyon kendi biletini görür; adisyon istasyonlara bölünür. */
export function mapKdsOrders(orders: KdsOrderWire[]): KdsTicket[] {
  return orders.flatMap((order) => {
    // Teslim edilen kalem ekranda kalmaz: biten istasyonun fişi de kapanır.
    const open = order.items.filter((item) => statusOf(item) !== 'SERVED');
    const stations = [...new Set(open.map((item) => stationOf(item.station)))];
    return stations.map((station) => ({
      id: `${order.id}:${station}`,
      orderId: order.id,
      ticketNumber: order.orderNumber,
      tableName: order.tableNumber ?? 'Tezgâh',
      waiterName: order.waiterName ?? undefined,
      station,
      createdAt: order.createdAt,
      elapsedMinutes: Math.floor(order.elapsedSeconds / 60),
      items: open
        .filter((item) => stationOf(item.station) === station)
        .map((item) => ({
          id: item.id,
          orderItemId: item.id,
          productName: item.name,
          quantity: item.quantity,
          station,
          modifiers: item.modifiers ?? [],
          notes: item.notes ?? undefined,
          status: statusOf(item),
        })),
    }));
  });
}

export type KdsTicketStage = 'PENDING' | 'PREPARING' | 'READY';

/** Fişin tek düğmesi bu aşamaya göre ilerler. */
export function ticketStage(ticket: KdsTicket): KdsTicketStage {
  if (ticket.items.every((item) => item.status === 'READY')) return 'READY';
  return ticket.items.some((item) => item.status !== 'PENDING') ? 'PREPARING' : 'PENDING';
}

const NEXT_ITEM_STATUS: Record<KdsTicketStage, KdsItemStatus> = {
  PENDING: 'PREPARING',
  PREPARING: 'READY',
  READY: 'SERVED',
};

interface KdsStore {
  tickets: KdsTicket[];
  hasLoaded: boolean;
  selectedStation: 'TUMU' | 'MUTFAK' | 'BAR' | 'TATLI';
  activeStations: Record<'MUTFAK' | 'BAR' | 'TATLI', boolean>;
  soundEnabled: boolean;
  loadTickets: () => Promise<void>;
  setSelectedStation: (station: 'TUMU' | 'MUTFAK' | 'BAR' | 'TATLI') => void;
  setStationActive: (station: 'MUTFAK' | 'BAR' | 'TATLI', active: boolean) => void;
  toggleItemStatus: (ticketId: string, itemId: string) => Promise<void>;
  advanceTicket: (ticketId: string) => Promise<void>;
  toggleSound: () => void;
  playOrderBell: () => void;
}

export const useKdsStore = create<KdsStore>((set, get) => ({
  tickets: [],
  hasLoaded: false,
  selectedStation: 'TUMU',
  activeStations: {
    MUTFAK: true, // Mutfakta aktif ekran oturumu var
    BAR: true, // Barda aktif ekran oturumu var
    TATLI: false, // Tatlı istasyonunda ekran yok -> sipariş doğrudan termal yazıcıya uçar
  },
  soundEnabled: true,

  loadTickets: async () => {
    const { actorRole, tenantId } = sessionArgs();
    const orders = await invokeIPC<KdsOrderWire[]>('get_active_tickets', { tenantId, actorRole });
    const known = new Set(get().tickets.map((ticket) => ticket.id));
    const tickets = mapKdsOrders(orders);
    set({ tickets });
    // Mutfak sayfasında yeni fiş zil çalar; ilk yüklemede eski fişler için çalmaz.
    if (get().hasLoaded && useUIStore.getState().activeModule === 'KDS' && tickets.some((ticket) => !known.has(ticket.id))) {
      get().playOrderBell();
    }
    set({ hasLoaded: true });
  },

  setSelectedStation: (selectedStation) => set({ selectedStation }),

  setStationActive: (station, active) =>
    set((state) => ({
      activeStations: { ...state.activeStations, [station]: active },
    })),

  // Durum sunucuya yazılmadan ekranda ilerlemez; yoksa diğer ekranlar ayrışır.
  toggleItemStatus: async (ticketId, itemId) => {
    // Kaleme dokunmak hazırlık durumunu değiştirir; teslim fiş düğmesiyle yapılır.
    const nextStatus: Record<KdsItemStatus, KdsItemStatus> = {
      PENDING: 'PREPARING',
      PREPARING: 'READY',
      READY: 'PREPARING',
      SERVED: 'READY',
    };
    const item = get().tickets.find((t) => t.id === ticketId)?.items.find((i) => i.id === itemId);
    if (!item) return;
    const { actorRole, tenantId } = sessionArgs();
    await invokeIPC('update_kds_item_status', {
      payload: { itemId, status: WIRE_STATUS[nextStatus[item.status]] },
      tenantId,
      actorRole,
    });
    await get().loadTickets();
  },

  advanceTicket: async (ticketId) => {
    const ticket = get().tickets.find((t) => t.id === ticketId);
    if (!ticket) return;
    const { actorRole, tenantId } = sessionArgs();
    const stage = ticketStage(ticket);
    const target = NEXT_ITEM_STATUS[stage];
    // Hazır bekleyen kalem geriye dönmesin diye yalnız bu aşamada ilerleyecekler yazılır.
    const items = stage === 'PENDING' ? ticket.items.filter((item) => item.status === 'PENDING') : ticket.items.filter((item) => item.status !== target);
    for (const item of items) {
      await invokeIPC('update_kds_item_status', {
        payload: { itemId: item.id, status: WIRE_STATUS[target] },
        tenantId,
        actorRole,
      });
    }
    await get().loadTickets();
  },

  toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),

  playOrderBell: () => {
    if (!get().soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.35);

      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    } catch {
      // Audio context policy fallback
    }
  },
}));
