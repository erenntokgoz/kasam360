import React from 'react';
import { AlertTriangle, X, RefreshCw, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '../helpers';

interface OpenTable {
  name: string;
}

interface CloseDayModalProps {
  openTables: OpenTable[];
  openShiftCount: number;
  cashTotal: number;
  cardTotal: number;
  totalRevenue: number;
  isClosingDay: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

// Günü kapatma onayı: açık masa uyarısı + kapanış finansal özeti
export const CloseDayModal: React.FC<CloseDayModalProps> = ({
  openTables,
  openShiftCount,
  cashTotal,
  cardTotal,
  totalRevenue,
  isClosingDay,
  onClose,
  onConfirm,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center dark:bg-black/80 bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="backdrop-blur-2xl dark:bg-[#060609]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] max-w-lg w-full rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.01]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl border border-amber-500/20">
              <AlertTriangle size={22} />
            </div>
            <div>
              <h3 className="text-base font-semibold dark:text-white text-zinc-900">Günü Kapatmayı Onayla</h3>
              <p className="text-xs dark:text-zinc-400 text-zinc-500">Hesap defteri mutabakatı ve Z-Raporu mühürleme</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {openTables.length > 0 && (
            <div className="p-4 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-300 space-y-1">
              <p className="font-semibold text-xs flex items-center gap-1.5 text-amber-900 dark:text-amber-200">
                <AlertTriangle size={15} /> Dikkat: {openTables.length} Adet Açık Masa Bulunuyor!
              </p>
              <p className="text-xs leading-relaxed">
                Masalar:{' '}
                <span className="font-semibold dark:text-white text-zinc-900">
                  {openTables.map((t) => t.name).join(', ')}
                </span>
                . Açık masalar varken defteri mühürlerseniz, bu masaların hesapları devreden bakiye olarak kalır.
              </p>
            </div>
          )}

          <div className="dark:bg-white/[0.03] bg-white/70 backdrop-blur-md p-4 rounded-2xl border dark:border-white/10 border-black/[0.06] space-y-2.5 text-sm">
            <div className="flex justify-between items-center">
              <span className="dark:text-zinc-400 text-zinc-600">Kapatılacak Açık Vardiyalar:</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400 font-mono">
                {openShiftCount > 0 ? `${openShiftCount} Adet Vardiya` : 'Açık Vardiya Yok'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="dark:text-zinc-400 text-zinc-600">Kasadaki Fiziki Nakit:</span>
              <span className="font-semibold dark:text-white text-zinc-900 font-mono">{formatCurrency(cashTotal)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="dark:text-zinc-400 text-zinc-600">Kredi Kartı / POS Toplamı:</span>
              <span className="font-semibold dark:text-white text-zinc-900 font-mono">{formatCurrency(cardTotal)}</span>
            </div>
            <div className="flex justify-between items-center pt-2.5 border-t dark:border-white/10 border-black/[0.06] text-base font-semibold">
              <span className="dark:text-zinc-200 text-zinc-800">Günlük Net Ciro:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(totalRevenue)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.01]">
          <button
            type="button"
            onClick={onClose}
            disabled={isClosingDay}
            className="px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.06] bg-black/[0.04] hover:dark:bg-white/[0.1] hover:bg-black/[0.08] dark:text-zinc-200 text-zinc-700 transition-all cursor-pointer"
          >
            Vazgeç
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={isClosingDay}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 backdrop-blur-xl shadow-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            {isClosingDay ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                <span>Defter Mühürleniyor...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                <span>Onayla ve Günü Kapat</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CloseDayModal;
