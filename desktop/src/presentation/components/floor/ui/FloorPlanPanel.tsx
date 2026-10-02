import { useState, useMemo } from 'react';
import { TableCard } from './TableCard';

/** Masa kartında gösterilen rezervasyon özeti. */
export interface TableReservationSummary {
  customerName: string;
  partySize: number;
  /** Rezervasyonun yaratıldığı an (epoch ms): bekleme sayacı bu değerden işler. */
  waitingSince: number;
  /** `ACTIVE` = bekliyor, `ARRIVED` = geldi, adisyon bekliyor. */
  status: 'ACTIVE' | 'ARRIVED';
  reservedAtLabel: string;
}

export interface TableItem {
  id: string;
  name: string;
  status: 'empty' | 'occupied' | 'reserved';
  openedAt?: number;
  waiterName?: string;
  totalAmount?: number;
  isReady?: boolean;
  mergedWith?: string[];
  transferInfo?: string;
  reservation?: TableReservationSummary;
}

export interface FloorPlanPanelProps {
  tables: TableItem[];
  onTableClick: (tableId: string) => void;
  onQuickReserve?: (tableId: string) => void;
  onEditTable?: (tableId: string, currentName: string) => void;
  onDeleteTable?: (tableId: string) => void;
}

type FilterStatus = 'all' | 'empty' | 'occupied' | 'reserved' | 'ready';

export function FloorPlanPanel({ tables, onTableClick, onQuickReserve }: FloorPlanPanelProps) {
  const [filter, setFilter] = useState<FilterStatus>('all');

  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');

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
    <div className="flex-1 flex flex-col overflow-hidden bg-transparent gap-4 min-h-0">
      {/* macOS Frosted Glass Bağımsız Yüzen Filtre Adası */}
      <div className="px-6 py-3.5 rounded-3xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 touch-manipulation cursor-pointer ${
              filter === 'all'
                ? 'dark:bg-white/20 bg-black/10 dark:text-white text-zinc-900 border dark:border-white/20 border-black/15 shadow-sm'
                : 'dark:bg-white/[0.04] bg-white/70 dark:text-white/70 text-zinc-600 hover:dark:bg-white/[0.08] hover:bg-white/90 border dark:border-white/10 border-black/[0.08]'
            }`}
          >
            Tüm Masalar ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setFilter('empty')}
            className={`px-4 py-1.5 rounded-full text-xs transition-all active:scale-95 touch-manipulation cursor-pointer ${
              filter === 'empty'
                ? 'dark:bg-white/20 bg-black/10 dark:text-white text-zinc-900 font-semibold border dark:border-white/20 border-black/15 shadow-sm'
                : 'dark:bg-white/[0.04] bg-white/70 dark:text-white/70 text-zinc-600 hover:dark:bg-white/[0.08] hover:bg-white/90 border dark:border-white/10 border-black/[0.08]'
            }`}
          >
            Boş ({counts.empty})
          </button>
          <button
            type="button"
            onClick={() => setFilter('occupied')}
            className={`px-4 py-1.5 rounded-full text-xs transition-all active:scale-95 touch-manipulation cursor-pointer ${
              filter === 'occupied'
                ? 'bg-[#FF3B30]/15 dark:bg-[#FF453A]/20 text-[#FF3B30] dark:text-[#FF453A] font-semibold border border-[#FF3B30]/30 shadow-sm'
                : 'dark:bg-white/[0.04] bg-white/70 dark:text-white/70 text-zinc-600 hover:dark:bg-white/[0.08] hover:bg-white/90 border dark:border-white/10 border-black/[0.08]'
            }`}
          >
            Dolu ({counts.occupied})
          </button>
          <button
            type="button"
            onClick={() => setFilter('reserved')}
            className={`px-4 py-1.5 rounded-full text-xs transition-all active:scale-95 touch-manipulation cursor-pointer ${
              filter === 'reserved'
                ? 'bg-[#5856D6]/15 dark:bg-[#5E5CE6]/20 text-[#5856D6] dark:text-[#5E5CE6] font-semibold border border-[#5856D6]/30 shadow-sm'
                : 'dark:bg-white/[0.04] bg-white/70 dark:text-white/70 text-zinc-600 hover:dark:bg-white/[0.08] hover:bg-white/90 border dark:border-white/10 border-black/[0.08]'
            }`}
          >
            Rezerve ({counts.reserved})
          </button>
          {counts.ready > 0 && (
            <button
              type="button"
              onClick={() => setFilter('ready')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 touch-manipulation cursor-pointer flex items-center gap-1.5 ${
                filter === 'ready'
                  ? 'bg-[#34C759]/20 text-[#34C759] dark:text-[#32D74B] border border-[#34C759]/40 shadow-sm'
                  : 'bg-[#34C759]/15 border border-[#34C759]/30 text-[#34C759] dark:text-[#32D74B] hover:bg-[#34C759]/25'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#34C759] dark:bg-[#32D74B] animate-pulse"></span>
              Hazır Siparişler ({counts.ready})
            </button>
          )}
        </div>
        <div className="flex items-center bg-black/5 dark:bg-white/5 rounded-full p-1 border dark:border-white/10 border-black/[0.08]">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`px-4 py-1 rounded-full text-xs transition-all cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-white dark:bg-white/20 text-zinc-900 dark:text-white shadow-sm font-semibold'
                : 'text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            Kart
          </button>
          <button
            type="button"
            onClick={() => setViewMode('map')}
            className={`px-4 py-1 rounded-full text-xs transition-all cursor-pointer ${
              viewMode === 'map'
                ? 'bg-white dark:bg-white/20 text-zinc-900 dark:text-white shadow-sm font-semibold'
                : 'text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            Kroki
          </button>
        </div>
      </div>

      {/* Masalar Izgarası (Grid Düzeni) veya Kroki Görünümü */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 no-scrollbar rounded-3xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg">
        {filteredTables.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <p className="dark:text-white/40 text-zinc-500 text-sm font-medium">Bu filtreye uygun masa bulunmuyor.</p>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="mt-3 text-xs text-[#007AFF] hover:underline font-medium cursor-pointer"
            >
              Tüm masaları göster
            </button>
          </div>
        ) : viewMode === 'map' ? (
          <div className="relative w-full h-full min-h-[400px] border-2 border-dashed dark:border-white/20 border-black/10 rounded-2xl flex items-center justify-center">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-500 to-transparent"></div>
            <p className="dark:text-white/50 text-zinc-500 font-medium">Kroki Görünümü (Sürükle & Bırak yakında eklenecek)</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6 gap-4 sm:gap-5">
            {filteredTables.map((table) => (
              <div key={table.id} className="relative w-full">
                <TableCard
                  table={table}
                  onClick={() => onTableClick(table.id)}
                  onQuickReserve={onQuickReserve ? () => onQuickReserve(table.id) : undefined}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
