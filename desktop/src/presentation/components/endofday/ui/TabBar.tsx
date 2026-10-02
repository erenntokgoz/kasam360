import React from 'react';
import { Layers, Users, ArrowRightLeft, FileText, BarChart3, Calendar } from 'lucide-react';
import type { TabType } from '../types';

interface TabBarProps {
  activeTab: TabType;
  onChange: (tab: TabType) => void;
  openShiftCount: number;
  shiftHistoryCount: number;
  canSeeFinancialReports: boolean;
}

const TAB_ACTIVE =
  'dark:bg-white/15 bg-white text-zinc-900 dark:text-white shadow-sm backdrop-blur-md';
const TAB_IDLE =
  'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.03]';

// 5+1 sekme kapsülü (Apple segmented control)
export const TabBar: React.FC<TabBarProps> = ({
  activeTab,
  onChange,
  openShiftCount,
  shiftHistoryCount,
  canSeeFinancialReports,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-3xl mb-6 w-fit shrink-0 backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 dark:border-white/10 border-black/[0.08] border shadow-xl">
      <button
        type="button"
        onClick={() => onChange('GUNUN_DEFTERI')}
        title="Bugünkü Gün Sonu"
        aria-label="Bugünkü Gün Sonu"
        className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
          activeTab === 'GUNUN_DEFTERI' ? TAB_ACTIVE : TAB_IDLE
        }`}
      >
        <Layers size={14} />
        <span>Günün Defteri (Kasa & Vardiyalar)</span>
        <span className="sr-only">Bugünkü Gün Sonu</span>
        {openShiftCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30 font-mono">
            {openShiftCount} Kasa Açık
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => onChange('CARI_REHBERLER')}
        className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
          activeTab === 'CARI_REHBERLER' ? TAB_ACTIVE : TAB_IDLE
        }`}
      >
        <Users size={14} />
        <span>Cari Rehberler (5 Rehber)</span>
      </button>

      <button
        type="button"
        onClick={() => onChange('BORC_ALACAK')}
        className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
          activeTab === 'BORC_ALACAK' ? TAB_ACTIVE : TAB_IDLE
        }`}
      >
        <ArrowRightLeft size={14} />
        <span>Borç & Alacak Bilanço</span>
      </button>

      <button
        type="button"
        onClick={() => onChange('GIDER_DEFTERI')}
        className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
          activeTab === 'GIDER_DEFTERI' ? TAB_ACTIVE : TAB_IDLE
        }`}
      >
        <FileText size={14} />
        <span>Gider Defteri</span>
      </button>

      {/* P&L sekmesi "Raporlar" yetkisine bağlıdır: kasiyer Hesap Defteri'ne
          kısmen erişir ancak gelir/gider bilançosunu göremez (SPEC 34). */}
      {canSeeFinancialReports && (
        <button
          type="button"
          onClick={() => onChange('FINANSAL_RAPORLAR')}
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'FINANSAL_RAPORLAR' ? TAB_ACTIVE : TAB_IDLE
          }`}
        >
          <BarChart3 size={14} />
          <span>Finansal Raporlar (P&L)</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => onChange('GECMIS_ARSIV')}
        title="Geçmiş Z-Raporları Arşivi"
        aria-label="Geçmiş Z-Raporları Arşivi"
        className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
          activeTab === 'GECMIS_ARSIV' ? TAB_ACTIVE : TAB_IDLE
        }`}
      >
        <Calendar size={14} />
        <span>Geçmiş Defter Kayıtları (Arşiv)</span>
        <span className="sr-only">Geçmiş Z-Raporları Arşivi</span>
        {shiftHistoryCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full dark:bg-white/10 bg-black/[0.05] dark:text-zinc-300 text-zinc-700 font-mono">
            {shiftHistoryCount}
          </span>
        )}
      </button>
    </div>
  );
};

export default TabBar;
