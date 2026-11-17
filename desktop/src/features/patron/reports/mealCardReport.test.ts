import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMoney } from '../../../lib/formatMoney';
import { mealCardReport } from './mealCardReport';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../../services/tauriClient', () => ({ invokeIPC: invoke }));

const ARGS = {
  actorRole: 'OWNER', tenantId: 'tnt_a', from: '2026-10-01T00:00:00+03:00', to: '2026-10-31T23:59:59+03:00',
  fromDate: '2026-10-01', toDate: '2026-10-31',
};

describe('yemek kartı mutabakat raporu', () => {
  beforeEach(() => invoke.mockReset());

  it('marka satırları ve toplam kuruştan biçimlenir', async () => {
    invoke.mockResolvedValueOnce({
      rows: [
        { provider: 'MULTINET', label: 'Multinet', totalCents: 45_050, count: 2 },
        { provider: 'PLUXEE', label: 'Pluxee (Sodexo)', totalCents: 20_000, count: 1 },
      ],
      totalCents: 65_050,
      count: 3,
    });
    const table = await mealCardReport(ARGS);
    expect(invoke).toHaveBeenCalledWith('get_meal_card_reconciliation', expect.objectContaining({ tenantId: 'tnt_a', from: ARGS.from }));
    expect(table.rows).toEqual([
      ['Multinet', '2', formatMoney(45_050)],
      ['Pluxee (Sodexo)', '1', formatMoney(20_000)],
    ]);
    expect(table.summary).toContainEqual({ label: 'Toplam', value: formatMoney(65_050) });
    expect(table.summary).toContainEqual({ label: 'Tahsilat', value: '3' });
  });

  it('kayıt yoksa boş durum metni döner', async () => {
    invoke.mockResolvedValueOnce({ rows: [], totalCents: 0, count: 0 });
    const table = await mealCardReport(ARGS);
    expect(table.rows).toHaveLength(0);
    expect(table.emptyText).toMatch(/yemek kartı/);
  });
});
