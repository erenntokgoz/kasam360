import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { formatMoney } from '../../lib/formatMoney';
import { OrderTicket } from './OrderTicket';

vi.mock('../../stores/posStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/posStore')>();
  return {
    ...actual,
    usePosStore: () => ({
      ...actual.usePosStore.getInitialState(),
      balance: { totalCents: 40000, paidCents: 15000, remainingCents: 25000 },
      calculateTotalCents: () => 25000,
    }),
  };
});

describe('OrderTicket', () => {
  it('parçalı tahsilattan sonra adisyonda alınan ve kalan tutarı gösterir', () => {
    const html = renderToStaticMarkup(<OrderTicket />);
    expect(html).toContain('Tahsil Edilen');
    expect(html).toContain(formatMoney(15000));
    expect(html).toContain('Kalan Tutar');
    expect(html).toContain(formatMoney(25000));
  });
});
