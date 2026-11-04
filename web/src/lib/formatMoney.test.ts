import { describe, expect, it } from 'vitest';
import { formatMoney } from '@/lib/formatMoney';

describe('formatMoney', () => {
  it('kuruşu yerel biçime çevirir', () => {
    expect(formatMoney(125_050)).toBe('1.250,50 TL');
    expect(formatMoney(0)).toBe('0,00 TL');
    expect(formatMoney(-905)).toBe('-9,05 TL');
  });
});
