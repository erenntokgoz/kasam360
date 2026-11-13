import { create } from 'zustand';
import type { FloorObject, FloorTable, FloorZone, Reservation } from '../types/floor';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { errorText } from '../lib/cariInput';
import { compareTableNames, type NewTable } from '../lib/tableBatch';

interface FloorRow {
  id: string;
  name: string;
  status: string;
  openedAt?: string | null;
  currentTotal: number;
  zone?: string | null;
  seats: number;
  x: number;
  y: number;
  reservationId?: string | null;
  waiterName?: string | null;
  trail?: string | null;
  merged?: string | null;
  guestCount?: number | null;
  reservationCustomerName?: string | null;
  reservationTime?: string | null;
  reservationPartySize?: number | null;
  activeOrderId?: string | null;
  remainingCents?: number | null;
}

interface FloorObjectRow {
  id: string; zone_id: string | null; kind: FloorObject['kind']; label: string | null;
  x: number; y: number; width: number; height: number; rotation: number; is_active: boolean;
}

export interface FloorLayoutDraft {
  tables: FloorTable[];
  objects: FloorObject[];
  newObjects: FloorObject[];
  deletedObjectIds: string[];
}

export function mapFloorObject(row: FloorObjectRow): FloorObject {
  return { id: row.id, zoneId: row.zone_id, kind: row.kind, label: row.label, x: row.x, y: row.y, width: row.width, height: row.height, rotation: row.rotation, isActive: row.is_active };
}

const DEFAULT_ZONE = 'Salon';
const STATUS: Record<string, FloorTable['status']> = {
  AVAILABLE: 'EMPTY',
  OCCUPIED: 'OCCUPIED',
  RESERVED: 'RESERVED',
};

/** Masa satırını ekran modeline çevirir. Bilinmeyen durum boş sayılmaz. */
export function mapFloorRow(row: FloorRow): FloorTable {
  const zone = row.zone?.trim() || DEFAULT_ZONE;
  return {
    id: row.id,
    tableNumber: row.name,
    zoneId: zone,
    zoneName: zone,
    capacity: row.seats,
    // Kaydı olmayan rezerve bayrağı boş masadır.
    status: row.status === 'RESERVED' && !row.reservationId ? 'EMPTY' : STATUS[row.status] ?? 'OCCUPIED',
    occupiedSeats: row.guestCount ?? undefined,
    totalCents: row.currentTotal,
    remainingCents: row.remainingCents ?? undefined,
    activeOrderId: row.activeOrderId ?? undefined,
    openedAt: row.openedAt ?? undefined,
    waiterName: row.waiterName ?? undefined,
    trail: row.trail ?? undefined,
    merged: row.merged ?? undefined,
    reservedAt: row.reservationTime ?? undefined,
    customerName: row.reservationCustomerName ?? undefined,
    reservationId: row.reservationId ?? undefined,
    reservationPartySize: row.reservationPartySize ?? undefined,
    // Konum kısmın içindedir; (0,0) yerleştirilmemiş demektir, kroki kendisi dizer.
    posX: row.x,
    posY: row.y,
    width: 100,
    height: 100,
  };
}

interface FloorStore {
  zones: FloorZone[];
  tables: FloorTable[];
  objects: FloorObject[];
  selectedZoneId: string | null;
  selectedTableId: string | null;
  viewMode: 'CARDS' | 'KROKI';
  isKrokiEditMode: boolean;
  reservations: Reservation[];
  isSlideOverOpen: boolean;
  floorError: string | null;
  loadFloorPlan: () => Promise<void>;
  addTables: (batch: NewTable[], zoneId: string) => Promise<void>;
  addZone: (name: string) => Promise<string>;
  renameZone: (zoneId: string, name: string) => Promise<void>;
  removeZone: (zoneId: string) => Promise<void>;
  updateTable: (tableId: string, name: string, seats: number) => Promise<void>;
  removeTable: (tableId: string) => Promise<void>;
  setSelectedZoneId: (zoneId: string | null) => void;
  selectTable: (tableId: string | null) => void;
  openTableSlideOver: (tableId: string) => void;
  closeTableSlideOver: () => void;
  setViewMode: (mode: 'CARDS' | 'KROKI') => void;
  setKrokiEditMode: (editing: boolean) => void;
  updateTablePosition: (tableId: string, posX: number, posY: number) => void;
  saveFloorLayout: (draft: FloorLayoutDraft) => Promise<boolean>;
  moveTable: (sourceTableId: string, targetTableId: string) => Promise<boolean>;
  mergeTables: (sourceTableId: string, targetTableId: string) => Promise<boolean>;
  addReservation: (res: Omit<Reservation, 'id' | 'status'>) => Promise<void>;
  updateReservation: (reservationId: string, res: Omit<Reservation, 'id' | 'status'>) => Promise<void>;
  closeReservation: (reservationId: string, action: 'ARRIVED' | 'CANCELLED') => Promise<void>;
}

