import { describe, it, expect } from 'vitest';
import { isWithin60Minutes, minutesElapsed } from './date';

describe('isWithin60Minutes - 60 Dakika Rezervasyon Kuralı', () => {
  it('30 dakika sonraki rezervasyon için true döner', () => {
    const future30m = new Date(Date.now() + 30 * 60000).toISOString();
    expect(isWithin60Minutes(future30m)).toBe(true);
  });

  it('59 dakika sonraki rezervasyon için true döner', () => {
    const future59m = new Date(Date.now() + 59 * 60000).toISOString();
    expect(isWithin60Minutes(future59m)).toBe(true);
  });

  it('90 dakika sonraki rezervasyon için false döner', () => {
    const future90m = new Date(Date.now() + 90 * 60000).toISOString();
    expect(isWithin60Minutes(future90m)).toBe(false);
  });

  it('geçmiş rezervasyon saatleri için false döner', () => {
    const past10m = new Date(Date.now() - 10 * 60000).toISOString();
    expect(isWithin60Minutes(past10m)).toBe(false);
  });

  it('tanımsız rezervasyon saati için false döner', () => {
    expect(isWithin60Minutes(undefined)).toBe(false);
  });
});

describe('minutesElapsed', () => {
  it('SQLite UTC saatini yerel saat sanmaz', () => {
    const past = new Date(Date.now() - 5 * 60000).toISOString().slice(0, 19).replace('T', ' ');
    expect(minutesElapsed(past)).toBe(5);
  });

  it('geçen süreyi tam dakika cinsinden hesaplar', () => {
    const past45m = new Date(Date.now() - 45 * 60000).toISOString();
    expect(minutesElapsed(past45m)).toBe(45);
  });
});
