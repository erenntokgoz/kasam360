import { create } from 'zustand';
import type { KdsTicket, KdsItemStatus } from '../types/kds';
import type { OrderItem } from '../types/pos';
import { invokeIPC } from '../services/tauriClient';

interface KdsStore {
  tickets: KdsTicket[];
  selectedStation: 'TUMU' | 'MUTFAK' | 'BAR' | 'TATLI';
  activeStations: Record<'MUTFAK' | 'BAR' | 'TATLI', boolean>;
  soundEnabled: boolean;
  loadTickets: () => Promise<void>;
  setSelectedStation: (station: 'TUMU' | 'MUTFAK' | 'BAR' | 'TATLI') => void;
  setStationActive: (station: 'MUTFAK' | 'BAR' | 'TATLI', active: boolean) => void;
  toggleItemStatus: (ticketId: string, itemId: string) => void;
  completeTicket: (ticketId: string) => Promise<void>;
  recallLastTicket: () => Promise<void>;
  toggleSound: () => void;
  playOrderBell: () => void;
  addTicketsFromOrder: (
    orderId: string,
    tableName: string,
    waiterName: string,
    items: OrderItem[]
  ) => Promise<{ addedCount: number; autoPrintedStations: string[] }>;
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
    const data = await invokeIPC<KdsTicket[]>('get_active_tickets');
    set({ tickets: data || [] });
  },

  setSelectedStation: (selectedStation) => set({ selectedStation }),

  setStationActive: (station, active) =>
    set((state) => ({
      activeStations: { ...state.activeStations, [station]: active },
    })),

  toggleItemStatus: (ticketId, itemId) => {
    const nextStatus: Record<KdsItemStatus, KdsItemStatus> = {
      PENDING: 'PREPARING',
      PREPARING: 'READY',
      READY: 'SERVED',
      SERVED: 'READY',
    };

    set((state) => ({
      tickets: state.tickets.map((t) => {
        if (t.id === ticketId) {
          const updatedItems = t.items.map((i) =>
            i.id === itemId ? { ...i, status: nextStatus[i.status] } : i
          );
          const allReady = updatedItems.every((i) => i.status === 'READY' || i.status === 'SERVED');
          return {
            ...t,
            items: updatedItems,
            isCompleted: allReady,
          };
        }
        return t;
      }),
    }));
  },

  completeTicket: async (ticketId) => {
    await invokeIPC('kds_update_ticket_status', { ticketId, isCompleted: true });
    set((state) => ({
      tickets: state.tickets.filter((t) => t.id !== ticketId),
    }));
  },

  recallLastTicket: async () => {
    await invokeIPC('recall_kds_ticket');
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

  addTicketsFromOrder: async (orderId, tableName, waiterName, items) => {
    if (!items || items.length === 0) {
      return { addedCount: 0, autoPrintedStations: [] };
    }

    const { activeStations, tickets } = get();
    const newTickets: KdsTicket[] = [];
    const autoPrintedStations: string[] = [];

    // İstasyonlara göre kalemleri grupla
    const byStation: Record<string, OrderItem[]> = {};
    for (const item of items) {
      const st = item.station || 'MUTFAK';
      if (!byStation[st]) byStation[st] = [];
      byStation[st].push(item);
    }

    let ticketSeq = tickets.length + 101;

    for (const [st, stationItems] of Object.entries(byStation)) {
      const stationKey = (st as 'MUTFAK' | 'BAR' | 'TATLI');
      const hasActiveScreen = activeStations[stationKey] ?? true;

      if (hasActiveScreen) {
        // Canlı KDS biletine ekle
        newTickets.push({
          id: `kds_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          orderId,
          ticketNumber: ticketSeq++,
          tableName,
          waiterName: waiterName || 'Garson',
          station: stationKey,
          createdAt: new Date().toISOString(),
          elapsedMinutes: 0,
          isCompleted: false,
          items: stationItems.map((si) => ({
            id: `ki_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            orderItemId: si.id,
            productName: si.name,
            quantity: si.quantity,
            course: si.course,
            station: stationKey,
            cookingDegree: si.cookingDegree,
            notes: si.notes,
            status: 'PENDING',
          })),
        });
      } else {
        // İlgili kısımda aktif ekran yok -> Otomatik termal yazıcı çıktısı
        autoPrintedStations.push(stationKey);
        try {
          await invokeIPC('print_order_slip', {
            orderId,
            station: stationKey,
            tableName,
            items: stationItems,
          });
        } catch {
          // print slip fallback
        }
      }
    }

    if (newTickets.length > 0) {
      set((state) => ({
        tickets: [...newTickets, ...state.tickets],
      }));
    }

    return { addedCount: newTickets.length, autoPrintedStations };
  },
}));