export const useFloorStore = create<FloorStore>((set, get) => ({
  zones: [],
  tables: [],
  objects: [],
  selectedZoneId: null,
  selectedTableId: null,
  viewMode: 'CARDS',
  isKrokiEditMode: false,
  reservations: [],
  isSlideOverOpen: false,
  floorError: null,

  loadFloorPlan: async () => {
    try {
      const { tenantId, actorRole } = sessionArgs();
      const [rows, layout] = await Promise.all([
        invokeIPC<FloorRow[]>('get_floor_plan', { tenantId }),
        invokeIPC<{ zones: { id: string; name: string }[]; tables?: { id: string; rotation: number }[]; objects: FloorObjectRow[] }>('get_floor_layout', { tenantId, actorRole }),
      ]);
      const names = new Map(layout.zones.map((zone) => [zone.id, zone.name]));
      // Masa açısı yalnız düzen okumasında gelir; kart listesi açıyı taşımaz.
      const angles = new Map((layout.tables ?? []).map((table) => [table.id, table.rotation]));
      const tables = rows
        .map(mapFloorRow)
        .map((table) => ({ ...table, zoneName: names.get(table.zoneId) ?? table.zoneName, rotation: angles.get(table.id) ?? 0 }))
        .sort((left, right) => compareTableNames(left.tableNumber, right.tableNumber));
      // Kısmı silinmiş masa kaybolmasın: varsayılan kısımda görünür.
      const orphanIds = [...new Set(tables.map((table) => table.zoneId))].filter((id) => !names.has(id));
      const zones: FloorZone[] = [...layout.zones, ...orphanIds.map((id) => ({ id, name: id }))].map((zone) => ({
        id: zone.id,
        name: zone.name,
        tableCount: tables.filter((table) => table.zoneId === zone.id).length,
      }));
      set({ zones, tables, objects: layout.objects.map(mapFloorObject), floorError: null });
    } catch (error) {
      // Kilitliyken düşen okuma hatası kilit açılınca ekranda kalmaz; sonraki okuma tazeler.
      if (!/SESSION_LOCKED/.test(String(error))) set({ floorError: errorText(error) });
    }
  },

  addZone: async (name) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    const id = await invokeIPC<string>('create_floor_zone', { name, sortOrder: get().zones.length, actorId, actorRole, tenantId });
    await get().loadFloorPlan();
    return id;
  },

  renameZone: async (zoneId, name) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('rename_floor_zone', { zoneId, name, actorId, actorRole, tenantId });
    await get().loadFloorPlan();
  },

  removeZone: async (zoneId) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('delete_floor_zone', { zoneId, actorId, actorRole, tenantId });
    await get().loadFloorPlan();
  },

  addTables: async (batch, zone) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    try {
      // Sıralı yazılır: her masa denetim defterine kendi kaydıyla girer.
      for (const { name, seats } of batch) {
        await invokeIPC('add_table', { id: `tbl_${crypto.randomUUID()}`, name, tenantId, zone, seats, actorId, actorRole });
      }
    } finally {
      await get().loadFloorPlan();
    }
  },

  updateTable: async (tableId, name, seats) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('update_table_name', { id: tableId, name, seats, tenantId, actorId, actorRole });
    await get().loadFloorPlan();
  },

  removeTable: async (tableId) => {
    const { actorId, actorRole } = sessionArgs();
    await invokeIPC('remove_table', { id: tableId, actorId, actorRole });
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

  saveFloorLayout: async (draft) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    try {
      await invokeIPC('save_floor_layout', {
        actorRole,
        actorId,
        tenantId,
        args: {
          tables: draft.tables.map((table) => ({
            table_id: table.id,
            x: Math.round(table.posX),
            y: Math.round(table.posY),
            rotation: table.rotation ?? 0,
            seats: table.capacity,
            // Kısım korunur: boş gönderilirse kayıt masaları kısımsız bırakır.
            zone_id: get().zones.some((zone) => zone.id === table.zoneId) ? table.zoneId : null,
          })),
          objects: draft.objects.map((object) => ({
            object_id: object.id,
            zone_id: object.zoneId,
            kind: object.kind,
            label: object.label,
            x: Math.round(object.x),
            y: Math.round(object.y),
            width: Math.round(object.width),
            height: Math.round(object.height),
            rotation: object.rotation,
          })),
          new_objects: draft.newObjects.map((object) => ({
            zone_id: object.zoneId,
            kind: object.kind,
            label: object.label,
            x: Math.round(object.x),
            y: Math.round(object.y),
            width: Math.round(object.width),
            height: Math.round(object.height),
            rotation: object.rotation,
          })),
          delete_object_ids: draft.deletedObjectIds,
        },
      });
      set({ isKrokiEditMode: false, floorError: null });
      await get().loadFloorPlan();
      return true;
    } catch (error) {
      set({ floorError: String(error) });
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

  // Masa durumu sunucuda değişir; ekran kaydı istemcide uydurulmaz.
  addReservation: async (resData) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('reserve_table', {
      request: {
        tableId: resData.tableId,
        customerName: resData.customerName,
        customerPhone: resData.customerPhone,
        partySize: resData.guestCount,
        reservedAt: resData.reservationTime,
        note: resData.notes,
      },
      callerRole: actorRole,
      callerId: actorId,
      callerTenantId: tenantId,
    });
    await get().loadFloorPlan();
  },

  updateReservation: async (reservationId, resData) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('update_reservation', {
      reservationId,
      request: {
        customerName: resData.customerName,
        customerPhone: resData.customerPhone,
        partySize: resData.guestCount,
        reservedAt: resData.reservationTime,
        note: resData.notes,
      },
      callerRole: actorRole,
      callerId: actorId,
      callerTenantId: tenantId,
    });
    await get().loadFloorPlan();
  },

  closeReservation: async (reservationId, action) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC(action === 'ARRIVED' ? 'mark_reservation_arrived' : 'cancel_reservation', {
      reservationId,
      callerRole: actorRole,
      callerId: actorId,
      callerTenantId: tenantId,
    });
    await get().loadFloorPlan();
  },
}));
