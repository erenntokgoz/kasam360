import { TableItem } from './FloorPlanPanel';
import { TableTimer } from './TableTimer';
import { MoneyDisplay } from '../../common/MoneyDisplay';

interface TableCardProps {
  table: TableItem;
  onClick: () => void;
}

export function TableCard({ table, onClick }: TableCardProps) {
  const isOccupied = table.status === 'occupied';
  const isReserved = table.status === 'reserved';
  const isEmpty = table.status === 'empty';

  return (
    <button
      onClick={onClick}
      type="button"
      aria-label={`${table.name}, durum: ${isEmpty ? 'Boş' : isOccupied ? 'Dolu' : 'Rezerve'}`}
      className={`
        relative flex flex-col p-4 rounded-2xl aspect-square border-2 transition-all duration-200 w-full h-full overflow-hidden text-left select-none
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900
        ${isOccupied ? 'bg-slate-800/95 border-rose-500 hover:bg-slate-800 hover:border-rose-400 shadow-lg shadow-rose-950/30' : ''}
        ${isReserved ? 'bg-indigo-950/60 border-indigo-500/80 hover:bg-indigo-900/60 hover:border-indigo-400 shadow-lg shadow-indigo-950/30' : ''}
        ${isEmpty ? 'bg-slate-900/90 border-slate-700/80 hover:bg-slate-800 hover:border-slate-500 hover:shadow-md' : ''}
      `}
    >
      {isEmpty && (
        <div className="flex flex-col items-center justify-center h-full w-full">
          <span className="text-3xl lg:text-4xl font-bold text-slate-400 group-hover:text-slate-200 transition-colors text-center">
            {table.name}
          </span>
          <span className="text-xs font-semibold text-slate-500 mt-2 px-2.5 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/60">
            Boş
          </span>
        </div>
      )}

      {isReserved && (
        <div className="flex flex-col items-center justify-center h-full w-full">
          <span className="text-2xl lg:text-3xl font-bold text-indigo-100 text-center">
            {table.name}
          </span>
          <span className="text-xs mt-2 font-semibold text-indigo-300 px-2.5 py-0.5 rounded-full bg-indigo-900/70 border border-indigo-700/60">
            Rezerve
          </span>
        </div>
      )}

      {isOccupied && (
        <>
          <div className="absolute top-3 left-4 pr-16 truncate max-w-[65%]">
            <span className="text-xs text-slate-400 font-medium truncate block">
              {table.waiterName || 'Garson'}
            </span>
          </div>
          {table.isReady && (
            <div className="absolute top-3 right-4">
              <span className="flex items-center gap-1.5 text-[10px] font-bold bg-green-950 text-green-300 px-2.5 py-0.5 rounded-full border border-green-500 shadow-sm shadow-green-900/50 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                HAZIR
              </span>
            </div>
          )}
          <div className="flex-1 flex items-center justify-center w-full px-2">
            <span className="text-2xl lg:text-3xl font-bold text-rose-100 text-center truncate">
              {table.name}
            </span>
          </div>
          <div className="absolute bottom-10 left-0 right-0 text-center px-2">
            <span className="text-emerald-400 font-mono font-semibold text-sm lg:text-base">
              <MoneyDisplay amountInCents={Math.round(table.totalAmount || 0)} />
            </span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-slate-950/60">
            <TableTimer openedAt={table.openedAt} />
          </div>
        </>
      )}
    </button>
  );
}

