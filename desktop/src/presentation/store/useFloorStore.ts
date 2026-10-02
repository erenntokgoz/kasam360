import { create } from 'zustand';
import { tauriInvoke as invoke } from '../../data/ipc/tauriInvoke';
import { useAuthStore } from './useAuthStore';

export interface FloorPlanData {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';
  openedAt?: string;
  waiterId?: string;
  currentTotal: number; // Kuruş (cents)
}

/// Rezervasyon kaydı. Masa durumundan **ayrı** bir varlıktır: müşteri adı, telefon,
/// kişi sayısı ve randevu saati yalnız bu kayıtta tutulur.
export interface Reservation {
  id: string;
  tableId: string;
  tableName?: string;
  status: 'ACTIVE' | 'ARRIVED' | 'SEATED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED';
  customerName: string;
  customerPhone?: string;
  partySize: number;
  reservedAt: string;
  createdAt: string;
  arrivedAt?: string;
  note?: string;
  closeReason?: string;
}

export interface ReserveTableInput {
  customerName: string;
  customerPhone?: string;
  partySize: number;
  reservedAt: string;
  note?: string;
}

export interface FloorStoreState {
  tables: FloorPlanData[];
  reservations: Reservation[];
  isLoading: boolean;
  error: string | null;
  readyStatuses: Record<string, boolean>;
  isClockedIn: boolean;

  fetchFloorPlan: () => Promise<FloorPlanData[]>;
  addTable: (id: string, name: string) => Promise<void>;
  addTablesBatch: (tables: { id: string; name: string }[]) => Promise<void>;
  removeTable: (id: string) => Promise<void>;
  updateTableName: (id: string, name: string) => Promise<void>;
  moveTable: (fromId: string, toId: string) => Promise<void>;
  mergeTables: (sourceId: string, targetId: string, actorId?: string) => Promise<void>;
  reserveTable: (tableId: string, input: ReserveTableInput) => Promise<Reservation>;
  cancelReservation: (reservationId: string) => Promise<void>;
  markReservationNoShow: (reservationId: string) => Promise<void>;
  markReservationArrived: (reservationId: string) => Promise<void>;
  fetchReservations: () => Promise<Reservation[]>;
  reservationForTable: (tableId: string) => Reservation | undefined;
  getTableReadyStatus: (tableId: string) => Promise<string>;
  pollReadyStatuses: () => Promise<Record<string, boolean>>;
  waiterClockIn: (waiterId?: string) => Promise<string>;
  setIsClockedIn: (val: boolean) => void;
  clearError: () => void;
}

/**
 * Rezervasyon sonrası salon planını ve rezervasyon listesini birlikte tazeler.
 *
 * Neden ortak yenileme: rezervasyon hem `tables.status` değerini hem de
 * `reservations` satırını değiştirir. Yalnız biri tazelenirse salon kartı ile
 * modal birbirini yalanlar (kart "Rezerve" derken liste boş kalır).
 */
const refreshFloorAndReservations = async (): Promise<{ tables: FloorPlanData[]; reservations: Reservation[] }> => {
  const user = useAuthStore.getState().user;
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';
  const [tables, reservations] = await Promise.all([
    invoke<FloorPlanData[]>('get_floor_plan', { tenantId }),
    invoke<Reservation[]>('get_reservations', { tenantId }),
  ]);
  return { tables: tables || [], reservations: reservations || [] };
};

