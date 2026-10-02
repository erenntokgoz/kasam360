/**
 * Faz 10 analitik arayüz sözleşme testleri.
 * Path: tests/integration/analyticsPanelContract.test.tsx
 *
 * Kapsam: AGENTS.md §3.4 finansal sessiz hata yasağı ve Faz 10 kabul
 * kriterleri. Amaç sahte kıymet üretilmediğini kanıtlamaktır:
 * 1. Bilinmeyen maliyet/arpa "Bilinmiyor" görünür, %0 değil
 * 2. Ciro yoksa kayıp oranı hesaplanamaz, %0 yazılmaz
 * 3. Hedef 0 ise gerçekleşme yüzdesi hesaplanamaz
 * 4. Rakip fark işareti "biz daha pahalıyız" yönünü doğru anlatır
 * 5. Dört BCG kovası tanımıyla birlikte görünür
 * 6. Hiçbir metin emoji veya İngilizce UI metni taşımaz
 */

import { renderToString } from 'react-dom/server';

import { AnalyticsPanel } from '../../src/presentation/components/reports/AnalyticsPanel';
import type { AnalyticsMetrics } from '../../src/presentation/components/reports/analyticsTypes';

const EMOJI_PATTERN = /[\u{1F300}-\u{1F9FF}]/u;

/** React SSR arasi metin dugumlerine `<!-- -->` koyar; iddialar onu gormemeli. */
const plain = (html: string) => html.replace(/<!-- -->/g, '');

const noop = () => Promise.resolve();

function metrics(overrides: Partial<AnalyticsMetrics> = {}): AnalyticsMetrics {
  return {
    from: '2026-03-01',
    to: '2026-03-31',
    currency: 'TRY',
    product_margins: [],
    bcg_matrix: [],
    bcg_counts: { star: 0, plowhorse: 0, cash_cow: 0, dog: 0 },
    combinations: [],
    peak_hours: Array.from({ length: 24 }, (_, hour) => ({ hour, revenue_cents: 0, orders: 0 })),
    monthly_targets: [],
    competitor_gaps: [],
    void_loss: {
      voided_cents: 20_000,
      total_cents: 100_000,
      void_rate_percent: 20,
      voided_orders: 1,
      total_orders: 2,
    },
    ...overrides,
  };
}

function renderPanel(
  data: AnalyticsMetrics | null,
  isLoading = false,
  error: string | null = null,
): string {
  return plain(
    renderToString(
      <AnalyticsPanel
        metrics={data}
        isLoading={isLoading}
        error={error}
        onSaveTarget={noop}
        onSaveCompetitorPrice={noop}
        onRetry={() => undefined}
      />,
    ),
  );
}

describe('Faz 10 — AnalyticsPanel yükleme ve hata durumu', () => {
  it('yüklenirken bilgilendirme metni gosterir', () => {
    expect(renderPanel(null, true)).toContain('Analitikler hesaplanıyor');
  });

  it('okunamadiginda hata mesaji ve tekrar dugmesi gosterilir', () => {
    const html = renderPanel(null, false, 'Rapor okunamadı.');
    expect(html).toContain('Rapor okunamadı.');
    expect(html).toContain('Tekrar dene');
  });

  it('hata durumunda eski veri gosterilmez', () => {
    const html = renderPanel(null, false, 'Rapor okunamadı.');
    expect(html).not.toContain('BCG matrisi');
  });
});

