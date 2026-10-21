import React from 'react';
import type { FloorTable } from '../../types/floor';
import { TableCard } from './TableCard';

export interface TableCardGridProps {
  tables: FloorTable[];
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
}

export const TableCardGrid: React.FC<TableCardGridProps> = ({
  tables,
  onOpenTable,
  onInspectTable,
}) => {
  if (tables.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <span className="text-xs text-[var(--text-muted)]">Bu bölgede henüz masa tanımlı değil</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 content-start">
      {tables.map((table) => (
        <TableCard
          key={table.id}
          table={table}
          onOpenTable={onOpenTable}
          onInspectTable={onInspectTable}
        />
      ))}
    </div>
  );
};
