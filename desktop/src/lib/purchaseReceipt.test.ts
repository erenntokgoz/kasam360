import { describe, expect, it } from 'vitest';
import { emptyReceiptDraft, receiptKey, toReceiptInput } from './purchaseReceipt';
import { batchQuantityText } from './stockText';

describe('mal kabulü seçimleri', () => {
  it('vadeli alımda vadeyi gönderir, boşsa sunucu tedarikçi vadesini kullanır', () => {
    expect(toReceiptInput({ ...emptyReceiptDraft(), dueDate: '2026-12-01' }, [])).toEqual({
      settlement: 'TERM', dueDate: '2026-12-01', documentNo: null, usableGrams: [],
    });
    expect(toReceiptInput(emptyReceiptDraft(), []).dueDate).toBeNull();
  });

  it('peşin alımda kanalı gönderir ve vadeyi yok sayar', () => {
    const input = toReceiptInput({ ...emptyReceiptDraft(), mode: 'PAID', channel: 'BANK_TRANSFER', dueDate: '2026-12-01', documentNo: ' FT-9 ' }, []);
    expect(input).toMatchObject({ settlement: 'BANK_TRANSFER', dueDate: null, documentNo: 'FT-9' });
  });

  it('yalnız adetli kalemin girilen gramını gönderir', () => {
    const draft = { ...emptyReceiptDraft(), grams: { prd_tavuk: '1350,5', prd_un: '500', prd_bos: '' } };
    expect(toReceiptInput(draft, ['prd_tavuk', 'prd_bos']).usableGrams).toEqual([{ productId: 'prd_tavuk', usableGramsPerUnit: 1350.5 }]);
    expect(() => toReceiptInput({ ...emptyReceiptDraft(), grams: { prd_tavuk: '0' } }, ['prd_tavuk'])).toThrow('gram');
  });

  it('aynı seçim aynı anahtarı, farklı seçim farklı anahtarı verir', () => {
    const input = toReceiptInput(emptyReceiptDraft(), []);
    expect(receiptKey('por_1', input)).toBe(receiptKey('por_1', { ...input }));
    expect(receiptKey('por_1', input)).not.toBe(receiptKey('por_1', { ...input, settlement: 'CASH' }));
  });

  it('gramlı partide adet başı gramı gösterir', () => {
    expect(batchQuantityText({ remainingQuantity: 2, stockUnit: 'adet', usableGramsPerUnit: 1350 })).toBe('2 adet · 1.350 g/adet');
    expect(batchQuantityText({ remainingQuantity: 1.5, stockUnit: 'kg', usableGramsPerUnit: null })).toBe('1,5 kg');
  });
});
