import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettlementDialog } from './SettlementDialog';
import type { SessionSettlement, StaffSettlement } from './settlement';

const settlement = (extra: Partial<StaffSettlement> = {}): StaffSettlement => ({
  id: 'stl_1', userId: 'usr_1', fullName: 'Ali', workSessionId: 'wks_1', workDate: '2026-11-09', kind: 'HOURLY',
  workedSeconds: 27_000, rateCents: 15_000, earnedCents: 112_500, paidCents: 0, remainingCents: 112_500,
  status: 'UNPAID', createdAt: '2026-11-10T03:00:00Z', ...extra,
});
const render = (result: SessionSettlement) => renderToStaticMarkup(<SettlementDialog result={result} fullName="Ali" onClose={() => undefined} />);

describe('çıkış hesabı penceresi', () => {
  it('saatlik ücrette süreyi, tutarı ve ödeme sorusunu gösterir', () => {
    const html = render({ settlement: settlement(), note: null });
    expect(html).toContain('7,5 saat');
    expect(html).toContain('1.125,00');
    expect(html).toContain('Ödeme yapıldı mı?');
    expect(html).toContain('Ödenmedi, borç kalsın');
    expect(html).toContain('Kısmen ödendi');
  });

  it('günlük ücrette saat karşılığı göstermez', () => {
    const html = render({ settlement: settlement({ kind: 'DAILY', rateCents: 100_000, earnedCents: 100_000, remainingCents: 100_000 }), note: null });
    expect(html).toContain('Günlük ücret');
    expect(html).not.toContain('saat');
    expect(html).not.toContain('Çalışılan');
  });

  it('tutarı göremeyen çağırana sıfır değil gizli gösterir ve ödeme sormaz', () => {
    const html = render({ settlement: settlement({ earnedCents: null, remainingCents: null, paidCents: null, rateCents: null }), note: null });
    expect(html).toContain('Gizli');
    expect(html).not.toContain('Ödeme yapıldı mı?');
  });

  it('ücret üretilmediyse nedenini söyler', () => {
    const html = render({ settlement: null, note: 'Bu personelin ücreti dönem bordrosunda hesaplanır.' });
    expect(html).toContain('dönem bordrosunda hesaplanır');
    expect(html).not.toContain('Ödeme yapıldı mı?');
  });
});
