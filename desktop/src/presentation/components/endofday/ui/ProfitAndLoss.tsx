import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, TrendingUp, TrendingDown, Download, Scale } from 'lucide-react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { formatCurrency } from '../helpers';

export interface CategorySummary {
  category: string;
  total_cents: number;
  count: number;
}

export interface MonthTrend {
  month: string;
  revenue_cents: number;
  expense_cents: number;
  profit_cents: number;
}

export interface FinancialReport {
  total_revenue_cents: number;
  total_sales_revenue_cents: number;
  total_debt_collected_cents: number;
  total_expenses_cents: number;
  net_profit_cents: number;
  receivables_cents: number;
  payables_cents: number;
  expenses_by_category: CategorySummary[];
  monthly_trend: MonthTrend[];
}

export interface FinancialExport {
  csv: string;
  rowCount: number;
  fileName: string;
  generatedAt: string;
}

interface ProfitAndLossProps {
  onNotify: (message: string, type: 'success' | 'error' | 'info') => void;
}

/**
 * Dönem toplami ile aylik trendin net toplami ayni olmalidir (B5.2).
 * Cikifti; cift sayim duzeltmesi iki yolu da ayni kuraldan besler.
 * Uyuşmazlık rapor güvenilmezdir: ekranda uyari metni gosterilir.
 */
export const isTrendConsistent = (report: FinancialReport): boolean =>
  report.monthly_trend.reduce((sum, m) => sum + m.profit_cents, 0) === report.net_profit_cents;

/** Aylik trend net toplami (rapor yoksa 0). */
export const trendNetTotal = (report: FinancialReport | null): number =>
  report ? report.monthly_trend.reduce((sum, m) => sum + m.profit_cents, 0) : 0;

/**
 * P&L ekrani. AGENTS.md 3.2: sahte sparkline ve anlamsiz SVG wave yasaktir;
 * trend gercek aylik veriyle tablo olarak gosterilir.
 * Dönem toplami ve aylik trend ayni cift sayim kuralini paylasir (B5.2).
 */
export const ProfitAndLoss: React.FC<ProfitAndLossProps> = ({ onNotify }) => {
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pnl = await invoke<FinancialReport>('get_financial_report', {});
      setReport(pnl);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Dönem toplamı ile aylık trendin net toplamı aynı olmalıdır (B5.2 kabul kriteri).
  const trendTotal = trendNetTotal(report);
  const trendMatchesTotal = report ? isTrendConsistent(report) : true;

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await invoke<FinancialExport>('export_financial_report', {});
      // Dosya kaydetme Tauri dialog ile kullanıcida olur; burada CSV icerigi hazirlanir.
      const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.fileName;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(`${data.fileName} indirildi (${data.rowCount} satir).`, 'success');
    } catch (e) {
      onNotify(`Disa aktarma basarisiz: ${String(e)}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-xl flex items-center gap-2 text-sm dark:text-zinc-400 text-zinc-500">
        <Loader2 size={16} className="animate-spin" />
        <span>Finansal rapor hazirlaniyor...</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border border-red-500/30 rounded-3xl p-6 shadow-xl text-sm text-red-600 dark:text-red-400">
        Finansal rapor alinamadi: {error ?? 'bilinmeyen hata'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
              <Scale size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold dark:text-white text-zinc-900">Gelir - Gider - Net (P&amp;L)</h2>
              <p className="text-xs dark:text-zinc-400 text-zinc-500">
                Borc tahsilatlari bagli siparise baglanmissa giderden cikarilir (cift sayim duzeltmesi)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 border dark:border-white/15 border-black/10 backdrop-blur-xl shadow-sm transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
          >
            <Download size={14} className={exporting ? 'animate-bounce' : ''} />
            <span>{exporting ? 'Hazirlaniyor...' : 'CSV Disa Aktar'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
            <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500 flex items-center gap-1.5">
              <TrendingUp size={12} /> Toplam Gelir
            </p>
            <p className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrency(report.total_revenue_cents)}
            </p>
            <p className="text-[11px] dark:text-zinc-500 text-zinc-400">
              Satis {formatCurrency(report.total_sales_revenue_cents)} + Tahsilat{' '}
              {formatCurrency(report.total_debt_collected_cents)}
            </p>
          </div>

          <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
            <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500 flex items-center gap-1.5">
              <TrendingDown size={12} /> Toplam Gider
            </p>
            <p className="text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
              {formatCurrency(report.total_expenses_cents)}
            </p>
          </div>

          <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
            <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Net Kâr</p>
            <p
              data-testid="pnl-net"
              className={`text-lg font-semibold tabular-nums ${
                report.net_profit_cents >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {formatCurrency(report.net_profit_cents)}
            </p>
          </div>
        </div>

        <p
          data-testid="pnl-trend-consistency"
          className="text-[11px] dark:text-zinc-400 text-zinc-500 mt-3"
        >
          Aylik trend net toplami {formatCurrency(trendTotal)} &bull;{' '}
          {trendMatchesTotal
            ? 'Donem toplami ile tutarli'
            : 'UYARI: Donem toplami ile aylik trend uyusmuyor, rapor guvenilmez'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
          <h3 className="text-sm font-semibold dark:text-white text-zinc-900 mb-3">Kategori Gider Kirilimi</h3>
          {report.expenses_by_category.length === 0 ? (
            <p className="text-xs dark:text-zinc-400 text-zinc-500">Bu donemde gider kaydi bulunmuyor.</p>
          ) : (
            <div className="space-y-2">
              {report.expenses_by_category.map((c) => (
                <div key={c.category} className="flex items-center justify-between gap-3 text-sm">
                  <span className="dark:text-zinc-300 text-zinc-700 truncate">
                    {c.category} <span className="text-[11px] text-zinc-500">({c.count} kayit)</span>
                  </span>
                  <span className="tabular-nums font-medium dark:text-white text-zinc-900">
                    {formatCurrency(c.total_cents)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
          <h3 className="text-sm font-semibold dark:text-white text-zinc-900 mb-3">Aylik Trend</h3>
          {report.monthly_trend.length === 0 ? (
            <p className="text-xs dark:text-zinc-400 text-zinc-500">Gosterilecek aylik veri bulunmuyor.</p>
          ) : (
            <table className="w-full text-left text-xs dark:text-zinc-300 text-zinc-700">
              <thead>
                <tr className="border-b dark:border-white/10 border-black/[0.08]">
                  <th className="py-2">Ay</th>
                  <th className="py-2 text-right">Gelir</th>
                  <th className="py-2 text-right">Gider</th>
                  <th className="py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-white/5 divide-black/[0.05]">
                {report.monthly_trend.map((m) => (
                  <tr key={m.month}>
                    <td className="py-2 font-medium">{m.month}</td>
                    <td className="py-2 text-right tabular-nums">{formatCurrency(m.revenue_cents)}</td>
                    <td className="py-2 text-right tabular-nums">{formatCurrency(m.expense_cents)}</td>
                    <td
                      className={`py-2 text-right tabular-nums font-semibold ${
                        m.profit_cents >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {formatCurrency(m.profit_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfitAndLoss;
