import React from 'react';
import type { FloorTable } from '../../types/floor';
import { TableCard } from './TableCard';

export interface TableCardGridProps {
  tables: FloorTable[];
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
  /** Liste boşken gösterilir: masa hiç tanımlı değil ile süzgeç sonucu boş ayrı durumlardır. */
  empty?: React.ReactNode;
}

/** Birden çok bölüm varsa masalar bölüm adıyla ayrılır: garson yerini aramaz. */
export const TableCardGrid: React.FC<TableCardGridProps> = ({ tables, onOpenTable, onInspectTable, empty }) => {
  if (tables.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        {empty ?? <span className="text-[var(--text-secondary)]">Bu durumda masa yok.</span>}
      </div>
    );
  }

  const zones = [...new Set(tables.map((table) => table.zoneName))];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {zones.map((zone) => (
        <section key={zone} className="space-y-2">
          {zones.length > 1 ? <h2 className="zone-title">{zone}</h2> : null}
          <div className="table-grid">
            {tables
              .filter((table) => table.zoneName === zone)
              .map((table) => (
                <TableCard key={table.id} table={table} onOpenTable={onOpenTable} onInspectTable={onInspectTable} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
};
