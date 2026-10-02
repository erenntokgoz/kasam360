import { forwardRef, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, Printer, TrendingUp } from 'lucide-react';

import { ReportAdjustmentsTable } from './ReportAdjustmentsTable';
import { ReportCategoryVolume, ReportPaymentMethods } from './ReportDistributions';
import { ReportRangeBar } from './ReportRangeBar';
import { ReportReceiptsTable, ReportShiftsTable } from './ReportTables';
import { ReportSummaryCards } from './ReportSummaryCards';
import {
  buildPresetRange,
  ReportRange,
  ReportRangePresetId,
  rangeDayCount,
  toDateInputValue,
} from './reportTypes';
import {
  exportAdjustmentsReport,
  exportReceiptsReport,
  exportSalesReport,
  exportShiftsReport,
} from './export/reportExportActions';
import { useInitialReportRange, useReportsHub } from './useReportsHub';

type ReportTabId = 'ozet' | 'fisler' | 'vardiyalar' | 'iptaller';

interface ReportTab {
  id: ReportTabId;
  label: string;
}

const TABS: readonly ReportTab[] = [
  { id: 'ozet', label: 'Özet' },
  { id: 'fisler', label: 'Fişler' },
  { id: 'vardiyalar', label: 'Vardiyalar' },
  { id: 'iptaller', label: 'İptal / İade' },
];

const actionClass =
  'flex items-center gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.08] cursor-pointer';

/**
 * Birleşik rapor merkezi.
 *
 * Neden bu ekran var: `OwnerSalesTab` (sahibi paneli) ve `ReportsPanel`
 * (yönetim paneli) aynı veriyi üç ayrı komuttan, üç ayrı filtreyle
 * çekiyordu ve ikisi de tenant'sız komutlara bağlıydı. Artık tek ekran,
 * tek tarih aralığı, tek veri katmanı vardır; sahip ve müdür aynı sayfayı
 * görür.
 *
 * Yetki: `get_sales_report`, `get_shift_report`, `get_receipts_report` ve
 * `get_adjustments_report` backend'de `require_reporting` ile korunur
 * (işletme sahibi ve müdür). MASTER bu ekrana giremez.
 */
export const ReportsHub = forwardRef<HTMLDivElement>(function ReportsHub(_props, ref) {
  const initialRange = useInitialReportRange();
  const [range, setRange] = useState<ReportRange>(initialRange);
  const [preset, setPreset] = useState<ReportRangePresetId>('today');
  const [activeTab, setActiveTab] = useState<ReportTabId>('ozet');
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const hub = useReportsHub(range);

  const rangeLabel = useMemo(() => {
    const start = toDateInputValue(range.from).split('-').reverse().join('.');
    const end = toDateInputValue(range.to).split('-').reverse().join('.');
    return `${start} - ${end} (${rangeDayCount(range)} gün)`;
  }, [range]);

  const handlePresetChange = (next: ReportRangePresetId) => {
    setPreset(next);
    if (next !== 'custom') {
      setRange(buildPresetRange(next));
    }
  };

  const notify = (message: string) => {
    setExportMessage(message);
    window.setTimeout(() => setExportMessage(null), 3000);
  };

  const handleCsv = (excelComma: boolean) => {
    const suffix = excelComma ? 'Excel' : 'CSV';
    try {
      exportSalesReport(hub.sales, hub.receipts, rangeLabel, excelComma);
      exportReceiptsReport(hub.receipts, rangeLabel, excelComma);
      exportShiftsReport(hub.shifts, rangeLabel, excelComma);
      exportAdjustmentsReport(hub.adjustments, rangeLabel, excelComma);
      notify(`${suffix} dışa aktarımı indirildi (4 dosya).`);
    } catch (err) {
      notify('Dışa aktarım başarısız: ' + String(err));
    }
  };

  const handlePrint = () => {
    // PDF kütüphanesi yok: tarayıcının yazdırma penceresinde "PDF olarak
    // kaydet" yolu kullanılır. Böylece uydurma bir PDF üreticisi gerekmez.
    window.print();
  };

  return (
    <div ref={ref} className="reports-print-area mx-auto flex w-full max-w-7xl flex-col gap-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-zinc-900 dark:text-white">
          <TrendingUp size={20} className="text-[#007AFF]" />
          Raporlar
        </h2>

        <div className="reports-print-hide flex flex-wrap items-center gap-2">
          <button type="button" className={actionClass} onClick={() => handleCsv(false)}>
            <FileText size={13} />
            <span>CSV indir</span>
          </button>
          <button type="button" className={actionClass} onClick={() => handleCsv(true)}>
            <FileSpreadsheet size={13} />
            <span>Excel indir</span>
          </button>
          <button type="button" className={actionClass} onClick={handlePrint}>
            <Printer size={13} />
            <span>Yazdır / PDF</span>
          </button>
        </div>
      </header>

      {exportMessage && (
        <p className="rounded-xl border border-black/[0.06] dark:border-white/10 bg-white/70 dark:bg-white/[0.04] px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200">
          {exportMessage}
        </p>
      )}

      <ReportRangeBar
        range={range}
        preset={preset}
        onPresetChange={handlePresetChange}
        onRangeChange={(next) => {
          setPreset('custom');
          setRange(next);
        }}
        onRefresh={() => hub.refresh(true)}
        isRefreshing={hub.isRefreshing}
      />

      <ReportSummaryCards sales={hub.sales} receipts={hub.receipts} />

      {hub.sectionErrors.length > 0 && (
        <div className="rounded-2xl border border-[#FF9500]/25 bg-[#FF9500]/10 px-4 py-3 text-xs text-zinc-800 dark:text-zinc-100">
          <p className="font-semibold">Bazı rapor bölümleri okunamadı:</p>
          <ul className="mt-1 list-disc pl-4">
            {hub.sectionErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {hub.isLoading ? (
        <p className="py-16 text-center text-xs text-zinc-500">Raporlar yükleniyor...</p>
      ) : (
        <>
          <nav className="reports-print-hide flex flex-wrap items-center gap-1.5" aria-label="Rapor bölümleri">
            {TABS.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#007AFF] text-white'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {activeTab === 'ozet' && (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ReportPaymentMethods
                paymentMethods={hub.sales?.payment_methods ?? []}
                categoryVolume={hub.sales?.category_volume ?? []}
              />
              <ReportCategoryVolume
                paymentMethods={[]}
                categoryVolume={hub.sales?.category_volume ?? []}
              />
            </section>
          )}

          {activeTab === 'fisler' && <ReportReceiptsTable receipts={hub.receipts} />}
          {activeTab === 'vardiyalar' && <ReportShiftsTable shifts={hub.shifts} />}
          {activeTab === 'iptaller' && <ReportAdjustmentsTable adjustments={hub.adjustments} />}
        </>
      )}
    </div>
  );
});
