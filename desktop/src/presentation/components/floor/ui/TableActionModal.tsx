import { useState } from 'react';
import { TableItem } from './FloorPlanPanel';
import { formatWaiterLabel } from './TableCard';
import { useAuthStore } from '../../../store/useAuthStore';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import { useModalA11y } from '../../../hooks/useModalA11y';
import {
  ArrowLeft,
  ArrowRightLeft,
  Combine,
  CreditCard,
  PlusCircle,
  BookmarkCheck,
  Printer,
  X,
  AlertTriangle,
} from 'lucide-react';

export interface TableActionModalProps {
  table: TableItem;
  allTables?: TableItem[];
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: string, targetTableId?: string) => Promise<void> | void;
}

export function TableActionModal({
  table,
  allTables = [],
  isOpen,
  onClose,
  onAction,
}: TableActionModalProps) {
  const storeUser = useAuthStore((state) => state.user);
  const user = storeUser ?? useAuthStore.getState().user;
  const isWaiter = user?.role === 'WAITER';
  // Kasiyer ve İşletme Sahibi (Patron) doğrudan ödeme/tahsilat başlatabilir
  const canTakePayment = ['CASHIER', 'OWNER'].includes(user?.role || '');

  const [mode, setMode] = useState<'menu' | 'select_move' | 'select_merge'>('menu');
  const [confirmTarget, setConfirmTarget] = useState<{
    action: 'move' | 'merge';
    targetId: string;
    targetName: string;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const { modalRef, handleBackdropClick } = useModalA11y({
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

  const handleClose = () => {
    setMode('menu');
    setConfirmTarget(null);
    onClose();
  };

  const handleExecuteConfirmedAction = async () => {
    if (!confirmTarget) return;
    setIsProcessing(true);
    try {
      if (confirmTarget.action === 'move') {
        await onAction('Masa Taşı', confirmTarget.targetId);
      } else {
        await onAction('Masa Birleştir', confirmTarget.targetId);
      }
      handleClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const availableEmptyTables = allTables.filter((t) => t.id !== table.id && t.status === 'empty');
  const otherTablesForMerge = allTables.filter((t) => t.id !== table.id);

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-action-title"
        className="dark:bg-white/[0.04] bg-white/85 dark:border-white/10 border-black/[0.08] rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col backdrop-blur-2xl animate-in zoom-in-95 duration-200"
      >
        {/* macOS Frosted Glass Başlık */}
        <div className="p-6 border-b dark:border-white/10 border-black/[0.08] flex justify-between items-center dark:bg-white/[0.02] bg-black/[0.02]">
          <div className="flex items-center gap-3">
            {mode !== 'menu' && !confirmTarget && (
              <button
                type="button"
                onClick={() => setMode('menu')}
                className="p-2 rounded-full dark:bg-white/[0.06] bg-black/[0.05] dark:text-white/70 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.12] hover:bg-black/[0.08] transition-colors cursor-pointer"
                title="Geri"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            {confirmTarget && (
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="p-2 rounded-full dark:bg-white/[0.06] bg-black/[0.05] dark:text-white/70 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.12] hover:bg-black/[0.08] transition-colors cursor-pointer"
                title="Hedef Seçimine Dön"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 id="table-action-title" className="text-xl font-semibold tracking-tight dark:text-white text-zinc-900">
                  {table.name}
                </h2>
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium border ${
                    table.status === 'occupied'
                      ? 'bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/30'
                      : table.status === 'reserved'
                      ? 'bg-[#5856D6]/15 text-[#5856D6] dark:text-[#5E5CE6] border-[#5856D6]/30'
                      : 'dark:bg-white/[0.06] bg-black/[0.05] dark:text-white/70 text-zinc-600 dark:border-white/[0.08] border-black/10'
                  }`}
                >
                  {table.status === 'occupied' ? 'Dolu' : table.status === 'reserved' ? 'Rezerve' : 'Boş'}
                </span>
                {table.isReady && (
                  <span className="text-[10px] font-bold bg-[#34C759]/20 text-[#34C759] dark:text-[#32D74B] px-2 py-0.5 rounded-full border border-[#34C759]/30 animate-pulse">
                    HAZIR
                  </span>
                )}
              </div>
              {table.status === 'occupied' && (
                <p className="text-xs dark:text-white/50 text-zinc-500 mt-1">
                  <span>{formatWaiterLabel(table.waiterName)}</span>
                  {' • '}
                  Tutar:{' '}
                  <span className="text-[#34C759] dark:text-[#32D74B] font-mono font-medium">
                    <MoneyDisplay amountInCents={Math.round(table.totalAmount || 0)} />
                  </span>
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Kapat"
            className="rounded-full p-2 dark:text-white/50 text-zinc-400 hover:dark:bg-white/[0.08] hover:bg-black/[0.05] hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Gövdesi */}
        <div className="p-6">
          {/* Taşıma veya Birleştirme Onay Adımı */}
          {confirmTarget ? (
            <div className="space-y-6 py-2">
              <div className="flex items-center gap-3 p-4 rounded-2xl dark:bg-amber-500/10 bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-200">
                <AlertTriangle size={24} className="shrink-0 text-amber-500" />
                <div className="text-xs">
                  <p className="font-semibold text-sm mb-1 dark:text-white text-zinc-900">
                    {confirmTarget.action === 'move' ? 'Masa Taşıma Onayı' : 'Masa Birleştirme Onayı'}
                  </p>
                  <p className="dark:text-white/70 text-zinc-600">
                    <strong className="dark:text-white text-zinc-900">{table.name}</strong> masasındaki siparişleri{' '}
                    <strong className="dark:text-white text-zinc-900">{confirmTarget.targetName}</strong> masasına{' '}
                    {confirmTarget.action === 'move' ? 'taşımak' : 'birleştirmek'} istediğinize emin misiniz?
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setConfirmTarget(null)}
                  className="px-5 py-2.5 rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/[0.1] hover:bg-black/[0.08] dark:text-white/80 text-zinc-700 hover:dark:text-white hover:text-zinc-900 transition-colors text-xs font-medium cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleExecuteConfirmedAction}
                  className="px-6 py-2.5 rounded-2xl bg-[#007AFF] hover:bg-[#0071E3] text-white transition-all text-xs font-semibold shadow-lg shadow-[#007AFF]/25 flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  {isProcessing ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>İşleniyor…</span>
                    </>
                  ) : (
                    <span>Evet, Onayla</span>
                  )}
                </button>
              </div>
            </div>
          ) : mode === 'menu' ? (
            <div className="grid grid-cols-2 gap-3.5">
              {/* 1. Sipariş Ekle - Akıcı POS Ekranına Geçiş */}
              <button
                type="button"
                onClick={async () => {
                  await onAction('Sipariş Ekle');
                  handleClose();
                }}
                className="h-24 bg-[#007AFF] hover:bg-[#0071E3] rounded-2xl text-base font-semibold text-white flex flex-col items-center justify-center gap-2 transition-all shadow-lg shadow-[#007AFF]/20 active:scale-95 touch-manipulation cursor-pointer"
              >
                <PlusCircle className="w-6 h-6" />
                <span>Sipariş Ekle</span>
              </button>

              {/* 2. Tahsilat / Ödeme (Kasiyer ve İşletme Sahibi) */}
              {canTakePayment && (
                <button
                  type="button"
                  onClick={async () => {
                    await onAction('Tahsilat');
                    handleClose();
                  }}
                  className="h-24 bg-[#34C759] hover:bg-[#30B753] rounded-2xl text-base font-semibold text-white flex flex-col items-center justify-center gap-2 transition-all shadow-lg shadow-[#34C759]/20 active:scale-95 touch-manipulation cursor-pointer"
                >
                  <CreditCard className="w-6 h-6" />
                  <span>Tahsilat / Ödeme</span>
                </button>
              )}

              {/* 3. Adisyon Yazdır (Garson rolünde gizlenir, diğer yetkili rollerde gösterilir) */}
              {!isWaiter && table.status === 'occupied' && (
                <button
                  type="button"
                  onClick={async () => {
                    await onAction('Adisyon Yazdır');
                    handleClose();
                  }}
                  className="h-24 dark:bg-white/[0.04] bg-white/70 hover:dark:bg-white/[0.08] hover:bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-2xl text-base font-medium dark:text-white text-zinc-900 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 touch-manipulation cursor-pointer"
                >
                  <Printer className="w-6 h-6 dark:text-white/70 text-zinc-600" />
                  <span>Adisyon Yazdır</span>
                </button>
              )}

              {/* 4. Masa Taşıma */}
              <button
                type="button"
                onClick={() => setMode('select_move')}
                className="h-24 dark:bg-white/[0.04] bg-white/70 hover:dark:bg-white/[0.08] hover:bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-2xl text-base font-medium dark:text-white text-zinc-900 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 touch-manipulation cursor-pointer"
              >
                <ArrowRightLeft className="w-6 h-6 dark:text-white/70 text-zinc-600" />
                <span>Masa Taşı</span>
              </button>

              {/* 5. Masaları Birleştir */}
              <button
                type="button"
                onClick={() => setMode('select_merge')}
                className="h-24 dark:bg-white/[0.04] bg-white/70 hover:dark:bg-white/[0.08] hover:bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-2xl text-base font-medium dark:text-white text-zinc-900 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 touch-manipulation cursor-pointer"
              >
                <Combine className="w-6 h-6 dark:text-white/70 text-zinc-600" />
                <span>Masaları Birleştir</span>
              </button>

              {/* 6. Rezerve Et / Rezervasyon Kaldır (Dolu masalarda rezerve engellenir) */}
              <button
                type="button"
                disabled={table.status === 'occupied'}
                onClick={async () => {
                  if (table.status === 'occupied') return;
                  await onAction('Rezerve Et');
                  handleClose();
                }}
                className={`h-24 rounded-2xl text-base font-medium flex flex-col items-center justify-center gap-2 transition-all touch-manipulation cursor-pointer ${
                  table.status === 'occupied'
                    ? 'opacity-40 cursor-not-allowed bg-zinc-500/10 border border-zinc-500/20 text-zinc-400'
                    : 'bg-[#5856D6]/15 hover:bg-[#5856D6]/25 border border-[#5856D6]/30 text-[#5856D6] dark:text-[#5E5CE6] active:scale-95'
                }`}
                title={table.status === 'occupied' ? 'Dolu masalar rezerve edilemez' : undefined}
              >
                <BookmarkCheck className="w-6 h-6" />
                <span>{table.status === 'reserved' ? 'Rezervasyonu Kaldır' : 'Rezerve Et'}</span>
              </button>
            </div>
          ) : mode === 'select_move' ? (
            <div className="space-y-4">
              <div className="dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] p-3 rounded-2xl dark:text-white/70 text-zinc-600 text-xs">
                <strong className="dark:text-white text-zinc-900">{table.name}</strong> masasındaki siparişleri aktarmak için hedef boş masayı seçin:
              </div>

              {availableEmptyTables.length === 0 ? (
                <div className="py-8 text-center dark:text-white/40 text-zinc-400 text-xs">
                  Taşınabilecek boş masa bulunamadı.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 max-h-64 overflow-y-auto pr-1 no-scrollbar">
                  {availableEmptyTables.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      disabled={isProcessing}
                      onClick={() =>
                        setConfirmTarget({
                          action: 'move',
                          targetId: target.id,
                          targetName: target.name,
                        })
                      }
                      className="p-4 dark:bg-white/[0.04] bg-white/70 hover:dark:bg-white/[0.08] hover:bg-white/90 border dark:border-white/10 border-black/[0.08] hover:dark:border-white/20 hover:border-black/20 rounded-2xl text-center transition-all group active:scale-95 touch-manipulation cursor-pointer"
                    >
                      <span className="text-base font-semibold dark:text-white text-zinc-900 block">
                        {target.name}
                      </span>
                      <span className="text-[11px] dark:text-white/40 text-zinc-400 mt-1 block">Boş Masa</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setMode('menu')}
                  className="px-4 py-2 text-xs dark:text-white/50 text-zinc-500 hover:dark:text-white hover:text-zinc-900 rounded-full transition-colors cursor-pointer"
                >
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] p-3 rounded-2xl dark:text-white/70 text-zinc-600 text-xs">
                <strong className="dark:text-white text-zinc-900">{table.name}</strong> masasındaki tüm açık siparişler hedef masaya aktarılacak ve bu masa boşaltılacaktır. Hedef masayı seçin:
              </div>

              {otherTablesForMerge.length === 0 ? (
                <div className="py-8 text-center dark:text-white/40 text-zinc-400 text-xs">
                  Birleştirilebilecek başka masa bulunamadı.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1 no-scrollbar">
                  {otherTablesForMerge.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      disabled={isProcessing}
                      onClick={() =>
                        setConfirmTarget({
                          action: 'merge',
                          targetId: target.id,
                          targetName: target.name,
                        })
                      }
                      className="p-3 dark:bg-white/[0.04] bg-white/70 hover:dark:bg-white/[0.08] hover:bg-white/90 border dark:border-white/10 border-black/[0.08] hover:dark:border-white/20 hover:border-black/20 rounded-2xl text-left transition-all group active:scale-95 touch-manipulation cursor-pointer"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-sm dark:text-white text-zinc-900">
                          {target.name}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            target.status === 'occupied'
                              ? 'bg-[#FF3B30]/20 text-[#FF3B30]'
                              : 'dark:bg-white/[0.08] bg-black/[0.06] dark:text-white/60 text-zinc-500'
                          }`}
                        >
                          {target.status === 'occupied' ? 'Dolu' : 'Boş'}
                        </span>
                      </div>
                      {target.status === 'occupied' && (
                        <div className="mt-1.5 text-xs text-[#34C759] dark:text-[#32D74B] font-mono font-medium">
                          Mevcut: <MoneyDisplay amountInCents={Math.round(target.totalAmount || 0)} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setMode('menu')}
                  className="px-4 py-2 text-xs dark:text-white/50 text-zinc-500 hover:dark:text-white hover:text-zinc-900 rounded-full transition-colors cursor-pointer"
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
