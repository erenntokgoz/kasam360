import { create } from 'zustand';
import type { KdsTicket, KdsItemStatus } from '../types/kds';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';

interface KdsItemWire {
  id: string;
  name: string;
  quantity: number;
  status?: string | null;
  station?: string | null;
  notes?: string | null;
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
  return value === 'BAR' || value === 'TATLI' ? value : 'MUTFAK';
}

/** Her istasyon kendi biletini görür; adisyon istasyonlara bölünür. */
export function mapKdsOrders(orders: KdsOrderWire[]): KdsTicket[] {
  return orders.flatMap((order, index) => {
    const stations = [...new Set(order.items.map((item) => stationOf(item.station)))];
    return stations.map((station) => ({
      id: `${order.id}:${station}`,
      orderId: order.id,
      ticketNumber: index + 1,
      tableName: order.tableNumber ?? 'Tezgâh',
      waiterName: order.waiterName ?? undefined,
      station,
      createdAt: order.createdAt,
      elapsedMinutes: Math.floor(order.elapsedSeconds / 60),
      isCompleted: false,
      items: order.items
        .filter((item) => stationOf(item.station) === station)
        .map((item) => ({
          id: item.id,
          orderItemId: item.id,
          productName: item.name,
          quantity: item.quantity,
          course: 1 as const,
          station,
          notes: item.notes ?? undefined,
          status: ITEM_STATUS[(item.status ?? 'PENDING').toUpperCase()] ?? 'PENDING',
        })),
    }));
  });
}

interface KdsStore {
  tickets: KdsTicket[];
  selectedStation: 'TUMU' | 'MUTFAK' | 'BAR' | 'TATLI';
  activeStations: Record<'MUTFAK' | 'BAR' | 'TATLI', boolean>;
  soundEnabled: boolean;
  loadTickets: () => Promise<void>;
  setSelectedStation: (station: 'TUMU' | 'MUTFAK' | 'BAR' | 'TATLI') => void;
  setStationActive: (station: 'MUTFAK' | 'BAR' | 'TATLI', active: boolean) => void;
  toggleItemStatus: (ticketId: string, itemId: string) => Promise<void>;
  completeTicket: (ticketId: string) => Promise<void>;
  recallLastTicket: () => Promise<void>;
  toggleSound: () => void;
  playOrderBell: () => void;
}

export const useKdsStore = create<KdsStore>((set, get) => ({
  tickets: [],
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
    set({ tickets: mapKdsOrders(orders) });
  },

  setSelectedStation: (selectedStation) => set({ selectedStation }),

  setStationActive: (station, active) =>
    set((state) => ({
      activeStations: { ...state.activeStations, [station]: active },
    })),

  // Durum sunucuya yazılmadan ekranda ilerlemez; yoksa diğer ekranlar ayrışır.
  toggleItemStatus: async (ticketId, itemId) => {
    const nextStatus: Record<KdsItemStatus, KdsItemStatus> = {
      PENDING: 'PREPARING',
      PREPARING: 'READY',
      READY: 'SERVED',
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

  completeTicket: async (ticketId) => {
    const ticket = get().tickets.find((t) => t.id === ticketId);
    if (!ticket) return;
    const { actorRole, tenantId } = sessionArgs();
    for (const item of ticket.items) {
      await invokeIPC('update_kds_item_status', {
        payload: { itemId: item.id, status: WIRE_STATUS.SERVED },
        tenantId,
        actorRole,
      });
    }
    await get().loadTickets();
  },

  recallLastTicket: async () => {
    const orderId = get().tickets[0]?.orderId;
    if (!orderId) return;
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('recall_kds_ticket', { orderId, actorId, actorRole, tenantId });
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
