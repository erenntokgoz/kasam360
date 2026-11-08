import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TariffFormModal, type Tariff } from './TariffFormModal';
import { isTariffOpen, tariffStatus } from './TariffPanel';

const takvim = { enabled: false, startTime: '17:00', endTime: '19:00', daysOfWeek: [5], validFrom: null, validTo: null };
const tarife = (extra: Partial<Tariff> = {}): Tariff => ({
  id: 'trf_1', name: 'Mutlu Saat', percent: -20, productIds: [], isActive: false, schedule: null, ...extra,
});

describe('tarife durumu', () => {
  it('takvimsiz tarife açılınca uygulanıyor görünür', () => {
    expect(tariffStatus(tarife(), null)).toBe('Kapalı');
    expect(tariffStatus(tarife({ isActive: true }), 'trf_1')).toBe('Açık · uygulanıyor');
  });

  it('takvimli tarife açık ama penceresi gelmemişse bekler', () => {
    const acik = tarife({ schedule: { ...takvim, enabled: true } });
    expect(isTariffOpen(acik)).toBe(true);
    expect(tariffStatus(acik, null)).toBe('Açık · takvim bekliyor');
    expect(tariffStatus(acik, 'trf_1')).toBe('Açık · uygulanıyor');
    expect(tariffStatus(tarife({ schedule: takvim }), 'trf_1')).toBe('Kapalı');
  });
});

describe('tarife formu', () => {
  const render = (value: Tariff | null) => renderToStaticMarkup(
    <TariffFormModal tariff={value} products={[]} busy={false} onClose={() => undefined} onSave={() => undefined} />,
  );

  it('takvime bağlanmadan saat ve gün alanlarını göstermez', () => {
    const html = render(null);
    expect(html).toContain('+ Rutin Ekle');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('Başlangıç saati');
    expect(html).not.toContain('Pzt');
  });

  it('takvimli tarifede alanları açık getirir', () => {
    const html = render(tarife({ schedule: takvim }));
    expect(html).toContain('Başlangıç saati');
    expect(html).toContain('Pzt');
    expect(html).toContain('Rutin Kaldır');
    expect(html).not.toContain('Bitiş tarihi');
  });
});
