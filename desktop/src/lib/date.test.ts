import { describe, it, expect } from 'vitest';
import { minutesElapsed } from './date';

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
