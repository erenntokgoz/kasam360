import { forwardRef, useMemo, useState } from 'react';
import { Clock, Printer, Receipt, Search } from 'lucide-react';

import { AppleGlassCard } from '../common/AppleGlassCard';
import { MoneyDisplay } from '../common/MoneyDisplay';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { ReceiptReportRow, ShiftReportRow } from './reportTypes';

const tableHeadClass =
  'py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400';
const cellClass = 'py-3 px-4 text-xs text-zinc-800 dark:text-zinc-100';
const inputClass =
  'w-full rounded-xl border border-black/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-[#007AFF]/50 transition-colors';

function formatDateTime(value: string): string {
  if (!value) return '-';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-64">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${inputClass} pl-9`}
      />
    </div>
  );
}

export interface ReportReceiptsTableProps {
  receipts: ReceiptReportRow[];
}

export const ReportReceiptsTable = forwardRef<HTMLDivElement, ReportReceiptsTableProps>(
  function ReportReceiptsTable({ receipts }, ref) {
    const [searchTerm, setSearchTerm] = useState('');
    const [printStatus, setPrintStatus] = useState<string | null>(null);
    const user = useAuthStore((state) => state.user);

    const filtered = useMemo(() => {
      const term = searchTerm.trim().toLowerCase();
      if (!term) return receipts;
      return receipts.filter(
        (row) =>
          row.id.toLowerCase().includes(term) ||
          (row.table_id || '').toLowerCase().includes(term) ||
          (row.cashier_id || '').toLowerCase().includes(term),
      );
    }, [receipts, searchTerm]);

    const handlePrint = async (row: ReceiptReportRow) => {
      setPrintStatus('Yazıcıya gönderiliyor...');
      try {
        await tauriInvoke('print_receipt', {
          receiptId: row.id,
          actorRole: user?.role,
          tenantId: user?.tenantId,
        });
        setPrintStatus('Fiş yazıcıya gönderildi.');
      } catch (err) {
        setPrintStatus('Yazdırma hatası: ' + String(err));
      }
      window.setTimeout(() => setPrintStatus(null), 3000);
    };

    return (
      <AppleGlassCard ref={ref} variant="subtle" className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
            <Receipt size={16} className="text-[#007AFF]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">Fiş geçmişi</h3>
            <span className="font-mono text-[11px] text-zinc-500">{filtered.length} satır</span>
          </div>
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Fiş, masa veya kasiyer ara"
          />
        </div>

        {printStatus && (
          <p className="rounded-xl border border-black/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.04] px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200">
            {printStatus}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/10">
                <th className={tableHeadClass}>Fiş</th>
                <th className={tableHeadClass}>Masa</th>
                <th className={tableHeadClass}>Kasiyer</th>
                <th className={tableHeadClass}>Tarih</th>
                <th className={tableHeadClass}>Kalem</th>
                <th className={`${tableHeadClass} text-right`}>Tutar</th>
                <th className={`${tableHeadClass} text-right`}>İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/5">
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                >
                  <td className={`${cellClass} font-mono text-[11px] text-[#007AFF]`}>{row.id}</td>
                  <td className={cellClass}>{row.table_id || '-'}</td>
                  <td className={cellClass}>{row.cashier_id || 'Otomatik'}</td>
                  <td className={`${cellClass} text-[11px] text-zinc-500 dark:text-zinc-400`}>
                    {formatDateTime(row.created_at)}
                  </td>
                  <td className={`${cellClass} font-mono`}>{row.item_count}</td>
                  <td className={`${cellClass} text-right font-semibold`}>
                    <MoneyDisplay amountInCents={row.total_cents} />
                  </td>
                  <td className={`${cellClass} text-right`}>
                    <button
                      type="button"
                      onClick={() => void handlePrint(row)}
                      title="Fişi yazdır"
                      aria-label={`Fiş ${row.id} numaralı kaydı yazdır`}
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer"
                    >
                      <Printer size={14} />
                    </button>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-zinc-500">
                    {searchTerm
                      ? `"${searchTerm}" aramasına uygun fiş bulunamadı.`
                      : 'Seçili aralıkta fiş kaydı bulunmuyor.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppleGlassCard>
    );
  },
);

export interface ReportShiftsTableProps {
  shifts: ShiftReportRow[];
}

export const ReportShiftsTable = forwardRef<HTMLDivElement, ReportShiftsTableProps>(
  function ReportShiftsTable({ shifts }, ref) {
    const [searchTerm, setSearchTerm] = useState('');

    const filtered = useMemo(() => {
      const term = searchTerm.trim().toLowerCase();
      if (!term) return shifts;
      return shifts.filter(
        (row) =>
          row.id.toLowerCase().includes(term) ||
          (row.cashier_id || '').toLowerCase().includes(term) ||
          (row.cashier_name || '').toLowerCase().includes(term),
      );
    }, [shifts, searchTerm]);

    return (
      <AppleGlassCard ref={ref} variant="subtle" className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
            <Clock size={16} className="text-[#007AFF]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">Vardiya geçmişi</h3>
            <span className="font-mono text-[11px] text-zinc-500">{filtered.length} satır</span>
          </div>
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Vardiya veya kasiyer ara"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/10">
                <th className={tableHeadClass}>Vardiya</th>
                <th className={tableHeadClass}>Kasiyer</th>
                <th className={tableHeadClass}>Açılış</th>
                <th className={tableHeadClass}>Kapanış</th>
                <th className={`${tableHeadClass} text-right`}>Beklenen</th>
                <th className={`${tableHeadClass} text-right`}>Gerçek</th>
                <th className={`${tableHeadClass} text-right`}>Fark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/5">
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                >
                  <td className={`${cellClass} font-mono text-[11px] text-[#007AFF]`}>{row.id}</td>
                  <td className={cellClass}>
                    {row.cashier_name || row.cashier_id || '-'}
                  </td>
                  <td className={`${cellClass} text-[11px] text-zinc-500 dark:text-zinc-400`}>
                    {formatDateTime(row.opened_at)}
                  </td>
                  <td className={`${cellClass} text-[11px] text-zinc-500 dark:text-zinc-400`}>
                    {row.closed_at ? formatDateTime(row.closed_at) : 'Açık'}
                  </td>
                  <td className={`${cellClass} text-right`}>
                    <MoneyDisplay amountInCents={row.expected_amount_cents} />
                  </td>
                  <td className={`${cellClass} text-right`}>
                    <MoneyDisplay amountInCents={row.actual_amount_cents ?? 0} />
                  </td>
                  <td className={`${cellClass} text-right font-semibold`}>
                    {row.difference_cents === null ? (
                      <span className="text-zinc-500">-</span>
                    ) : (
                      <MoneyDisplay amountInCents={row.difference_cents} />
                    )}
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-zinc-500">
                    {searchTerm
                      ? `"${searchTerm}" aramasına uygun vardiya bulunamadı.`
                      : 'Seçili aralıkta vardiya kaydı bulunmuyor.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppleGlassCard>
    );
  },
);
