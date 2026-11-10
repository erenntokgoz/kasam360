import { formatDateTime } from '../../../lib/date';
import { utcOffsetMinutes } from '../../../lib/dateRange';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import type { FinancialProfitSummary } from '../../../types/ledger';

export interface ReportTable {
  summary: { label: string; value: string }[];
  columns: string[];
  rows: string[][];
  emptyText: string;
  /** Rakamın kesin olmadığı durum; ekranda ve dosyada aynı metinle yazılır. */
  warning?: string;
}

export interface ReportArgs {
  actorRole: string;
  tenantId: string;
  /** Yerel saatli RFC 3339 dönem uçları. */
  from: string;
  to: string;
  /** Aynı dönemin `YYYY-AA-GG` günleri; gün bazlı komutlar bunu alır. */
  fromDate: string;
  toDate: string;
}

interface SalesWire {
  total_revenue_cents: number;
  total_orders: number;
  average_order_value_cents: number;
  voided_cents: number;
  payment_methods: { method: string; amount_cents: number; share_percent: number }[];
  category_volume: { name: string; quantity: number; total_cents: number }[];
}

interface ShiftWire {
  cashier_name: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  expected_amount_cents: number;
  actual_amount_cents: number | null;
  difference_cents: number | null;
}

interface AdjustmentWire {
  kind: string;
  amount_cents: number;
  reason: string;
  approver_role: string;
  occurred_at: string;
}

interface KpiWire {
  fullName: string;
  orderCount: number;
  itemCount: number;
  grossSalesCents: number;
  avgTicketCents: number;
  voidCount: number;
  topProduct: string | null;
}

interface FlagWire {
  fullName: string;
  severity: string;
  detail: string;
}

const ADJUSTMENT_LABEL: Record<string, string> = { VOID: 'İptal', REFUND: 'İade', WASTE: 'Fire' };

const wire = ({ actorRole, tenantId, from, to }: ReportArgs) => ({ actorRole, tenantId, from, to });

const optionalMoney = (cents: number | null) => (cents === null ? 'Sayılmadı' : formatMoney(cents));

async function salesReport(args: ReportArgs): Promise<ReportTable> {
  const report = await invokeIPC<SalesWire>('get_sales_report', wire(args));
  return {
    summary: [
      { label: 'Ciro', value: formatMoney(report.total_revenue_cents) },
      { label: 'Adisyon', value: String(report.total_orders) },
      { label: 'Ortalama Hesap', value: formatMoney(report.average_order_value_cents) },
      { label: 'İptal', value: formatMoney(report.voided_cents) },
    ],
    columns: ['Kategori', 'Adet', 'Tutar'],
    rows: report.category_volume.map((item) => [item.name, String(item.quantity), formatMoney(item.total_cents)]),
    emptyText: 'Bu dönemde satış yok.',
  };
}

async function shiftReport(args: ReportArgs): Promise<ReportTable> {
  const rows = await invokeIPC<ShiftWire[]>('get_shift_report', { ...wire(args), limit: 200 });
  const difference = rows.reduce((sum, row) => sum + (row.difference_cents ?? 0), 0);
  return {
    summary: [
      { label: 'Vardiya', value: String(rows.length) },
      { label: 'Toplam Kasa Farkı', value: formatMoney(difference) },
    ],
    columns: ['Kasiyer', 'Açılış', 'Kapanış', 'Açılış Kasası', 'Sayılan', 'Fark'],
    rows: rows.map((row) => [
      row.cashier_name,
      formatDateTime(`${row.opened_at.replace(' ', 'T')}Z`),
      row.closed_at ? formatDateTime(`${row.closed_at.replace(' ', 'T')}Z`) : 'Açık',
      formatMoney(row.expected_amount_cents),
      optionalMoney(row.actual_amount_cents),
      optionalMoney(row.difference_cents),
    ]),
    emptyText: 'Bu dönemde vardiya yok.',
  };
}

