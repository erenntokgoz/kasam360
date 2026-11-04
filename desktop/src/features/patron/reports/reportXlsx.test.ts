import { describe, expect, it } from 'vitest';
import { reportSheet } from './reportXlsx';

describe('Excel raporu', () => {
  it('tutarları ve sayıları sayısal, ürün adını düz metin tutar', () => {
    const sheet = reportSheet(
      { title: 'Satış', from: '2026-11-04', to: '2026-11-04', filters: [['Rapor türü', 'Satış']] },
      {
        summary: [{ label: 'Ciro', value: '1.234,56 ₺' }, { label: 'Adisyon', value: '2' }],
        columns: ['Kategori', 'Adet', 'Tutar'],
        rows: [['=1+1', '2', '-1.234,56 ₺']],
        emptyText: '',
      },
      'SALES',
    );
    expect(sheet).toContainEqual(['Ciro', { value: 1234.56, format: '#,##0.00" ₺"' }]);
    expect(sheet).toContainEqual(['Adisyon', 2]);
    expect(sheet[sheet.length - 1]).toEqual(['=1+1', 2, { value: -1234.56, format: '#,##0.00" ₺"' }]);
  });
});
