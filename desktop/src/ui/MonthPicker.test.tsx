import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PeriodFilter } from '../features/patron/panorama/PeriodFilter';
import { monthGroups, monthLabel } from './MonthPicker';

describe('ay seçici', () => {
  it('ay adını büyük harfli yıl ile yazar, geçersiz değerde boş kalır', () => {
    expect(monthLabel('2026-11')).toBe('Kasım 2026');
    expect(monthLabel('2025-01')).toBe('Ocak 2025');
    expect(monthLabel('2026-13')).toBe('');
    expect(monthLabel('')).toBe('');
  });

  it('yılları yeniden eskiye gruplar, gelecek ay sunmaz', () => {
    const groups = monthGroups('2026-02', 14);
    expect(groups.map((group) => group.year)).toEqual([2026, 2025, 2024]);
    expect(groups[0].months.map((month) => month.value)).toEqual(['2026-02', '2026-01']);
    expect(groups[1].months).toHaveLength(12);
    expect(groups[2].months.map((month) => month.value)).toEqual(['2024-12']);
    expect(groups.flatMap((group) => group.months).some((month) => month.value > '2026-02')).toBe(false);
  });

  it('dönem çubuğunda Son 30 Gün sonrası güncel ay adı düğmesi gelir', () => {
    const html = renderToStaticMarkup(<PeriodFilter range="TODAY" onChange={() => undefined} />);
    expect(html.indexOf('Son 30 Gün')).toBeGreaterThan(-1);
    const now = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date());
    expect(html.indexOf(now)).toBeGreaterThan(html.indexOf('Son 30 Gün'));
    expect(html).not.toContain('type="month"');
  });

  it('seçili ay düğmesi basılı görünür ve liste kapalıyken yıl listesi çizilmez', () => {
    const html = renderToStaticMarkup(<PeriodFilter range={{ month: '2025-12' }} onChange={() => undefined} />);
    expect(html).toContain('Aralık 2025');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-label="Ay seçimi"');
  });
});
