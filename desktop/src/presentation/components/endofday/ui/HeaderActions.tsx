import React from 'react';
import { BookOpen, RefreshCw, FileText } from 'lucide-react';
import { QuickTransactionType } from './QuickTransactionModal';

interface HeaderActionsProps {
  tenantId: string;
  actorName: string;
  actorRole: string;
  refreshing: boolean;
  onQuickAction: (type: QuickTransactionType) => void;
  onRefresh: () => void;
  onOpenZReport: () => void;
}

// Hesap Defteri başlık adası: kimlik satırı + 4 hızlı aksiyon + yenile/Z-raporu
export const HeaderActions: React.FC<HeaderActionsProps> = ({
  tenantId,
  actorName,
  actorRole,
  refreshing,
  onQuickAction,
  onRefresh,
  onOpenZReport,
}) => {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6 p-6 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight dark:text-white text-zinc-900 flex items-center gap-3">
          <BookOpen size={28} className="text-[#007AFF] stroke-[1.8]" />
          <span>Hesap Defteri</span>
        </h1>
        <p className="text-xs md:text-sm dark:text-zinc-400 text-zinc-600 mt-1">
          Günlük Kasa Mutabakatı &bull; Şube:{' '}
          <span className="dark:text-zinc-200 text-zinc-800 font-medium">{tenantId}</span> &bull; Yetkili:{' '}
          <span className="dark:text-zinc-200 text-zinc-800 font-medium">{actorName}</span> ({actorRole}) &bull;{' '}
          <span className="dark:text-zinc-400 text-zinc-500 font-mono">
            {new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onQuickAction('GELIR')}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
          <span>+ Gelir</span>
        </button>
        <button
          type="button"
          onClick={() => onQuickAction('GIDER')}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/30 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]" />
          <span>- Gider</span>
        </button>
        <button
          type="button"
          onClick={() => onQuickAction('BORC')}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.7)]" />
          <span>Borç</span>
        </button>
        <button
          type="button"
          onClick={() => onQuickAction('ALACAK')}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-600 dark:text-sky-400 border border-sky-500/30 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <span className="w-2 h-2 rounded-full bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,0.7)]" />
          <span>Alacak</span>
        </button>

        <div className="h-6 w-px dark:bg-white/10 bg-black/10 mx-1 hidden sm:block" />

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 border dark:border-white/15 border-black/10 backdrop-blur-xl shadow-sm transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
          title="Defteri Yenile"
        >
          <RefreshCw
            size={14}
            className={refreshing ? 'animate-spin text-zinc-400' : 'dark:text-zinc-300 text-zinc-600'}
          />
          <span>Defteri Yenile</span>
        </button>

        <button
          type="button"
          onClick={onOpenZReport}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 border dark:border-white/15 border-black/10 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <FileText size={15} />
          <span>Mali Z-Raporu İncele</span>
        </button>
      </div>
    </div>
  );
};

export default HeaderActions;
