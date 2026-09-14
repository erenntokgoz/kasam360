import { useState } from 'react';
import { TableItem } from './FloorPlanPanel';
import { useAuthStore } from '../../../store/useAuthStore';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import { ArrowLeft, ArrowRightLeft, Combine, CreditCard, PlusCircle, BookmarkCheck, Pencil, X } from 'lucide-react';

export interface TableActionModalProps {
  table: TableItem;
  allTables?: TableItem[];
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: string, targetTableId?: string) => Promise<void> | void;
}

export function TableActionModal({ table, allTables = [], isOpen, onClose, onAction }: TableActionModalProps) {
  const user = useAuthStore((state) => state.user);
  const isWaiter = user?.role === 'WAITER';

  const [mode, setMode] = useState<'menu' | 'select_move' | 'select_merge'>('menu');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setMode('menu');
    onClose();
  };

  const handleExecuteMove = async (targetId: string) => {
    setIsProcessing(true);
    try {
      await onAction('Masa Taşı', targetId);
      handleClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteMerge = async (targetId: string) => {
    setIsProcessing(true);
    try {
      await onAction('Masa Birleştir', targetId);
      handleClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const availableEmptyTables = allTables.filter((t) => t.id !== table.id && t.status === 'empty');
  const otherTablesForMerge = allTables.filter((t) => t.id !== table.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
          <div className="flex items-center gap-3">
            {mode !== 'menu' && (
              <button
                onClick={() => setMode('menu')}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                title="Geri"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-slate-100">{table.name}</h2>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                    table.status === 'occupied'
                      ? 'bg-rose-950/80 text-rose-300 border-rose-600'
                      : table.status === 'reserved'
                      ? 'bg-indigo-950/80 text-indigo-300 border-indigo-600'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {table.status === 'occupied' ? 'Dolu' : table.status === 'reserved' ? 'Rezerve' : 'Boş'}
                </span>
                {table.isReady && (
                  <span className="text-[10px] font-bold bg-green-950 text-green-300 px-2 py-0.5 rounded-full border border-green-500 animate-pulse">
                    HAZIR
                  </span>
                )}
              </div>
              {table.status === 'occupied' && (
                <p className="text-sm text-slate-400 mt-1">
                  Garson: <span className="text-slate-200">{table.waiterName || 'Belirtilmedi'}</span>
                  {' • '}
                  Tutar:{' '}
                  <span className="text-emerald-400 font-mono font-semibold">
                    <MoneyDisplay amountInCents={Math.round(table.totalAmount || 0)} />
                  </span>
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6">
          {mode === 'menu' && (
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => { onAction('Sipariş Ekle'); handleClose(); }}
                className="h-24 bg-blue-600 hover:bg-blue-500 rounded-xl text-lg font-semibold text-white flex flex-col items-center justify-center gap-2 transition-all shadow-md active:scale-98"
              >
                <PlusCircle className="w-7 h-7" />
                <span>Sipariş Ekle</span>
              </button>

              {!isWaiter && (
                <button
                  onClick={() => { onAction('Tahsilat'); handleClose(); }}
                  className="h-24 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-lg font-semibold text-white flex flex-col items-center justify-center gap-2 transition-all shadow-md active:scale-98"
                >
                  <CreditCard className="w-7 h-7" />
                  <span>Tahsilat / Ödeme</span>
                </button>
              )}

              <button
                onClick={() => setMode('select_move')}
                className="h-24 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-xl text-lg font-semibold text-slate-200 flex flex-col items-center justify-center gap-2 transition-all active:scale-98"
              >
                <ArrowRightLeft className="w-7 h-7 text-sky-400" />
                <span>Masa Taşı</span>
              </button>

              <button
                onClick={() => setMode('select_merge')}
                className="h-24 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-xl text-lg font-semibold text-slate-200 flex flex-col items-center justify-center gap-2 transition-all active:scale-98"
              >
                <Combine className="w-7 h-7 text-amber-400" />
                <span>Masaları Birleştir</span>
              </button>

              <button
                onClick={async () => {
                  await onAction('Rezerve Et');
                  handleClose();
                }}
                className="h-24 bg-indigo-900/60 hover:bg-indigo-800/80 border border-indigo-700/60 rounded-xl text-lg font-semibold text-indigo-200 flex flex-col items-center justify-center gap-2 transition-all active:scale-98"
              >
                <BookmarkCheck className="w-7 h-7 text-indigo-400" />
                <span>{table.status === 'reserved' ? 'Rezervasyonu Kaldır' : 'Rezerve Et'}</span>
              </button>

              {!isWaiter && (
                <button
                  onClick={() => { onAction('Masa Düzenle'); handleClose(); }}
                  className="h-24 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-lg font-semibold text-slate-200 flex flex-col items-center justify-center gap-2 transition-all active:scale-98"
                >
                  <Pencil className="w-7 h-7 text-slate-400" />
                  <span>Masa Adı Değiştir</span>
                </button>
              )}
            </div>
          )}

          {mode === 'select_move' && (
            <div className="space-y-4">
              <div className="bg-sky-950/40 border border-sky-800/50 p-3 rounded-lg text-sky-200 text-sm">
                <strong>{table.name}</strong> masasındaki siparişleri aktarmak için hedef boş masayı seçin:
              </div>

              {availableEmptyTables.length === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  Taşınabilecek boş masa bulunamadı.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 max-h-64 overflow-y-auto pr-1">
                  {availableEmptyTables.map((target) => (
                    <button
                      key={target.id}
                      disabled={isProcessing}
                      onClick={() => handleExecuteMove(target.id)}
                      className="p-4 bg-slate-800/90 hover:bg-sky-900/50 border border-slate-700 hover:border-sky-500 rounded-xl text-center transition-all group"
                    >
                      <span className="text-lg font-bold text-slate-200 group-hover:text-white block">
                        {target.name}
                      </span>
                      <span className="text-xs text-slate-400 mt-1 block">Boş Masa</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setMode('menu')}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg transition-colors"
                >
                  Vazgeç
                </button>
              </div>
            </div>
          )}

          {mode === 'select_merge' && (
            <div className="space-y-4">
              <div className="bg-amber-950/40 border border-amber-800/50 p-3 rounded-lg text-amber-200 text-sm">
                <strong>{table.name}</strong> masasındaki tüm açık siparişler hedef masaya aktarılacak ve bu masa boşaltılacaktır. Hedef masayı seçin:
              </div>

              {otherTablesForMerge.length === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  Birleştirilebilecek başka masa bulunamadı.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
                  {otherTablesForMerge.map((target) => (
                    <button
                      key={target.id}
                      disabled={isProcessing}
                      onClick={() => handleExecuteMerge(target.id)}
                      className="p-3 bg-slate-800/90 hover:bg-amber-900/40 border border-slate-700 hover:border-amber-500 rounded-xl text-left transition-all group"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-200 group-hover:text-white">
                          {target.name}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            target.status === 'occupied'
                              ? 'bg-rose-900/60 text-rose-300'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {target.status === 'occupied' ? 'Dolu' : 'Boş'}
                        </span>
                      </div>
                      {target.status === 'occupied' && (
                        <div className="mt-2 text-xs text-emerald-400 font-mono font-semibold">
                          Mevcut: <MoneyDisplay amountInCents={Math.round(target.totalAmount || 0)} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setMode('menu')}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg transition-colors"
                >
                  Vazgeç
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