describe('Faz 10 — finansal null sozlesmesi (AGENTS.md 3.4)', () => {
  it('maliyeti bilinmeyen urun yuzde 0 degil Bilinmiyor gosterir', () => {
    const html = renderPanel(
      metrics({
        bcg_matrix: [
          {
            product_id: 'prd_1',
            product_name: 'Urfa Kahve',
            quadrant: 'Dog',
            quadrant_label: 'Soru Isareti',
            units_sold: 12,
            margin_percent: null,
          },
        ],
        bcg_counts: { star: 0, plowhorse: 0, cash_cow: 0, dog: 1 },
      }),
    );
    expect(html).toContain('Urfa Kahve');
    expect(html).toContain('Bilinmiyor');
    expect(html).not.toContain('%0<');
  });

  it('ciro yoksa kayip orani hesaplanamaz mesaji gosterilir', () => {
    // Kayıt hiç yoksa (void_loss null) oran yerine açıklama çıkar.
    expect(renderPanel(metrics({ void_loss: null }))).toContain('oran hesaplanamaz');
  });

  it('ciro sifir olan kayitta oran Bilinmiyor kalir, yuzde 0 yazilmaz', () => {
    const html = renderPanel(
      metrics({
        void_loss: {
          voided_cents: 0,
          total_cents: 0,
          void_rate_percent: null,
          voided_orders: 0,
          total_orders: 0,
        },
      }),
    );
    expect(html).toContain('Bilinmiyor');
    expect(html).not.toContain('>%0</td>');
  });

  it('hedef sifirken gerceklesme yuzdesi Bilinmiyor kalir', () => {
    const html = renderPanel(
      metrics({
        monthly_targets: [
          {
            month: '2026-03',
            category: 'ALL',
            target_cents: 0,
            actual_cents: 0,
            difference_cents: 0,
            achieved_percent: null,
          },
        ],
      }),
    );
    expect(html).toContain('ALL');
    expect(html).toContain('Bilinmiyor');
  });
});

describe('Faz 10 — analitik icerigi', () => {
  it('iptal kayip orani hesaplanabilir veriden gosterilir', () => {
    const html = renderPanel(metrics());
    expect(html).toContain('%20');
    expect(html).toContain('200,00');
    expect(html).toContain('1 / 2');
  });

  it('dort BCG Kovasi kural aciklamasiyla gosterilir', () => {
    const html = renderPanel(metrics());
    expect(html).toContain('Yıldız');
    expect(html).toContain('Nakit ürünü');
    expect(html).toContain('Bova');
    expect(html).toContain('Köpek');
    expect(html).toContain('Yüksek hacim + yüksek marj');
  });

  it('yirmi dort saat kovasi daima cizilir', () => {
    const html = renderPanel(metrics());
    // 24 kova: saat numaraları 0-23 aralığında görünür.
    expect(html).toContain('Saatlik ciro dağılımı');
    const bars = html.split('rounded-t-sm').length - 1;
    expect(bars).toBe(24);
  });

  it('veri yokken kombinasyon yerine aciklama gosterilir', () => {
    expect(renderPanel(metrics())).toContain('Eşiği geçen ürün çifti yok');
  });

  it('rakip farki biz daha pahaliysak pozitif tutar olarak gosterilir', () => {
    const html = renderPanel(
      metrics({
        competitor_gaps: [
          {
            product_id: 'prd_1',
            product_name: 'Urfa Kahve',
            competitor_name: 'Rakip A',
            our_price_cents: 20_000,
            competitor_price_cents: 15_000,
            gap_cents: 5_000,
            gap_percent: 33,
            observed_at: '2026-03-10T09:00:00Z',
          },
        ],
      }),
    );
    expect(html).toContain('Rakip A');
    expect(html).toContain('50,00');
    expect(html).toContain('33');
  });
});

describe('Faz 10 — AI slop ve yerellestirme', () => {
  it('panel hicbir emoji tasimaz', () => {
    const html = renderPanel(
      metrics({
        bcg_matrix: [
          {
            product_id: 'prd_1',
            product_name: 'Urfa Kahve',
            quadrant: 'Star',
            quadrant_label: 'Yildiz',
            units_sold: 5,
            margin_percent: 40,
          },
        ],
        monthly_targets: [
          {
            month: '2026-03',
            category: 'ALL',
            target_cents: 100_000,
            actual_cents: 120_000,
            difference_cents: 20_000,
            achieved_percent: 120,
          },
        ],
      }),
    );
    expect(EMOJI_PATTERN.test(html)).toBe(false);
  });

  it('hedef ve rakip fiyat formlari Turkce basliklarla gelir', () => {
    const html = renderPanel(metrics());
    expect(html).toContain('Aylık hedef');
    expect(html).toContain('Rakip fiyat takibi');
    expect(html).toContain('Hedefi kaydet');
    expect(html).toContain('Fiyatı kaydet');
  });
});