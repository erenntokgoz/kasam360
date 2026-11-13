import { describe, expect, it } from 'vitest';
import { buildInsights, marginPercent, percentChange } from './panoramaInsights';
import { calendarMonthRange, reportPeriod, toLocalIso, validCalendarRange } from './dateRange';
import type { Kpi, PanoramaData } from '../stores/panoramaStore';

const kpi = (over: Partial<Kpi>): Kpi => ({
  collectedCents: 0, orders: 0, averageTicketCents: 0, refundCents: 0, discountCents: 0,
  voidCents: 0, vatCents: 0, cogsCents: null, grossProfitCents: null, costIncomplete: false, costMissingSales: 0, ...over,
});

const data = (over: Partial<PanoramaData>): PanoramaData => ({
  current: kpi({}), previous: kpi({}), bucketKind: 'HOUR', buckets: [], hourly: [], channels: [], products: [],
  live: { openTables: 0, totalTables: 0, openOrders: 0, openOrderCents: 0, longestOpenMinutes: 0, kitchenWaiting: 0, shiftOpen: false },
  alerts: [], ...over,
});

describe('pano yorumları', () => {
  it('önceki dönem boşsa oran üretmez', () => {
    expect(percentChange(1000, 0)).toBeNull();
    expect(percentChange(1200, 1000)).toBe(20);
    expect(percentChange(800, 1000)).toBe(-20);
  });

  it('maliyet görünmüyorsa marj boş kalır', () => {
    expect(marginPercent(null, 1000)).toBeNull();
    expect(marginPercent(250, 1000)).toBe(25);
    expect(marginPercent(250, 0)).toBeNull();
  });

  it('satış yoksa cümle kurmaz', () => {
    expect(buildInsights(data({}), 'dün aynı saate göre')).toEqual([]);
  });

  it('cümleler yalnız kayıtlı rakamlardan kurulur', () => {
    const lines = buildInsights(
      data({
        current: kpi({ collectedCents: 12_000, voidCents: 1_200 }),
        previous: kpi({ collectedCents: 10_000 }),
        buckets: [
          { label: '12', currentCents: 2_000, previousCents: 0 },
          { label: '21', currentCents: 10_000, previousCents: 0 },
        ],
        products: [{ productId: 'p', name: 'Tost', units: 3, revenueCents: 9_000, profitCents: 4_000 }],
      }),
      'dün aynı saate göre',
    );
    expect(lines[0]).toBe('Ciro dün aynı saate göre %20 yukarıda.');
    expect(lines[1]).toContain('21:00');
    expect(lines[2]).toContain('Tost');
    expect(lines[3]).toContain('%10');
  });
});

describe('rapor dönemi', () => {
  const now = new Date(2026, 9, 31, 14, 30, 0);

  it('gün sınırı yerel saatle başlar', () => {
    expect(reportPeriod('TODAY', now).from.slice(0, 19)).toBe('2026-10-31T00:00:00');
    expect(toLocalIso(now).slice(0, 19)).toBe('2026-10-31T14:30:00');
  });

  it('dün tam gündür ve bitiş sınırı hariçtir; bugün seçimi şimdiki ana kadar gelir', () => {
    const yesterday = reportPeriod('YESTERDAY', now);
    expect(yesterday.to.slice(0, 19)).toBe('2026-10-31T00:00:00');
    expect(reportPeriod('TODAY', now).to.slice(0, 19)).toBe('2026-10-31T14:30:00');
  });

  it('7 gün bugünü içerir', () => {
    expect(reportPeriod('WEEK', now).from.slice(0, 10)).toBe('2026-10-25');
  });
});

describe('pano takvim aralığı', () => {
  it('takvim ayını yerel ay sınırlarıyla alır; açık ayı bugüne kadar ve exclusive bitişle sınırlar', () => {
    const now = new Date(2026, 10, 8, 18, 45, 0);
    const openMonth = reportPeriod({ month: '2026-11' }, now);
    expect(openMonth.from.slice(0, 19)).toBe('2026-11-01T00:00:00');
    expect(openMonth.to.slice(0, 19)).toBe('2026-11-09T00:00:00');

    const pastMonth = reportPeriod({ month: '2026-10' }, now);
    expect(pastMonth.from.slice(0, 19)).toBe('2026-10-01T00:00:00');
    expect(pastMonth.to.slice(0, 19)).toBe('2026-11-01T00:00:00');
    const sameMonthPreviousYear = reportPeriod({ month: '2025-11' }, now);
    expect(sameMonthPreviousYear.from.slice(0, 19)).toBe('2025-11-01T00:00:00');
    expect(sameMonthPreviousYear.to.slice(0, 19)).toBe('2025-12-01T00:00:00');
  });

  it('şubat ve yıl değişiminde bir sonraki ayın yerel gece yarısını hariç tutar', () => {
    const leap = reportPeriod({ month: '2024-02' }, new Date(2026, 10, 8));
    expect(leap.from.slice(0, 19)).toBe('2024-02-01T00:00:00');
    expect(leap.to.slice(0, 19)).toBe('2024-03-01T00:00:00');
    const newYear = reportPeriod({ month: '2025-12' }, new Date(2026, 10, 8));
    expect(newYear.to.slice(0, 19)).toBe('2026-01-01T00:00:00');
  });

  it('artık yılda ayın son gününü ve tek günlük aralığın sınırlarını doğru bulur', () => {
    expect(calendarMonthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-03-01' });
    const single = reportPeriod({ from: '2024-02-29', to: '2024-02-29' });
    expect(single.from.slice(0, 19)).toBe('2024-02-29T00:00:00');
    expect(single.to.slice(0, 19)).toBe('2024-03-01T00:00:00');
    expect(single.compareSeconds).toBe(86_400);
  });

  it('özel aralıkta kıyası önceki eşit döneme kaydırır', () => {
    const period = reportPeriod({ from: '2026-10-06', to: '2026-10-08' });
    expect(period.compareSeconds).toBe(3 * 86_400);
    expect(period.compareLabel).toBe('önceki eşit döneme göre');
  });

  it('ters, geçersiz ve grafikte tam gösterilemeyecek aralıkları reddeder', () => {
    expect(validCalendarRange({ from: '2026-01-01', to: '2026-04-03' })).toBe(true);
    expect(validCalendarRange({ from: '2026-01-01', to: '2026-04-04' })).toBe(false);
    expect(validCalendarRange({ from: '2026-02-30', to: '2026-03-01' })).toBe(false);
    expect(validCalendarRange({ from: '2026-03-02', to: '2026-03-01' })).toBe(false);
  });
});
