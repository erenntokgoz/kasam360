import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download } from 'lucide-react';
import { errorText } from '../../../lib/cariInput';
import { toLocalIso } from '../../../lib/dateRange';
import { useUIStore } from '../../../stores/uiStore';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { invokeIPC } from '../../../services/tauriClient';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { MonthPicker } from '../../../ui/MonthPicker';
import { OWNER_ONLY_REPORTS, REPORTS, type ReportKey, type ReportTable } from './reportDefinitions';
import type { ReportFileMeta } from './reportCsv';
import { exportReport } from './reportXlsx';

const two = (value: number) => String(value).padStart(2, '0');
const dayText = (date: Date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
const daysAgo = (days: number) => {
  const now = new Date();
  return dayText(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
};

/** Hazır dönemler yalnız tarih alanlarını doldurur; seçili dönem her zaman alanlarda görünür. */
const QUICK: { label: string; from: () => string; to: () => string }[] = [
  { label: 'Bugün', from: () => daysAgo(0), to: () => daysAgo(0) },
  { label: 'Dün', from: () => daysAgo(1), to: () => daysAgo(1) },
  { label: 'Son 7 Gün', from: () => daysAgo(6), to: () => daysAgo(0) },
  { label: 'Son 30 Gün', from: () => daysAgo(29), to: () => daysAgo(0) },
];

/** Seçili ay: ayın ilk günü ile son günü (açık ayda bugün). Tarih alanları bu aralığı gösterir. */
function monthRange(month: string) {
  const [year, mon] = month.split('-').map(Number);
  const last = dayText(new Date(year, mon, 0));
  const today = dayText(new Date());
  return { from: `${month}-01`, to: last < today ? last : today };
}

/** Yerel gün sınırları: `YYYY-AA-GG` 00:00 ile 23:59:59 arası, yerel ofsetle. */
function dayBounds(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return { from: toLocalIso(new Date(fy, fm - 1, fd)), to: toLocalIso(new Date(ty, tm - 1, td, 23, 59, 59)) };
}

/** Sayı ve tutar sütunları sağa yaslanır; metin içeren sütun solda kalır (tutarlar alt alta okunur). */
const NUMBER_CELL = /^[-−+]?\d[\d.,\s]*(?:\s?(?:₺|TL|%|adet))?$/i;
function numericColumns(columns: string[], rows: string[][]): boolean[] {
  return columns.map((_, index) => {
    const cells = rows.map((row) => row[index] ?? '').filter((cell) => cell.trim() !== '' && cell.trim() !== '-');
    return cells.length > 0 && cells.every((cell) => NUMBER_CELL.test(cell.trim()));
  });
}

export const ReportsTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const keys = (Object.keys(REPORTS) as ReportKey[]).filter((key) => isOwner || !OWNER_ONLY_REPORTS.has(key));
  const [report, setReport] = useState<ReportKey>('SALES');
  const [from, setFrom] = useState(() => daysAgo(0));
  const [to, setTo] = useState(() => daysAgo(0));
  // Rapor türü seçimi Yönetim başlık bandındaki yuvaya taşınır; yuva yoksa yerinde çizilir.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setSlot(document.getElementById('erp-title-slot')); }, []);
  const [table, setTable] = useState<ReportTable | null>(null);
  const [productId, setProductId] = useState('');
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const hasProductFilter = 'productFilter' in REPORTS[report] && REPORTS[report].productFilter === true;
  useEffect(() => {
    if (!hasProductFilter || products.length > 0) return undefined;
    let current = true;
    const { actorRole, tenantId } = sessionArgs();
    // Süzgeç listesi okunamazsa rapor yine tüm kalemlerle çalışır; hata raporun kendisinde görünür.
    invokeIPC<{ id: string; name: string }[]>('get_management_products', { actorRole, tenantId })
      .then((rows) => {
        if (current) setProducts(rows.map((row) => ({ id: row.id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name, 'tr')));
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, [hasProductFilter, products.length]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Seçili aralık tam bir takvim ayıysa ay düğmesi seçili görünür.
  const monthValue = from.slice(0, 7) === to.slice(0, 7) && from === `${from.slice(0, 7)}-01` && to === monthRange(from.slice(0, 7)).to ? from.slice(0, 7) : '';
  const rangeError = from === '' || to === '' ? 'Başlangıç ve bitiş seçin.' : from > to ? 'Başlangıç bitişten sonra olamaz.' : null;

  useEffect(() => {
    let current = true;
    setTable(null);
    setError(null);
    if (rangeError) return undefined;
    const { actorRole, tenantId } = sessionArgs();
    REPORTS[report]
      .load({ actorRole, tenantId, ...dayBounds(from, to), fromDate: from, toDate: to, productId: hasProductFilter ? productId : undefined })
      .then((next) => {
        if (current) setTable(next);
      })
      .catch((caught) => {
        if (current) setError(errorText(caught));
      });
    return () => {
      current = false;
    };
  }, [report, from, to, rangeError, hasProductFilter, productId]);

  const productName = products.find((item) => item.id === productId)?.name;
  const meta: ReportFileMeta = {
    title: REPORTS[report].label,
    from,
    to,
    filters: [['Rapor türü', REPORTS[report].label], ...(hasProductFilter && productName ? [['Kalem', productName] as [string, string]] : [])],
  };

  const numeric = table ? numericColumns(table.columns, table.rows) : [];
  const reportSeg = (
    <div className="seg" role="group" aria-label="Rapor">
      {keys.map((key) => (
        <button key={key} type="button" className="seg-btn" aria-pressed={report === key} onClick={() => setReport(key)}>
          {REPORTS[key].label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {slot ? createPortal(reportSeg, slot) : reportSeg}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">
          Başlangıç
          <Input type="date" className="!w-44 tabular-nums" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">
          Bitiş
          <Input type="date" className="!w-44 tabular-nums" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
        </label>
        <div className="seg" role="group" aria-label="Hazır dönem">
          {QUICK.map((item) => {
            const active = from === item.from() && to === item.to();
            return (
              <button key={item.label} type="button" className="seg-btn" aria-pressed={active}
                onClick={() => { setFrom(item.from()); setTo(item.to()); }}>
                {item.label}
              </button>
            );
          })}
          <MonthPicker value={monthValue} current={dayText(new Date()).slice(0, 7)} className="seg-month" onSelect={(month) => {
            const range = monthRange(month);
            setFrom(range.from);
            setTo(range.to);
          }} />
        </div>
        {hasProductFilter ? (
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">
            Kalem
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className="min-h-12 w-56 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]"
            >
              <option value="">Tüm kalemler</option>
              {products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        ) : null}
        <Button
          variant="secondary"
          className="min-h-12 text-sm font-bold ml-auto"
          disabled={!table || !!rangeError || exporting}
          isLoading={exporting}
          onClick={() => {
            if (!table || exporting) return;
            setExportError(null);
            setExporting(true);
            void exportReport(meta, table, report)
              .then(() => useUIStore.getState().showNotice('Excel raporu hazırlandı.'))
              .catch((caught) => setExportError(errorText(caught)))
              .finally(() => setExporting(false));
          }}
        >
          <Download className="w-4 h-4 mr-1.5" />
          <span>Excel'e Aktar</span>
        </Button>
      </div>

      {exportError ? <ErrorToast message={`Excel çıktısı oluşturulamadı: ${exportError}`} /> : null}

      {table?.warning ? (
        <p role="status" className="p-3 rounded-lg text-sm font-semibold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          {table.warning}
        </p>
      ) : null}

      {table?.summary.length ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {table.summary.map((item) => (
            <div key={item.label} className="paper border border-[var(--border)] rounded-xl p-4">
              <span className="text-xs text-[var(--text-secondary)] block">{item.label}</span>
              <span className="text-xl font-bold tabular-nums text-[var(--text-primary)] mt-0.5 block">{item.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {rangeError ? (
        <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{rangeError}</p>
      ) : error ? (
        <><p className="text-sm text-[var(--text-secondary)]">Rapor okunamadı.</p><ErrorToast message={`Rapor okunamadı: ${error}`} /></>
      ) : !table ? (
        <p className="text-sm text-[var(--text-secondary)]">Rapor hazırlanıyor…</p>
      ) : table.rows.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">{table.emptyText}</p>
      ) : (
        <div className="paper border border-[var(--border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)]">
                {table.columns.map((column, index) => (
                  <th key={column} className={`font-medium px-4 py-3 whitespace-nowrap ${numeric[index] ? 'text-right' : ''}`}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={`${row[0]}-${index}`} className="border-t border-[var(--border)]">
                  {row.map((cell, column) => (
                    <td key={column} className={`px-4 py-2.5 tabular-nums text-[var(--text-primary)] whitespace-nowrap ${numeric[column] ? 'text-right' : ''}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
