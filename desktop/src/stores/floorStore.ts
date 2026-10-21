import { create } from 'zustand';
import type { FloorTable, FloorZone, Reservation } from '../types/floor';
import { invokeIPC } from '../services/tauriClient';
import { isWithin60Minutes } from '../lib/date';

interface FloorStore {
  zones: FloorZone[];
  tables: FloorTable[];
  selectedZoneId: string | null;
  selectedTableId: string | null;
  viewMode: 'CARDS' | 'KROKI';
  isKrokiEditMode: boolean;
  reservations: Reservation[];
  isSlideOverOpen: boolean;
  loadFloorPlan: () => Promise<void>;
  setSelectedZoneId: (zoneId: string | null) => void;
  selectTable: (tableId: string | null) => void;
  openTableSlideOver: (tableId: string) => void;
  closeTableSlideOver: () => void;
  setViewMode: (mode: 'CARDS' | 'KROKI') => void;
  setKrokiEditMode: (editing: boolean) => void;
  updateTablePosition: (tableId: string, posX: number, posY: number) => void;
  saveFloorLayout: () => Promise<boolean>;
  moveTable: (sourceTableId: string, targetTableId: string) => Promise<boolean>;
  mergeTables: (sourceTableId: string, targetTableId: string) => Promise<boolean>;
  addReservation: (res: Omit<Reservation, 'id' | 'status'>) => Promise<boolean>;
  checkReservationLocks: () => void;
  updateTablePayment: (tableId: string, paidCents: number, isClosed: boolean) => void;
}

export const useFloorStore = create<FloorStore>((set, get) => ({
  zones: [],
  tables: [],
  selectedZoneId: null,
  selectedTableId: null,
  viewMode: 'CARDS',
  isKrokiEditMode: false,
  reservations: [],
  isSlideOverOpen: false,

  loadFloorPlan: async () => {
    const data = await invokeIPC<{ zones: FloorZone[]; tables: FloorTable[] }>('get_floor_plan');
    set({
      zones: data.zones || [],
      tables: data.tables || [],
    });
    get().checkReservationLocks();
  },

  setSelectedZoneId: (selectedZoneId) => set({ selectedZoneId }),

  selectTable: (selectedTableId) => set({ selectedTableId }),

  openTableSlideOver: (tableId) => {
    set({ selectedTableId: tableId, isSlideOverOpen: true });
  },

  closeTableSlideOver: () => set({ isSlideOverOpen: false }),

  setViewMode: (viewMode) => set({ viewMode }),

  setKrokiEditMode: (isKrokiEditMode) => set({ isKrokiEditMode }),

  updateTablePosition: (tableId, posX, posY) => {
    set((state) => ({
      tables: state.tables.map((t) => (t.id === tableId ? { ...t, posX, posY } : t)),
    }));
  },

  saveFloorLayout: async () => {
    try {
      await invokeIPC('save_floor_layout', { tables: get().tables });
      set({ isKrokiEditMode: false });
      return true;
    } catch {
      return false;
    }
  },

  moveTable: async (sourceTableId, targetTableId) => {
    try {
      await invokeIPC('move_table', { sourceTableId, targetTableId });
      set((state) => {
        const source = state.tables.find((t) => t.id === sourceTableId);
        if (!source) return state;

        return {
          tables: state.tables.map((t) => {
            if (t.id === targetTableId) {
              return {
                ...t,
                status: 'OCCUPIED',
                totalCents: source.totalCents,
                activeOrderId: source.activeOrderId,
                occupiedSeats: source.occupiedSeats,
                waiterName: source.waiterName,
                openedAt: source.openedAt,
              };
            }
            if (t.id === sourceTableId) {
              return {
                ...t,
                status: 'EMPTY',
                totalCents: 0,
                activeOrderId: undefined,
                occupiedSeats: undefined,
                waiterName: undefined,
                openedAt: undefined,
              };
            }
            return t;
          }),
          isSlideOverOpen: false,
        };
      });
      return true;
    } catch {
      return false;
    }
  },

  mergeTables: async (sourceTableId, targetTableId) => {
    try {
      await invokeIPC('merge_tables', { sourceTableId, targetTableId });
      set((state) => {
        const source = state.tables.find((t) => t.id === sourceTableId);
        const target = state.tables.find((t) => t.id === targetTableId);
        if (!source || !target) return state;

        return {
          tables: state.tables.map((t) => {
            if (t.id === targetTableId) {
              return {
                ...t,
                status: 'OCCUPIED',
                totalCents: target.totalCents + source.totalCents,
              };
            }
            if (t.id === sourceTableId) {
              return {
                ...t,
                status: 'EMPTY',
                totalCents: 0,
                activeOrderId: undefined,
                occupiedSeats: undefined,
              };
            }
            return t;
          }),
          isSlideOverOpen: false,
        };
      });
      return true;
    } catch {
      return false;
    }
  },

  addReservation: async (resData) => {
    const newReservation: Reservation = {
      id: `res_${Date.now()}`,
      status: 'CONFIRMED',
      ...resData,
    };

    set((state) => ({
      reservations: [...state.reservations, newReservation],
      tables: state.tables.map((t) =>
        t.id === resData.tableId
          ? {
              ...t,
              status: 'RESERVED',
              customerName: resData.customerName,
              reservedAt: resData.reservationTime,
            }
          : t
      ),
    }));

    return true;
  },

  checkReservationLocks: () => {
    // 60 dakika kuralı: Rezerve saatine 60dk kala masa otomatik rezerve rozeti alır ve kilitlenir
    set((state) => ({
      tables: state.tables.map((t) => {
        if (t.reservedAt && isWithin60Minutes(t.reservedAt) && t.status === 'EMPTY') {
          return { ...t, status: 'RESERVED' };
        }
        return t;
      }),
    }));
  },

  updateTablePayment: (tableId: string, paidCents: number, isClosed: boolean) => {
    set((state) => ({
      tables: state.tables.map((t) => {
        if (t.id === tableId) {
          if (isClosed) {
            return {
              ...t,
              status: 'EMPTY',
              totalCents: 0,
              activeOrderId: undefined,
              occupiedSeats: undefined,
              waiterName: undefined,
              openedAt: undefined,
            };
          }
          return {
            ...t,
            totalCents: Math.max(0, t.totalCents - paidCents),
          };
        }
        return t;
      }),
    }));
  },
}));
