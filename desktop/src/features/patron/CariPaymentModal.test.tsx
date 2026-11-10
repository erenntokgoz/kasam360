import { describe, expect, it } from 'vitest';
import { parseCents } from '../../lib/cariInput';
import { centsToText } from '../../lib/moneyInput';

describe('tahsilat tutarı ön doldurma', () => {
  it('bin liranın üstündeki kalan bakiye ham metne çevrilir ve geri okunur', () => {
    for (const cents of [185_050, 100_000, 99_999, 123_456_789, 5]) {
      expect(parseCents(centsToText(cents))).toBe(cents);
    }
  });
});
