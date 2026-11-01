import { describe, expect, it } from 'vitest';
import { planPayment, type PaymentPlanInput } from './paymentMath';

const base: PaymentPlanInput = {
  mode: 'FULL',
  remainingCents: 28_900,
  itemsCents: 0,
  partialCents: null,
  receivedCents: null,
  isCash: true,
};

describe('ödeme hesabı', () => {
  it('tam hesapta alınan boşsa tam tutar alınmış sayılır', () => {
    expect(planPayment(base)).toMatchObject({ dueCents: 28_900, receivedCents: 28_900, changeCents: 0, shortCents: 0, leftCents: 0 });
  });

  it('tam hesapta fazlası para üstü, eksiği eksik olur', () => {
    expect(planPayment({ ...base, receivedCents: 50_000 }).changeCents).toBe(21_100);
    expect(planPayment({ ...base, receivedCents: 1_100 })).toMatchObject({ changeCents: 0, shortCents: 27_800 });
  });

  it('tutar boşken alınan nakit kadar tahsil edilir, para üstü doğmaz', () => {
    expect(planPayment({ ...base, mode: 'PARTIAL', receivedCents: 1_100 })).toMatchObject({
      dueCents: 1_100,
      changeCents: 0,
      shortCents: 0,
      leftCents: 27_800,
    });
  });

  it('kısmi ödemede para üstü ile masada kalan ayrı hesaplanır', () => {
    expect(planPayment({ ...base, mode: 'PARTIAL', partialCents: 10_000, receivedCents: 20_000 })).toMatchObject({
      dueCents: 10_000,
      changeCents: 10_000,
      leftCents: 18_900,
    });
  });

  it('kalandan büyük tutar nakitte para üstü olur, kartta reddedilir', () => {
    expect(planPayment({ ...base, mode: 'PARTIAL', partialCents: 30_000 })).toMatchObject({ dueCents: 28_900, changeCents: 1_100, leftCents: 0 });
    expect(planPayment({ ...base, mode: 'PARTIAL', partialCents: 30_000, isCash: false }).exceedsRemaining).toBe(true);
  });

  it('kaleme göre ödemede seçilen tutar tahsil edilir', () => {
    expect(planPayment({ ...base, mode: 'ITEMS', itemsCents: 10_000, receivedCents: 15_000 })).toMatchObject({ dueCents: 10_000, changeCents: 5_000, leftCents: 18_900 });
  });
});
