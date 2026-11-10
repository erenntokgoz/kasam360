import type { FloorTable } from '../../types/floor';

export type TableFilter = 'ALL' | 'EMPTY' | 'OCCUPIED' | 'BILL_REQUESTED' | 'RESERVED';

export function matchesTableFilter(table: FloorTable, filter: TableFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'RESERVED') return table.status === 'RESERVED' || Boolean(table.reservationId);
  if (filter === 'EMPTY') return table.status === 'EMPTY' && !table.reservationId;
  return table.status === filter;
}

export function filterFloorTables(tables: FloorTable[], zoneId: string | null, filter: TableFilter): FloorTable[] {
  return tables.filter((table) => (!zoneId || table.zoneId === zoneId) && matchesTableFilter(table, filter));
}
