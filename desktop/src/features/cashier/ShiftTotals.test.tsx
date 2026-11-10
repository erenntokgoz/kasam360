import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShiftTotals } from './ShiftTotals';
import type { ShiftSummary } from '../../types/shift';

const summary: ShiftSummary = {
  shiftId: 'shf_1', cashierName: 'Test', openedAt: '2026-11-10 01:17:22', openingCashCents: 0,
  totalCashSalesCents: 0, totalCardSalesCents: 0, totalMealCardSalesCents: 0, totalVeresiyeCents: 0,
  totalCashInCents: 0, totalCashOutCents: 10_000, totalCashRefundsCents: 0,
  expectedCashInDrawerCents: -10_000, totalSalesCents: 0,
};

describe('ShiftTotals', () => {
  it('negatif beklenen nakdi kırmızı ve eksi işaretiyle gösterir', () => {
    const html = renderToStaticMarkup(<ShiftTotals summary={summary} blind={false} />);
    expect(html).toContain('data-testid="expected-cash"');
    expect(html).toContain('accent-red');
    expect(html).toMatch(/-100,00|−100,00/);
  });

  it('kör sayımda beklenen nakdi ve nakit satış toplamını üretmez', () => {
    const html = renderToStaticMarkup(<ShiftTotals summary={summary} blind />);
    expect(html).not.toContain('expected-cash');
    expect(html).not.toContain('Nakit satış');
    expect(html).not.toContain('Ciro');
  });

  it('okunamayan tutarı sıfır göstermez', () => {
    const html = renderToStaticMarkup(<ShiftTotals summary={{ ...summary, expectedCashInDrawerCents: null }} blind={false} />);
    expect(html).toContain('—');
  });
});
