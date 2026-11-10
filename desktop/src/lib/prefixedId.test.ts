import { describe, expect, it } from 'vitest';
import { createPrefixedId } from './prefixedId';

describe('createPrefixedId', () => {
  it('üretim komutunun beklediği zaman sıralı ve ön ekli biçimi verir', () => {
    const id = createPrefixedId('cmin');
    expect(id).toMatch(/^cmin_[a-f0-9]{24}$/);
    expect(createPrefixedId('cmin')).not.toBe(id);
  });

  it('geçersiz ön eki reddeder', () => {
    expect(() => createPrefixedId('CMIN')).toThrow();
  });
});
