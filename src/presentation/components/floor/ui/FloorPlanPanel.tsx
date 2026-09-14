import { useState, useMemo } from 'react';
import { TableCard } from './TableCard';
import { Pencil, Trash2 } from 'lucide-react';

export interface TableItem {
  id: string;
  name: string;
  status: 'empty' | 'occupied' | 'reserved';
  openedAt?: number;
  waiterName?: string;
  totalAmount?: number;
  isReady?: boolean;
}

export interface FloorPlanPanelProps {
  tables: TableItem[];
  onTableClick: (tableId: string) => void;
  onEditTable?: (tableId: string, currentName: string) => void;
  onDeleteTable?: (tableId: string) => void;
}

type FilterStatus = 'all' | 'empty' | 'occupied' | 'reserved' | 'ready';

export function FloorPlanPanel({ tables, onTableClick, onEditTable, onDeleteTable }: FloorPlanPanelProps) {
  const [filter, setFilter] = useState<FilterStatus>('all');

  const counts = useMemo(() => {
    return {
      all: tables.length,
      empty: tables.filter((t) => t.status === 'empty').length,
      occupied: tables.filter((t) => t.status === 'occupied').length,
      reserved: tables.filter((t) => t.status === 'reserved').length,
      ready: tables.filter((t) => t.isReady).length,
    };
  }, [tables]);

  const filteredTables = useMemo(() => {
    switch (filter) {
      case 'empty':
        return tables.filter((t) => t.status === 'empty');
      case 'occupied':
        return tables.filter((t) => t.status === 'occupied');
      case 'reserved':
        return tables.filter((t) => t.status === 'reserved');
      case 'ready':
        return tables.filter((t) => t.isReady);
      default:
        return tables;
    }
  }, [tables, filter]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
      {/* Filter / KPI Bar */}
      <div className="px-6 py-3 border-b border-slate-800/80 flex items-center justify-between gap-4 flex-wrap bg-slate-900/30">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Tüm Masalar ({counts.all})
          </button>
          <button
            onClick={() => setFilter('empty')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === 'empty'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Boş ({counts.empty})
          </button>
          <button
            onClick={() => setFilter('occupied')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === 'occupied'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-slate-800/80 text-rose-300 hover:bg-slate-700'
            }`}
          >
            Dolu ({counts.occupied})
          </button>
          <button
            onClick={() => setFilter('reserved')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === 'reserved'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-800/80 text-indigo-300 hover:bg-slate-700'
            }`}
          >
            Rezerve ({counts.reserved})
          </button>
          {counts.ready > 0 && (
            <button
              onClick={() => setFilter('ready')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                filter === 'ready'
                  ? 'bg-green-600 text-white shadow-sm animate-pulse'
                  : 'bg-green-950/80 border border-green-700 text-green-300 hover:bg-green-900'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-green-400"></span>
              Hazır Siparişler ({counts.ready})
            </button>
          )}
        </div>
      </div>

      {/* Tables Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredTables.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <p className="text-slate-400 text-base">Bu filtreye uygun masa bulunmuyor.</p>
            <button
              onClick={() => setFilter('all')}
              className="mt-3 text-sm text-blue-400 hover:text-blue-300 underline"
            >
              Tüm masaları göster
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-6">
            {filteredTables.map((table) => (
              <div key={table.id} className="relative group">
                <TableCard table={table} onClick={() => onTableClick(table.id)} />
                <div className="absolute top-2 right-2 hidden group-hover:flex gap-1 z-10">
                  {onEditTable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTable(table.id, table.name);
                      }}
                      className="rounded bg-slate-800/90 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white shadow transition-colors"
                      title="Masa Adını Düzenle"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onDeleteTable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTable(table.id);
                      }}
                      className="rounded bg-red-900/70 p-1.5 text-red-300 hover:bg-red-800 hover:text-white shadow transition-colors"
                      title="Masayı Sil"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

