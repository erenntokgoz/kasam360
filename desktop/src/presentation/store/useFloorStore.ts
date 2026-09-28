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

export interface FloorStoreState {
  tables: FloorPlanData[];
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
  reserveTable: (tableId: string) => Promise<void>;
  getTableReadyStatus: (tableId: string) => Promise<string>;
  pollReadyStatuses: () => Promise<Record<string, boolean>>;
  waiterClockIn: (waiterId?: string) => Promise<string>;
  setIsClockedIn: (val: boolean) => void;
  clearError: () => void;
}

export const useFloorStore = create<FloorStoreState>((set, get) => ({
  tables: [],
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

  reserveTable: async (tableId: string) => {
    set({ isLoading: true, error: null });
    try {
      const user = useAuthStore.getState().user;
      const tenantId = user?.tenantId || 'DEFAULT_TENANT';
      await invoke('reserve_table', { tableId, tenantId });
      const data = await invoke<FloorPlanData[]>('get_floor_plan', { tenantId });
      set({ tables: data || [], isLoading: false });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg, isLoading: false });
      throw error;
    }
  },

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
