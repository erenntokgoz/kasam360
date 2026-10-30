import { formatDateTime } from '../../../lib/date';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';

export interface ReportTable {
  summary: { label: string; value: string }[];
  columns: string[];
  rows: string[][];
  emptyText: string;
}

interface ReportArgs {
  actorRole: string;
  tenantId: string;
  from: string;
  to: string;
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

const optionalMoney = (cents: number | null) => (cents === null ? 'Sayılmadı' : formatMoney(cents));

async function salesReport(args: ReportArgs): Promise<ReportTable> {
  const report = await invokeIPC<SalesWire>('get_sales_report', { ...args });
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
  const rows = await invokeIPC<ShiftWire[]>('get_shift_report', { ...args, limit: 200 });
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
  const report = await invokeIPC<{ rows: AdjustmentWire[] }>('get_adjustments_report', { ...args });
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
    invokeIPC<KpiWire[]>('get_staff_kpi', args as unknown as Record<string, unknown>),
    invokeIPC<FlagWire[]>('get_suspicious_activity', args as unknown as Record<string, unknown>),
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

export const REPORTS = {
  SALES: { label: 'Satış', load: salesReport },
  SHIFTS: { label: 'Vardiya ve Kasa', load: shiftReport },
  ADJUSTMENTS: { label: 'İptal, İade, Fire', load: adjustmentReport },
  STAFF: { label: 'Personel Performansı', load: staffReport },
} as const;

export type ReportKey = keyof typeof REPORTS;