export const useFloorStore = create<FloorStoreState>((set, get) => ({
  tables: [],
  reservations: [],
  isLoading: false,
  error: null,
  readyStatuses: {},
  isClockedIn: false,

  clearError: () => set({ error: null }),
  setIsClockedIn: (val: boolean) => set({ isClockedIn: val }),

  fetchFloorPlan: async () => {
    set({ isLoading: true, error: null });
    try {
      const user = useAuthStore.getState().user;
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      const data = await invoke<FloorPlanData[]>('get_floor_plan', { tenantId });
      set({ tables: data || [], isLoading: false });
      return data || [];
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  addTable: async (id: string, name: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('add_table', { id, name });
      const user = useAuthStore.getState().user;
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      const data = await invoke<FloorPlanData[]>('get_floor_plan', { tenantId });
      set({ tables: data || [], isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  addTablesBatch: async (tablesToAdd: { id: string; name: string }[]) => {
    set({ isLoading: true, error: null });
    try {
      for (const t of tablesToAdd) {
        await invoke('add_table', { id: t.id, name: t.name });
      }
      const user = useAuthStore.getState().user;
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      const data = await invoke<FloorPlanData[]>('get_floor_plan', { tenantId });
      set({ tables: data || [], isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  removeTable: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('remove_table', { id });
      const user = useAuthStore.getState().user;
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      const data = await invoke<FloorPlanData[]>('get_floor_plan', { tenantId });
      set({ tables: data || [], isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  updateTableName: async (id: string, name: string) => {
    set({ isLoading: true, error: null });
    try {
      const user = useAuthStore.getState().user;
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      await invoke('update_table_name', { id, name, tenantId });
      const data = await invoke<FloorPlanData[]>('get_floor_plan', { tenantId });
      set({ tables: data || [], isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  moveTable: async (fromId: string, toId: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('move_table', { fromId, toId });
      const user = useAuthStore.getState().user;
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      const data = await invoke<FloorPlanData[]>('get_floor_plan', { tenantId });
      set({ tables: data || [], isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  mergeTables: async (sourceId: string, targetId: string, actorId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const user = useAuthStore.getState().user;
      const currentActorId = actorId || user?.userId || 'MANAGER';
      await invoke('merge_tables', {
        sourceId,
        targetId,
        actorId: currentActorId,
      });
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      const data = await invoke<FloorPlanData[]>('get_floor_plan', { tenantId });
      set({ tables: data || [], isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  reserveTable: async (tableId: string, input: ReserveTableInput) => {
    set({ isLoading: true, error: null });
    try {
      const user = useAuthStore.getState().user;
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      const created = await invoke<Reservation>('reserve_table', {
        request: { tableId, ...input },
        tenantId,
      });
      const refreshed = await refreshFloorAndReservations();
      set({ tables: refreshed.tables, reservations: refreshed.reservations, isLoading: false });
      return created;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  cancelReservation: async (reservationId: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('cancel_reservation', { reservationId, reason: 'VAZGEÇILDI' });
      const refreshed = await refreshFloorAndReservations();
      set({ tables: refreshed.tables, reservations: refreshed.reservations, isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  markReservationNoShow: async (reservationId: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('mark_reservation_no_show', { reservationId });
      const refreshed = await refreshFloorAndReservations();
      set({ tables: refreshed.tables, reservations: refreshed.reservations, isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  markReservationArrived: async (reservationId: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('mark_reservation_arrived', { reservationId });
      const refreshed = await refreshFloorAndReservations();
      set({ tables: refreshed.tables, reservations: refreshed.reservations, isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

  fetchReservations: async () => {
    try {
      const user = useAuthStore.getState().user;
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      const reservations = await invoke<Reservation[]>('get_reservations', { tenantId });
      set({ reservations: reservations || [] });
      return reservations || [];
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg });
      throw error;
    }
  },

  reservationForTable: (tableId: string) =>
    get().reservations.find((reservation) => reservation.tableId === tableId),

  getTableReadyStatus: async (tableId: string) => {
    try {
      const status = await invoke<string>('get_table_ready_status', { tableId });
      return status;
    } catch (error: unknown) {
      console.error(`[useFloorStore] get_table_ready_status error for ${tableId}:`, error);
      throw error;
    }
  },

  pollReadyStatuses: async () => {
    const occupiedTables = get().tables.filter((t) => t.status === 'OCCUPIED');
    if (occupiedTables.length === 0) {
      set({ readyStatuses: {} });
      return {};
    }

    const updatedStatuses: Record<string, boolean> = { ...get().readyStatuses };
    await Promise.all(
      occupiedTables.map(async (table) => {
        try {
          const status = await invoke<string>('get_table_ready_status', { tableId: table.id });
          const isReady =
            typeof status === 'string' &&
            (status.toUpperCase() === 'READY' || status.toUpperCase() === 'HAZIR');
          updatedStatuses[table.id] = isReady;
        } catch {
          updatedStatuses[table.id] = false;
        }
      })
    );

    set({ readyStatuses: updatedStatuses });
    return updatedStatuses;
  },

  waiterClockIn: async (waiterId?: string) => {
    try {
      const user = useAuthStore.getState().user;
      const finalWaiterId = waiterId || user?.userId || 'UNKNOWN';
      const eventId = await invoke<string>('waiter_clock_in', { waiterId: finalWaiterId });
      set({ isClockedIn: true });
      return eventId;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg });
      throw error;
    }
  },
}));