async function adjustmentReport(args: ReportArgs): Promise<ReportTable> {
  const report = await invokeIPC<{ rows: AdjustmentWire[] }>('get_adjustments_report', wire(args));
  const total = (kind: string) =>
    report.rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.amount_cents, 0);
  return {
    summary: [
      { label: 'İptal', value: formatMoney(total('VOID')) },
      { label: 'İade', value: formatMoney(total('REFUND')) },
      { label: 'Fire', value: formatMoney(total('WASTE')) },
    ],
    columns: ['Tür', 'Tutar', 'Gerekçe', 'Onaylayan', 'Zaman'],
    rows: report.rows.map((row) => [
      ADJUSTMENT_LABEL[row.kind] ?? row.kind,
      formatMoney(row.amount_cents),
      row.reason || '-',
      row.approver_role || '-',
      formatDateTime(row.occurred_at),
    ]),
    emptyText: 'Bu dönemde iptal, iade veya fire yok.',
  };
}

async function staffReport(args: ReportArgs): Promise<ReportTable> {
  const [kpis, flags] = await Promise.all([
    invokeIPC<KpiWire[]>('get_staff_kpi', wire(args)),
    invokeIPC<FlagWire[]>('get_suspicious_activity', wire(args)),
  ]);
  const ranked = [...kpis].sort((a, b) => b.grossSalesCents - a.grossSalesCents);
  return {
    summary: [
      { label: 'En Çok Satan', value: ranked[0]?.fullName ?? '-' },
      { label: 'Şüpheli Bulgu', value: String(flags.length) },
    ],
    columns: ['Personel', 'Satış', 'Adisyon', 'Kalem', 'Ortalama', 'İptal', 'En Çok Sattığı', 'Bulgu'],
    rows: ranked.map((row) => [
      row.fullName,
      formatMoney(row.grossSalesCents),
      String(row.orderCount),
      String(row.itemCount),
      formatMoney(row.avgTicketCents),
      String(row.voidCount),
      row.topProduct ?? '-',
      flags.filter((flag) => flag.fullName === row.fullName).map((flag) => flag.detail).join(' · ') || '-',
    ]),
    emptyText: 'Bu dönemde personel satışı yok.',
  };
}

/** Partisiz satılan kalemin maliyeti sıfır sayılmıştır; kâr o durumda yaklaşık yazılır. */
async function profitReport(args: ReportArgs): Promise<ReportTable> {
  const report = await invokeIPC<FinancialProfitSummary>('get_financial_report', {
    actorRole: args.actorRole,
    tenantId: args.tenantId,
    startDate: args.fromDate,
    endDate: args.toDate,
    utcOffsetMinutes: utcOffsetMinutes(),
  });
  const approximate = report.costMissingLines > 0;
  const profit = (label: string, cents: number) => ({
    label: approximate ? `${label} (yaklaşık)` : label,
    value: approximate ? `≈ ${formatMoney(cents)}` : formatMoney(cents),
  });
  const gross = profit('Brüt Kâr', report.grossProfitCents);
  const net = profit('Net Kâr', report.netProfitCents);
  return {
    summary: [
      { label: 'Satış Hasılatı', value: formatMoney(report.totalRevenueCents) },
      gross,
      { label: 'İşletme Giderleri', value: formatMoney(report.totalExpensesCents) },
      net,
    ],
    columns: ['Kalem', 'Tutar'],
    rows: [
      ['Satış Hasılatı', formatMoney(report.totalRevenueCents)],
      ['İadeler', formatMoney(-report.totalRefundsCents)],
      ['KDV', formatMoney(-report.totalVatCents)],
      ['Satılan Malın Maliyeti', formatMoney(-report.totalCogsCents)],
      [gross.label, gross.value],
      ['İşletme Giderleri', formatMoney(-report.totalExpensesCents)],
      [net.label, net.value],
    ],
    emptyText: 'Bu dönemde kayıt yok.',
    warning: approximate
      ? `Maliyet eksik: ${report.costMissingLines} kalem partisi olmadan satıldı. Kâr gerçeğinden yüksek olabilir.`
      : undefined,
  };
}

export const REPORTS = {
  SALES: { label: 'Satış', load: salesReport },
  SHIFTS: { label: 'Vardiya ve Kasa', load: shiftReport },
  ADJUSTMENTS: { label: 'İptal, İade, Fire', load: adjustmentReport },
  STAFF: { label: 'Personel Performansı', load: staffReport },
  PROFIT: { label: 'Kâr', load: profitReport },
} as const;

/** Kâr yalnız işletme sahibinindir; sunucu da müdüre kâr raporunu vermez. */
export const OWNER_ONLY_REPORTS: ReadonlySet<string> = new Set(['PROFIT']);

export type ReportKey = keyof typeof REPORTS;
