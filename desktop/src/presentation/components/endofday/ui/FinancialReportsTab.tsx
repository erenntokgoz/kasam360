import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Calendar,
  PieChart,
  RefreshCw,
  FileSpreadsheet,
} from 'lucide-react';
import { tauriInvoke } from '../../../../data/ipc/tauriInvoke';
import { usePermission } from '../../../hooks/usePermission';
import { toast } from '@core/components/ui/toast';

export interface CategorySummary {
  category: string;
  totalCents: number;
  count: number;
}

export interface MonthlyTrend {
  month: string;
  revenueCents: number;
  expenseCents: number;
  profitCents: number;
}

export interface FinancialReportData {
  totalRevenueCents: number;
  totalExpensesCents: number;
  netProfitCents: number;
  receivablesCents: number;
  payablesCents: number;
  expensesByCategory: CategorySummary[];
  monthlyTrend: MonthlyTrend[];
}

const CAT_LABELS: Record<string, string> = {
  RENT: 'Kira Gideri',
  UTILITIES: 'Faturalar',
  SUPPLIER: 'Toptancı & Mal Alımı',
  STAFF_ADVANCE: 'Personel Avansı',
  TAX: 'Vergi & Harç',
  MAINTENANCE: 'Bakım',
  PERSONAL: 'Patron Şahsi',
  OTHER: 'Diğer Sarfiyat',
};

/**
 * Finansal Raporlar & Analiz Sekmesi (P&L ve Kâr/Zarar Hub).
 * Gelir, gider, net kâr, gider pasta dağılımı, 6 aylık trend ve CSV dışa aktarımı sağlar.
 */
