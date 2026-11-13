import { describe, expect, it } from 'vitest';
import { buildFilter, defaultQuery, methodSummary, moveQuery, queryRange, shiftDay } from './closedOrdersModel';

describe('closedOrdersModel', () => {
  it('günü ay ve yıl sınırında doğru kaydırır', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('önceki ve sonraki gün iki ucu birlikte kaydırır, saatleri korur', () => {
    const query = { ...defaultQuery(new Date(2026, 2, 5)), fromTime: '18:00', toTime: '03:00', toDate: '2026-03-06' };
    const moved = moveQuery(query, -1);
    expect([moved.fromDate, moved.toDate, moved.fromTime, moved.toTime]).toEqual(['2026-03-04', '2026-03-05', '18:00', '03:00']);
  });

  it('geçersiz ve ters aralığı hata olarak döndürür', () => {
    const base = defaultQuery(new Date(2026, 2, 5));
    expect(queryRange({ ...base, fromTime: '' })).toHaveProperty('error');
    expect(queryRange({ ...base, fromTime: '25:00' })).toHaveProperty('error');
    expect(queryRange({ ...base, toDate: '2026-03-04' })).toHaveProperty('error');
    const ok = queryRange(base);
    expect(ok).toHaveProperty('from');
  });

  it('boş filtre alanlarını null gönderir', () => {
    const base = defaultQuery(new Date(2026, 2, 5));
    const filter = buildFilter({ ...base, tableSearch: '  ' }, { from: 'a', to: 'b' }, 0, 50);
    expect(filter).toMatchObject({ method: null, tableSearch: null, openedBy: null, closedBy: null, limit: 50, offset: 0 });
  });

  it('parçalı ödemeyi kanallarıyla yazar', () => {
    expect(methodSummary({ cashCents: 1, cardCents: 2, mealCardCents: 0, veresiyeCents: 0 })).toBe('Nakit + Kart');
  });
});
