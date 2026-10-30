import { create } from 'zustand';
import type { FloorTable, FloorZone, Reservation } from '../types/floor';
import { invokeIPC } from '../services/tauriClient';
import { isWithin60Minutes } from '../lib/date';
import { sessionArgs } from './cariStore';

interface FloorRow {
  id: string;
  name: string;
  status: string;
  openedAt?: string | null;
  currentTotal: number;
  zone?: string | null;
  seats: number;
  waiterName?: string | null;
  guestCount?: number | null;
  reservationCustomerName?: string | null;
  reservationTime?: string | null;
}

const DEFAULT_ZONE = 'Salon';
const STATUS: Record<string, FloorTable['status']> = {
  AVAILABLE: 'EMPTY',
  OCCUPIED: 'OCCUPIED',
  RESERVED: 'RESERVED',
};

/** Masa satırını ekran modeline çevirir. Bilinmeyen durum boş sayılmaz. */
export function mapFloorRow(row: FloorRow, index: number): FloorTable {
  const zone = row.zone?.trim() || DEFAULT_ZONE;
  return {
    id: row.id,
    tableNumber: row.name,
    zoneId: zone,
    zoneName: zone,
    capacity: row.seats,
    status: STATUS[row.status] ?? 'OCCUPIED',
    occupiedSeats: row.guestCount ?? undefined,
    totalCents: row.currentTotal,
    openedAt: row.openedAt ?? undefined,
    waiterName: row.waiterName ?? undefined,
    reservedAt: row.reservationTime ?? undefined,
    customerName: row.reservationCustomerName ?? undefined,
    posX: 40 + (index % 6) * 130,
    posY: 40 + Math.floor(index / 6) * 130,
    width: 100,
    height: 100,
  };
}

interface FloorStore {
  zones: FloorZone[];
  tables: FloorTable[];
  selectedZoneId: string | null;
  selectedTableId: string | null;
  viewMode: 'CARDS' | 'KROKI';
  isKrokiEditMode: boolean;
  reservations: Reservation[];
  isSlideOverOpen: boolean;
  floorError: string | null;
  loadFloorPlan: () => Promise<void>;
  addTable: (name: string, zone: string, seats: number) => Promise<void>;
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
  floorError: null,

  loadFloorPlan: async () => {
    try {
      const { tenantId } = sessionArgs();
      const rows = await invokeIPC<FloorRow[]>('get_floor_plan', { tenantId });
      const tables = rows.map(mapFloorRow);
      const zones: FloorZone[] = [...new Set(tables.map((t) => t.zoneId))].map((zone) => ({
        id: zone,
        name: zone,
        tableCount: tables.filter((t) => t.zoneId === zone).length,
      }));
      set({ zones, tables, floorError: null });
      get().checkReservationLocks();
    } catch (error) {
      set({ floorError: String(error) });
    }
  },

  addTable: async (name, zone, seats) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('add_table', {
      id: `tbl_${crypto.randomUUID()}`,
      name,
      tenantId,
      zone,
      seats,
      actorId,
      actorRole,
    });
    await get().loadFloorPlan();
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
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('move_table', { fromId: sourceTableId, toId: targetTableId, actorId, actorRole, tenantId });
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
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('merge_tables', { sourceId: sourceTableId, targetId: targetTableId, actorId, actorRole, tenantId });
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
}));
