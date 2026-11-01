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
        <span className="text-lg text-[var(--text-secondary)]">Bu bölgede masa yok. Masa Ekle ile başlayın.</span>
      </div>
    );
  }

  // Satırlar boş ekranı doldurur ama birkaç masada dev yaprak oluşmaz.
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-5 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] auto-rows-[minmax(150px,34vh)] gap-x-4 gap-y-6">
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
