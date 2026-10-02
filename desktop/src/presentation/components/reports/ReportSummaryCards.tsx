import { forwardRef } from 'react';
import { CreditCard, Layers, Receipt, TrendingUp } from 'lucide-react';

import { AppleGlassCard } from '../common/AppleGlassCard';
import { MoneyDisplay } from '../common/MoneyDisplay';
import { ReceiptReportRow, SalesReport } from './reportTypes';

export interface ReportSummaryCardsProps {
  sales: SalesReport | null;
  receipts: ReceiptReportRow[];
}

interface MetricCardProps {
  label: string;
  icon: React.ReactNode;
  iconTone: string;
  children: React.ReactNode;
  hint?: string;
}

const MetricCard = forwardRef<HTMLDivElement, MetricCardProps>(function MetricCard(
  { label, icon, iconTone, children, hint },
  ref,
) {
  return (
    <AppleGlassCard
      ref={ref}
      variant="subtle"
      className="flex flex-col justify-between gap-2 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full ${iconTone}`}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <div className="font-mono text-[28px] font-semibold leading-none tracking-tight text-zinc-900 dark:text-white">
        {children}
      </div>
      {hint && <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </AppleGlassCard>
  );
});

/**
 * Raporun dört ana metriği.
 *
 * Neden trend çizgisi yok: `OwnerSalesTab` kartlarda sabit noktalarla çizilen
 * bir `linearGradient` sparkline kullanıyordu. Bu veri değil, görsel yamaydı
 * (AGENTS.md: sahte grafik yasak). Gerçek seri ancak aralık serisi üretilirse
 * çizilir; o da bu fazın kapsamı dışında olduğu için kartlar düz değer gösterir.
 */
export const ReportSummaryCards = forwardRef<HTMLDivElement, ReportSummaryCardsProps>(
  function ReportSummaryCards({ sales, receipts }, ref) {
    const receiptTotal = receipts.reduce((sum, row) => sum + (row.total_cents || 0), 0);
    // Ciro satış raporundan gelir; rapor yoksa fiş satırlarının toplamı gösterilir.
    const revenue = sales ? sales.total_revenue_cents : receiptTotal;
    const orders = sales ? sales.total_orders : receipts.length;
    const average = sales
      ? sales.average_order_value_cents
      : orders > 0
        ? Math.round(receiptTotal / orders)
        : 0;

    return (
      <div ref={ref} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Ciro"
          icon={<TrendingUp size={14} />}
          iconTone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          hint={sales ? 'Tahsil edilen siparişler' : 'Satış raporu okunamadı, fiş satırları'}
        >
          <MoneyDisplay amountInCents={revenue} />
        </MetricCard>

        <MetricCard
          label="Sipariş"
          icon={<Layers size={14} />}
          iconTone="bg-[#007AFF]/10 text-[#007AFF]"
          hint="Tahsil edilmiş sipariş adedi"
        >
          {orders}
        </MetricCard>

        <MetricCard
          label="Ortalama sepet"
          icon={<CreditCard size={14} />}
          iconTone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          hint="Sipariş başına ortalama tutar"
        >
          <MoneyDisplay amountInCents={average} />
        </MetricCard>

        <MetricCard
          label="Kayıtlı fiş"
          icon={<Receipt size={14} />}
          iconTone="bg-purple-500/10 text-purple-600 dark:text-purple-400"
          hint="Seçili aralıktaki fiş satırı"
        >
          {receipts.length}
        </MetricCard>
      </div>
    );
  },
);
