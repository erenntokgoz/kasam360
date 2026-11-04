import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeIPC } from '../../../services/tauriClient';
import { formatMoney } from '../../../lib/formatMoney';
import { REPORTS, type ReportArgs } from './reportDefinitions';
import { reportCsv, reportCsvRows, type ReportFileMeta } from './reportCsv';

vi.mock('../../../services/tauriClient', () => ({ invokeIPC: vi.fn() }));
const invoke = vi.mocked(invokeIPC);

const ARGS: ReportArgs = {
  actorRole: 'OWNER',
  tenantId: 'tnt_1',
  from: '2026-10-01T00:00:00+03:00',
  to: '2026-10-31T23:59:59+03:00',
  fromDate: '2026-10-01',
  toDate: '2026-10-31',
};

const meta = (title: string): ReportFileMeta => ({
  title,
  from: ARGS.fromDate,
  to: ARGS.toDate,
  filters: [['Rapor türü', title]],
});

/** Dosyayı Excel'in okuyacağı gibi geri ayırır: BOM, satır ve noktalı virgül. */
const parse = (csv: string) =>
  csv
    .replace(/^﻿/, '')
    .split('\r\n')
    .map((line) => (line === '' ? [] : line.slice(1, -1).split('";"').map((cell) => cell.replace(/""/g, '"'))));

describe('rapor dosyası ekranla aynıdır', () => {
  beforeEach(() => invoke.mockReset());

  it('dönem, filtre ve ekrandaki özet dosyaya aynen yazılır', async () => {
    invoke.mockResolvedValueOnce({
      rows: [
        { kind: 'VOID', amount_cents: 1250, reason: 'yanlış; masa', approver_role: 'MANAGER', occurred_at: '2026-10-02T10:00:00Z' },
        { kind: 'VOID', amount_cents: 750, reason: '', approver_role: 'MANAGER', occurred_at: '2026-10-03T10:00:00Z' },
        { kind: 'REFUND', amount_cents: 3000, reason: 'soğuk', approver_role: 'OWNER', occurred_at: '2026-10-04T10:00:00Z' },
      ],
    });
    const table = await REPORTS.ADJUSTMENTS.load(ARGS);
    const rows = parse(reportCsv(meta('İptal, İade, Fire'), table));

    expect(rows.slice(0, 4)).toEqual([
      ['Rapor', 'İptal, İade, Fire'],
      ['Başlangıç', '2026-10-01'],
      ['Bitiş', '2026-10-31'],
      ['Rapor türü', 'İptal, İade, Fire'],
    ]);
    // Ekrandaki kartlar `table.summary`'den çizilir; dosyadaki özet satırları da.
    for (const item of table.summary) expect(rows).toContainEqual([item.label, item.value]);
    expect(rows).toContainEqual(['İptal', formatMoney(2000)]);
    // Noktalı virgüllü gerekçe sütun kaydırmaz.
    expect(rows).toContainEqual(['İptal', formatMoney(1250), 'yanlış; masa', 'MANAGER', expect.any(String)]);
  });

  it('özet toplamı dosyadaki satırların toplamıyla tutar', async () => {
    invoke.mockResolvedValueOnce({
      total_revenue_cents: 7000,
      total_orders: 3,
      average_order_value_cents: 2333,
      voided_cents: 0,
      payment_methods: [],
      category_volume: [
        { name: 'Kahve', quantity: 2, total_cents: 4000 },
        { name: 'Tatlı', quantity: 1, total_cents: 3000 },
      ],
    });
    const table = await REPORTS.SALES.load(ARGS);
    const rows = reportCsvRows(meta('Satış'), table);
    const header = rows.findIndex((row) => row[0] === 'Kategori');
    const lineTotal = rows.slice(header + 1).reduce((sum, row) => sum + Number(row[2].replace(/[^\d]/g, '')), 0);
    const ciro = rows.find((row) => row[0] === 'Ciro');
    expect(ciro?.[1]).toBe(table.summary[0].value);
    expect(Number(ciro?.[1].replace(/[^\d]/g, ''))).toBe(lineTotal);
  });

  it('maliyet eksikse kâr yaklaşık yazılır ve uyarı dosyada durur', async () => {
    invoke.mockResolvedValueOnce({
      totalRevenueCents: 100_000,
      totalCogsCents: 20_000,
      totalVatCents: 10_000,
      totalRefundsCents: 0,
      grossProfitCents: 70_000,
      costMissingLines: 2,
      totalExpensesCents: 5_000,
      netProfitCents: 65_000,
      receivablesCents: 0,
      payablesCents: 0,
    });
    const table = await REPORTS.PROFIT.load(ARGS);
    expect(invoke).toHaveBeenCalledWith('get_financial_report', expect.objectContaining({ startDate: '2026-10-01', endDate: '2026-10-31' }));
    const rows = parse(reportCsv(meta('Kâr'), table));
    expect(rows).toContainEqual(['Uyarı', table.warning]);
    expect(rows).toContainEqual(['Net Kâr (yaklaşık)', `≈ ${formatMoney(65_000)}`]);
    expect(table.summary).toContainEqual({ label: 'Net Kâr (yaklaşık)', value: `≈ ${formatMoney(65_000)}` });
  });

  it('maliyet tamsa kâr kesin yazılır', async () => {
    invoke.mockResolvedValueOnce({
      totalRevenueCents: 100_000,
      totalCogsCents: 20_000,
      totalVatCents: 10_000,
      totalRefundsCents: 0,
      grossProfitCents: 70_000,
      costMissingLines: 0,
      totalExpensesCents: 5_000,
      netProfitCents: 65_000,
      receivablesCents: 0,
      payablesCents: 0,
    });
    const table = await REPORTS.PROFIT.load(ARGS);
    expect(table.warning).toBeUndefined();
    expect(reportCsvRows(meta('Kâr'), table)).toContainEqual(['Net Kâr', formatMoney(65_000)]);
  });
});
