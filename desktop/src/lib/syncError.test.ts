import { describe, expect, it } from 'vitest';
import { syncErrorText } from './syncError';

describe('syncErrorText', () => {
  it('eşitleme reddini sonucuyla söyler', () => {
    expect(syncErrorText('QUORUM_LOST: çoğunluk yok', 'tahsilat yapılmadı')).toBe('Bağlantı yok: tahsilat yapılmadı.');
  });

  it('başka hatayı değiştirmez', () => {
    expect(syncErrorText('PRODUCT_86D: tükendi', 'x')).toBe('PRODUCT_86D: tükendi');
  });
});