export const FinancialReportsTab: React.FC = () => {
  const [report, setReport] = useState<FinancialReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { role } = usePermission();

  // Bildirim yöneticisi
  const showToast = (title: string, type: 'success' | 'error' | 'info' = 'info') => {
    try {
      toast.add({ title, type });
    } catch {
      console.log(`[${type}] ${title}`);
    }
  };

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await tauriInvoke<FinancialReportData>('get_financial_report', { actorRole: role });
      setReport(data);
    } catch (err) {
      showToast('Finansal raporlar yÃ¼klenemedi', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [role]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const formatMoney = (cents: number) => {
    const liras = cents / 100;
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    }).format(liras);
  };

  const handleExportCsv = () => {
    if (!report) return;

    let csvContent = '';
    csvContent += 'KASAM360 FINANSAL RAPOR\n';
    csvContent += `Tarih,${new Date().toLocaleDateString('tr-TR')}\n\n`;
    csvContent += 'OZET BILANCO\n';
    csvContent += `Toplam Gelir / Ciro,${(report.totalRevenueCents / 100).toFixed(2)} TL\n`;
    csvContent += `Toplam Gider,${(report.totalExpensesCents / 100).toFixed(2)} TL\n`;
    csvContent += `Net Faaliyet Kari,${(report.netProfitCents / 100).toFixed(2)} TL\n`;
    csvContent += `Bekleyen Alacaklar,${(report.receivablesCents / 100).toFixed(2)} TL\n`;
    csvContent += `Bekleyen Borclar,${(report.payablesCents / 100).toFixed(2)} TL\n\n`;

    csvContent += 'GIDER KATEGORILERI\n';
    csvContent += 'Kategori,Tutar (TL),Adet\n';
    report.expensesByCategory.forEach((cat) => {
      const label = CAT_LABELS[cat.category] || cat.category;
      csvContent += `"${label.replace(/"/g, '""')}",${(cat.totalCents / 100).toFixed(2)},${cat.count}\n`;
    });

    csvContent += '\nAYLIK TREND\n';
    csvContent += 'Ay,Ciro (TL),Gider (TL),Kar (TL)\n';
    report.monthlyTrend.forEach((m) => {
      csvContent += `"${m.month.replace(/"/g, '""')}",${(m.revenueCents / 100).toFixed(2)},${(m.expenseCents / 100).toFixed(2)},${(m.profitCents / 100).toFixed(2)}\n`;
    });

    // Excel Türkçe karakter desteği için UTF-8 BOM ekleme
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `kasam360_finans_raporu_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Finansal rapor CSV olarak indirildi', 'success');
  };

  if (isLoading) {
    return (
      <div className="p-16 text-center dark:text-zinc-400 text-zinc-500 text-xs flex items-center justify-center gap-2">
        <RefreshCw className="animate-spin" size={16} />
        <span>Finansal analizler hesaplanıyor...</span>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-12 text-center dark:bg-white/[0.02] bg-black/[0.02] rounded-3xl border dark:border-white/10 border-black/10">
        <p className="text-sm dark:text-white text-zinc-800">Rapor verisi bulunamadı</p>
      </div>
    );
  }

  const isProfitable = report.netProfitCents >= 0;

  return (
    <div className="space-y-6">
      {/* Üst Başlık ve CSV İndirme Butonu */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold dark:text-white text-zinc-900 tracking-tight">
            İşletme Finansal Analizi & Kâr/Zarar (P&L)
          </h3>
          <p className="text-xs dark:text-zinc-400 text-zinc-600 mt-0.5">
            Satış hasılatı, işletme giderleri, net marj ve likidite dengesi
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="flex items-center gap-2 h-10 px-4 rounded-xl dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 border dark:border-white/15 border-black/10 text-xs font-semibold shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <FileSpreadsheet size={15} className="text-emerald-500" />
          <span>CSV Rapor İndir</span>
        </button>
      </div>

      {/* 3 Ana P&L Kartı */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Toplam Satış Hasılatı */}
        <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-3xl p-5 shadow-xl apple-specular">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
              Toplam Satış Geliri
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-500">
              <TrendingUp size={18} />
            </div>
          </div>
          <p className="text-2xl md:text-3xl font-bold font-mono dark:text-white text-zinc-900 tabular-nums">
            {formatMoney(report.totalRevenueCents)}
          </p>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">Brüt Tahsil Edilen Ciro</p>
        </div>

        {/* Toplam İşletme Gideri */}
        <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-3xl p-5 shadow-xl apple-specular">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
              Toplam İşletme Gideri
            </span>
            <div className="p-2 rounded-xl bg-rose-500/15 text-rose-500">
              <TrendingDown size={18} />
            </div>
          </div>
          <p className="text-2xl md:text-3xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">
            {formatMoney(report.totalExpensesCents)}
          </p>
          <p className="text-[11px] text-rose-700 dark:text-rose-300/70 mt-1">Kira, Fatura, Mal ve Personel</p>
        </div>

        {/* Net Faaliyet Kârı */}
        <div className={`backdrop-blur-xl border rounded-3xl p-5 shadow-xl apple-specular ${
          isProfitable
            ? 'dark:bg-emerald-950/20 bg-emerald-500/10 border-emerald-500/30'
            : 'dark:bg-rose-950/20 bg-rose-500/10 border-rose-500/30'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">
              Net Faaliyet Kârı (P&L)
            </span>
            <div className={`p-2 rounded-xl ${isProfitable ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}`}>
              <BarChart3 size={18} />
            </div>
          </div>
          <p className={`text-2xl md:text-3xl font-bold font-mono tabular-nums ${
            isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}>
            {formatMoney(report.netProfitCents)}
          </p>
          <p className="text-[11px] dark:text-zinc-400 text-zinc-600 mt-1">
            {isProfitable ? 'Net kâr pozitif (Faaliyet Kârı)' : 'Net kâr negatif (İşletme Zararı)'}
          </p>
        </div>
      </div>

      {/* İkili Analiz Paneli: Gider Dağılımı ve 6 Aylık Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sol: Gider Dağılımı (Kategori Kırılımı) */}
        <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-3xl p-5 shadow-xl apple-specular">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold dark:text-white text-zinc-900 flex items-center gap-2">
              <PieChart size={16} className="text-[#007AFF]" />
              <span>Gider Dağılımı (Kategori Bazlı)</span>
            </h4>
            <span className="text-xs font-mono dark:text-zinc-400 text-zinc-500">
              Toplam {formatMoney(report.totalExpensesCents)}
            </span>
          </div>

          <div className="space-y-3.5">
            {report.expensesByCategory.length === 0 ? (
              <div className="py-8 text-center text-xs dark:text-zinc-500 text-zinc-400">
                Kayıtlı gider bulunmuyor.
              </div>
            ) : (
              report.expensesByCategory.map((cat) => {
                const percent = report.totalExpensesCents > 0
                  ? Math.round((cat.totalCents / report.totalExpensesCents) * 100)
                  : 0;

                return (
                  <div key={cat.category} className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="dark:text-zinc-300 text-zinc-700">
                        {CAT_LABELS[cat.category] || cat.category} ({cat.count})
                      </span>
                      <span className="font-mono dark:text-zinc-200 text-zinc-900 tabular-nums">
                        {formatMoney(cat.totalCents)} ({percent}%)
                      </span>
                    </div>
                    {/* Apple HIG Progress Bar */}
                    <div className="h-2 w-full rounded-full dark:bg-white/10 bg-black/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#007AFF] transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Sağ: 6 Aylık Ciro vs Gider Trendi */}
        <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-3xl p-5 shadow-xl apple-specular">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold dark:text-white text-zinc-900 flex items-center gap-2">
              <Calendar size={16} className="text-purple-500" />
              <span>Aylık Mali Trend</span>
            </h4>
            <span className="text-xs dark:text-zinc-400 text-zinc-500">Son Aylar</span>
          </div>

          <div className="space-y-3">
            {report.monthlyTrend.length === 0 ? (
              <div className="py-8 text-center text-xs dark:text-zinc-500 text-zinc-400">
                Yeterli geçmiş trend verisi bulunmuyor.
              </div>
            ) : (
              report.monthlyTrend.map((m) => (
                <div
                  key={m.month}
                  className="p-3 rounded-2xl dark:bg-white/[0.02] bg-black/[0.02] border dark:border-white/5 border-black/5 flex items-center justify-between"
                >
                  <div className="font-mono text-xs font-bold dark:text-zinc-300 text-zinc-700">
                    {m.month}
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                    <div>
                      <span className="text-[10px] text-zinc-500 block">Ciro:</span>
                      <span className="text-emerald-500 font-semibold">{formatMoney(m.revenueCents)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 block">Gider:</span>
                      <span className="text-rose-500 font-semibold">{formatMoney(m.expenseCents)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 block">Kâr:</span>
                      <span className={m.profitCents >= 0 ? 'text-[#007AFF] font-bold' : 'text-amber-500 font-bold'}>
                        {formatMoney(m.profitCents)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
