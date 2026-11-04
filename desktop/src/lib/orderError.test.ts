import { describe, expect, it } from 'vitest';
import { orderErrorText } from './orderError';

describe('sipariş reddi metni', () => {
  const sonuc = 'sipariş gönderilmedi';

  it('tükendi ve satış dışını ayrı söyler', () => {
    expect(orderErrorText('PRODUCT_86D: Ürün geçici olarak tükendi', sonuc)).toBe('Taslakta tükenen ürün var: sipariş gönderilmedi.');
    expect(orderErrorText(new Error('PRODUCT_INACTIVE: Ürün satış dışında'), sonuc)).toBe('Taslakta satış dışı ürün var: sipariş gönderilmedi.');
  });

  it('bağlantı reddini ve diğer hataları eski biçimde bırakır', () => {
    expect(orderErrorText('QUORUM_LOST: yok', sonuc)).toBe('Bağlantı yok: sipariş gönderilmedi.');
    expect(orderErrorText('VALIDATION: x', sonuc)).toBe('VALIDATION: x');
  });
});
