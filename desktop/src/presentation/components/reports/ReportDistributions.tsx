import { forwardRef } from 'react';
import { Banknote, CreditCard, PieChart } from 'lucide-react';

import { AppleGlassCard } from '../common/AppleGlassCard';
import { MoneyDisplay } from '../common/MoneyDisplay';
import { CategoryVolume, PaymentMethodShare, paymentMethodLabel } from './reportTypes';

export interface ReportDistributionsProps {
  paymentMethods: PaymentMethodShare[];
  categoryVolume: CategoryVolume[];
}

const sectionTitleClass = 'flex items-center gap-2 text-zinc-600 dark:text-zinc-300';
const emptyClass = 'py-6 text-center text-xs text-zinc-500 dark:text-zinc-400';

function MethodIcon({ method }: { method: string }) {
  const lower = method.toLowerCase();
  const isCash = lower.includes('cash') || lower.includes('nakit');
  return isCash ? (
    <Banknote size={14} className="text-emerald-600 dark:text-emerald-400" />
  ) : (
    <CreditCard size={14} className="text-[#007AFF]" />
  );
}

/** Ödeme yöntemi dağılımı. Yüzde raporun kendi hesabından gelir, yeniden hesaplanmaz. */
export const ReportPaymentMethods = forwardRef<HTMLDivElement, ReportDistributionsProps>(
  function ReportPaymentMethods({ paymentMethods }, ref) {
    const total = paymentMethods.reduce((sum, row) => sum + row.amount_cents, 0);

    return (
      <AppleGlassCard ref={ref} variant="subtle" className="flex flex-col gap-4 p-5">
        <div className={sectionTitleClass}>
          <CreditCard size={16} className="text-[#007AFF]" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Ödeme yöntemleri</h3>
        </div>

        {paymentMethods.length === 0 ? (
          <p className={emptyClass}>
            Seçili aralıkta ödeme kaydı bulunmuyor. Ödeme tutarları tahsil anında denetim
            defterine yazılır.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {paymentMethods.map((row) => {
              const percent =
                total > 0 ? Math.round((row.amount_cents / total) * 100) : row.share_percent;
              return (
                <li
                  key={row.method}
                  className="rounded-xl border border-black/[0.06] dark:border-white/10 bg-white/60 dark:bg-white/[0.02] p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-xs font-medium text-zinc-800 dark:text-zinc-100">
                      <MethodIcon method={row.method} />
                      {paymentMethodLabel(row.method)}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                        %{percent}
                      </span>
                      <MoneyDisplay amountInCents={row.amount_cents} />
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.06]">
                    <div
                      className="h-1.5 rounded-full bg-[#007AFF] transition-all duration-250"
                      style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AppleGlassCard>
    );
  },
);

/** Kategori hacmi: adet ve tutar. Kategori atanmamış ürünler "Kategorisiz" olarak gelir. */
export const ReportCategoryVolume = forwardRef<HTMLDivElement, ReportDistributionsProps>(
  function ReportCategoryVolume({ categoryVolume }, ref) {
    const maxQuantity = categoryVolume.reduce((max, row) => Math.max(max, row.quantity), 0);

    return (
      <AppleGlassCard ref={ref} variant="subtle" className="flex flex-col gap-4 p-5">
        <div className={sectionTitleClass}>
          <PieChart size={16} className="text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Kategori hacmi</h3>
        </div>

        {categoryVolume.length === 0 ? (
          <p className={emptyClass}>Seçili aralıkta kategori kırılımı yok.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {categoryVolume.map((row) => {
              const ratio = maxQuantity > 0 ? Math.round((row.quantity / maxQuantity) * 100) : 0;
              return (
                <li key={row.name} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-zinc-800 dark:text-zinc-100">{row.name}</span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                        {row.quantity} adet
                      </span>
                      <MoneyDisplay amountInCents={row.total_cents} />
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.06]">
                    <div
                      className="h-1.5 rounded-full bg-emerald-500/90 transition-all duration-250"
                      style={{ width: `${Math.min(100, Math.max(2, ratio))}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AppleGlassCard>
    );
  },
);
