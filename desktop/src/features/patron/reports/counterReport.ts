import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import type { ReportArgs, ReportTable } from './reportDefinitions';

interface CounterWire {
  total_revenue_cents: number;
  total_orders: number;
  average_order_value_cents: number;
  payment_methods: { method: string; amount_cents: number }[];
}

const METHOD_LABEL: Record<string, string> = { CASH: 'Nakit', CARD: 'Kart' };

/** Masasız hızlı satış; ciro masa satışıyla aynı tahsilat kaynağından, ama ayrı toplanır. */
export async function counterSalesReport({ actorRole, tenantId, from, to }: ReportArgs): Promise<ReportTable> {
  const report = await invokeIPC<CounterWire>('get_counter_sales_report', { actorRole, tenantId, from, to });
  return {
    summary: [
      { label: 'Ciro', value: formatMoney(report.total_revenue_cents) },
      { label: 'Adisyon', value: String(report.total_orders) },
      { label: 'Ortalama Hesap', value: formatMoney(report.average_order_value_cents) },
    ],
    columns: ['Ödeme Yöntemi', 'Tutar'],
    rows: report.payment_methods.map((item) => [METHOD_LABEL[item.method] ?? item.method, formatMoney(item.amount_cents)]),
    emptyText: 'Bu dönemde hızlı satış yok.',
  };
}
