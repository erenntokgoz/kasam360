import { forwardRef, useMemo, useState } from 'react';
import { FileWarning, ShieldCheck } from 'lucide-react';

import { AppleGlassCard } from '../common/AppleGlassCard';
import { MoneyDisplay } from '../common/MoneyDisplay';
import { ADJUSTMENT_KIND_LABELS, AdjustmentsReport } from './reportTypes';

const tableHeadClass =
  'py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400';
const cellClass = 'py-3 px-4 text-xs text-zinc-800 dark:text-zinc-100';

const kindTone: Readonly<Record<string, string>> = {
  VOID: 'bg-[#FF3B30]/10 text-[#FF3B30] border-[#FF3B30]/20',
  REFUND: 'bg-[#FF9500]/10 text-[#FF9500] border-[#FF9500]/20',
  WASTE: 'bg-[#AF52DE]/10 text-[#AF52DE] border-[#AF52DE]/20',
};

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

export interface ReportAdjustmentsTableProps {
  adjustments: AdjustmentsReport | null;
}

/**
 * İptal / iade / zayi hareketleri ve **onaylayan kişi**.
 *
 * Neden "kayıt yok" ayrı gösteriliyor: iade (`payment:refund`) ve zayi
 * (`stock:waste`) yazma yolları henüz yok. Bu iki hareket için uydurma sıfır
 * satır üretmek yerine `kinds_without_records` listesi okunur ve arayüz
 * "kayıt yok" der.
 */
export const ReportAdjustmentsTable = forwardRef<HTMLDivElement, ReportAdjustmentsTableProps>(
  function ReportAdjustmentsTable({ adjustments }, ref) {
    const [kindFilter, setKindFilter] = useState<string>('ALL');
    const rows = adjustments?.rows ?? [];
    const missing = adjustments?.kinds_without_records ?? [];

    const filtered = useMemo(
      () => (kindFilter === 'ALL' ? rows : rows.filter((row) => row.kind === kindFilter)),
      [rows, kindFilter],
    );

    const kinds = useMemo(() => {
      const present = new Set(rows.map((row) => row.kind));
      const ordered = ['VOID', 'REFUND', 'WASTE'].filter((kind) => present.has(kind));
      return ['ALL', ...ordered];
    }, [rows]);

    return (
      <AppleGlassCard ref={ref} variant="subtle" className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
            <ShieldCheck size={16} className="text-[#007AFF]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">
              İptal, iade ve zayi
            </h3>
            <span className="font-mono text-[11px] text-zinc-500">{filtered.length} satır</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {kinds.map((kind) => {
              const active = kind === kindFilter;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setKindFilter(kind)}
                  aria-pressed={active}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#007AFF] text-white'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  {kind === 'ALL' ? 'Tümü' : ADJUSTMENT_KIND_LABELS[kind] || kind}
                </button>
              );
            })}
          </div>
        </div>

        {missing.length > 0 && (
          <p className="flex items-start gap-2 rounded-xl border border-black/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300">
            <FileWarning size={13} className="mt-0.5 shrink-0 text-[#FF9500]" />
            <span>
              {missing.map((kind) => ADJUSTMENT_KIND_LABELS[kind] || kind).join(', ')} hareketi
              için seçili aralıkta kayıt yok. Kayıt yolu olmayan bir hareket için sıfır tutar
              gösterilmez.
            </span>
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/10">
                <th className={tableHeadClass}>Tür</th>
                <th className={tableHeadClass}>Kayıt</th>
                <th className={tableHeadClass}>Sebep</th>
                <th className={tableHeadClass}>İşlemi yapan</th>
                <th className={tableHeadClass}>Onaylayan</th>
                <th className={tableHeadClass}>Tarih</th>
                <th className={`${tableHeadClass} text-right`}>Tutar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/5">
              {filtered.map((row, index) => (
                <tr
                  key={`${row.kind}-${row.resource_id}-${index}`}
                  className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                >
                  <td className={cellClass}>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        kindTone[row.kind] || 'border-black/10 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {ADJUSTMENT_KIND_LABELS[row.kind] || row.kind}
                    </span>
                  </td>
                  <td className={`${cellClass} font-mono text-[11px] text-[#007AFF]`}>
                    {row.resource_id || '-'}
                  </td>
                  <td className={`${cellClass} text-zinc-600 dark:text-zinc-300`}>
                    {row.reason || 'Belirtilmedi'}
                  </td>
                  <td className={cellClass}>{row.actor_id || '-'}</td>
                  <td className={cellClass}>
                    <span>{row.approver_id || '-'}</span>
                    {row.approver_role && (
                      <span className="ml-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                        {row.approver_role}
                      </span>
                    )}
                  </td>
                  <td className={`${cellClass} text-[11px] text-zinc-500 dark:text-zinc-400`}>
                    {formatDateTime(row.occurred_at)}
                  </td>
                  <td className={`${cellClass} text-right font-semibold`}>
                    <MoneyDisplay amountInCents={row.amount_cents} />
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-zinc-500">
                    Seçili aralıkta iptal, iade veya zayi kaydı bulunmuyor.
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
