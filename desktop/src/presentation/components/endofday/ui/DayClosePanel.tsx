import React from 'react';
import { ShieldCheck, AlertTriangle, Check, CheckCircle2, FileText } from 'lucide-react';
import { formatCurrency, formatDateTime } from '../helpers';
import type { CloseDayResultDto } from '../types';

interface OpenTable {
  name: string;
}

interface DayClosePanelProps {
  openTables: OpenTable[];
  openShiftCount: number;
  cashTotal: number;
  lastClosedResult: CloseDayResultDto | null;
  isClosingDay: boolean;
  onOpenConfirm: () => void;
  onOpenZReport: () => void;
}

// Günün defter kapanışı (mühürleme) paneli: açık masa uyarısı + kapanış aksiyonları
export const DayClosePanel: React.FC<DayClosePanelProps> = ({
  openTables,
  openShiftCount,
  cashTotal,
  lastClosedResult,
  isClosingDay,
  onOpenConfirm,
  onOpenZReport,
}) => {
  return (
    <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-xl flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-emerald-600 dark:text-emerald-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold dark:text-white text-zinc-900">
              Günün Defter Kapanışı (Mühürleme)
            </h2>
            <p className="text-xs dark:text-zinc-400 text-zinc-500">
              Güvenli Gün Sonu Kapanışı &bull; Resmî mali kapanış ve Z-Raporu
            </p>
          </div>
        </div>

        {openTables.length > 0 ? (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 mb-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-500" />
              <div>
                <h4 className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                  Açık Masa Kontrolü: {openTables.length} Adet Açık Masa Bulunuyor!
                </h4>
                <p className="text-xs text-amber-700/90 dark:text-amber-300/90 mt-1 leading-relaxed">
                  Henüz hesabı alınmamış masalar:{' '}
                  <span className="font-semibold text-amber-900 dark:text-white">
                    {openTables.map((t) => t.name).slice(0, 4).join(', ')}
                    {openTables.length > 4 ? ` ve +${openTables.length - 4} masa daha` : ''}
                  </span>
                  . Defteri mühürlemeden önce açık hesapların kapatılması önerilir.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs mb-4 flex items-center gap-2">
            <Check size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Açık Masa Kontrolü: Tüm masalar kapatıldı. Açık masa bulunmuyor.</span>
          </div>
        )}

        <div className="space-y-2.5 text-xs dark:text-zinc-300 text-zinc-700 mb-6 dark:bg-white/[0.03] bg-white/60 backdrop-blur-md p-4 rounded-2xl border dark:border-white/5 border-black/[0.06]">
          <div className="flex items-center gap-2">
            <Check size={14} className="text-emerald-500 shrink-0" />
            <span>
              <strong>Kasa Teslim Kontrolü:</strong>{' '}
              {openShiftCount > 0
                ? `${openShiftCount} açık kasa vardiyası otomatik teslim alınıp kapatılır.`
                : 'Tüm kasa vardiyaları teslim alındı ve kapandı.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Check size={14} className="text-emerald-500 shrink-0" />
            <span>
              <strong>Nakit Teslimi:</strong> Kasadaki {formatCurrency(cashTotal)} fiziki nakit mühürlenir.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Check size={14} className="text-emerald-500 shrink-0" />
            <span>
              <strong>Mali Z-Raporu:</strong> Mali Z-Raporu otomatik üretilir ve arşive işlenir.
            </span>
          </div>
        </div>

        {lastClosedResult && (
          <div className="mb-4 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-xs text-emerald-700 dark:text-emerald-300">
            <p className="font-semibold flex items-center gap-1.5 mb-0.5 text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 size={14} /> Son Defter Kapanışı Tamamlandı
            </p>
            <p className="text-[11px] dark:text-zinc-300 text-zinc-700">{lastClosedResult.message}</p>
            <p className="text-[10px] dark:text-zinc-400 text-zinc-500 mt-1">
              Kapanış Saati: {formatDateTime(lastClosedResult.closedAt || lastClosedResult.closed_at)}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3 pt-4 border-t dark:border-white/10 border-black/[0.08]">
        <button
          type="button"
          onClick={onOpenConfirm}
          disabled={isClosingDay}
          className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-sm font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 backdrop-blur-xl shadow-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
        >
          <CheckCircle2 size={18} />
          <span>Günü Kapat ve Z-Raporu Üret</span>
        </button>

        <button
          type="button"
          onClick={onOpenZReport}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-xs font-semibold dark:bg-white/[0.06] bg-black/[0.03] hover:dark:bg-white/[0.1] hover:bg-black/[0.06] dark:text-white text-zinc-800 border dark:border-white/10 border-black/[0.08] backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <FileText size={14} />
          <span>Z-Raporu Önizleme & Fiş Yazdır</span>
        </button>
      </div>
    </div>
  );
};

export default DayClosePanel;
