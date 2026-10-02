/**
 * Faz 10 analitik paneli — bölüm yönlendirmesi ve veri sunumu.
 *
 * Neden ayrı dosya: `ReportsHub` yalnız sekme yönlendirir; panel tek ekranın
 * içeriğidir. Tablolar `analyticsTables`, formlar `TargetAndCompetitorPanels`
 * içinde yaşar; bu dosya 300 satır sınırının altında kalmak için onları bağlar.
 *
 * Veri kuralı: yüzde alanları `null` gelirse "Bilinmiyor" yazılır, 0'a çevrilmez.
 */

import { forwardRef } from 'react';
import { AlertTriangle, Clock, Link2, Percent, TrendingDown } from 'lucide-react';

import { TargetAndCompetitorPanels, panelClass, sectionTitleClass } from './TargetAndCompetitorPanels';
import { BcgMatrixTable, CombinationTable } from './analyticsTables';
import type { AnalyticsMetrics, BcgQuadrant, PeakHourBucket } from './analyticsTypes';
import { formatCents, formatPercent } from './analyticsTypes';

const labelClass = 'text-[13px] text-zinc-600 dark:text-zinc-400';

/** BCG kovalarının mantıksal tanımı — eşik medyandan türetilir, sabit yok. */
const QUADRANTS: readonly { id: BcgQuadrant; title: string; rule: string; tone: string }[] = [
  {
    id: 'Star',
    title: 'Yıldız',
    rule: 'Yüksek hacim + yüksek marj',
    tone: 'border-[#34C759]/25 bg-[#34C759]/10',
  },
  {
    id: 'CashCow',
    title: 'Nakit ürünü',
    rule: 'Yüksek hacim + düşük marj',
    tone: 'border-[#FF9500]/25 bg-[#FF9500]/10',
  },
  {
    id: 'Plowhorse',
    title: 'Bova',
    rule: 'Düşük hacim + yüksek marj',
    tone: 'border-[#32ADE6]/25 bg-[#32ADE6]/10',
  },
  {
    id: 'Dog',
    title: 'Köpek',
    rule: 'Düşük hacim + düşük marj',
    tone: 'border-[#FF3B30]/25 bg-[#FF3B30]/10',
  },
];

/**
 * Yoğun saat grafiği gerçek veriden çizilir: çubuk yüksekliği o saatin cirosudur.
 * Sahte eğri veya dekoratif dalga yoktur; satış olmayan saat 2px taban çubuğu
 * olarak görünür ki "o saatte satış yok" bilgisi kaybolmasın.
 */
function PeakHourChart({ buckets }: { buckets: PeakHourBucket[] }) {
  const max = buckets.reduce((m, b) => Math.max(m, b.revenue_cents), 0);
  return (
    <div className="mt-3 flex h-32 items-end gap-[2px]" role="img" aria-label="Saatlik ciro dağılımı">
      {buckets.map((bucket) => (
        <div
          key={bucket.hour}
          className="flex-1 rounded-t-sm bg-[#007AFF]/70"
          style={{ height: max > 0 ? `${Math.max((bucket.revenue_cents / max) * 100, 2)}%` : '2%' }}
          title={`${String(bucket.hour).padStart(2, '0')}:00 — ${formatCents(bucket.revenue_cents)} · ${bucket.orders} sipariş`}
        />
      ))}
    </div>
  );
}

interface Props {
  metrics: AnalyticsMetrics | null;
  isLoading: boolean;
  error: string | null;
  onSaveTarget: (month: string, category: string, targetCents: number) => Promise<void>;
  onSaveCompetitorPrice: (
    productId: string,
    competitorName: string,
    priceCents: number,
  ) => Promise<void>;
  onRetry: () => void;
}

export const AnalyticsPanel = forwardRef<HTMLDivElement, Props>(function AnalyticsPanel(
  { metrics, isLoading, error, onSaveTarget, onSaveCompetitorPrice, onRetry },
  ref,
) {
  if (isLoading) {
    return (
      <div ref={ref} className="py-16 text-center text-xs text-zinc-500">
        Analitikler hesaplanıyor...
      </div>
    );
  }

  if (error) {
    return (
      <div ref={ref} className={`${panelClass} flex items-center gap-3`}>
        <AlertTriangle size={16} className="text-[#FF9500]" />
        <p className="flex-1 text-[13px] text-zinc-800 dark:text-zinc-100">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl bg-[#007AFF] px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  if (!metrics) return <div ref={ref} />;

  const voidLoss = metrics.void_loss;
  const counts = metrics.bcg_counts;

  return (
    <div ref={ref} className="flex flex-col gap-6">
      <section className={panelClass}>
        <h3 className={sectionTitleClass}>
          <Percent size={16} className="text-[#007AFF]" />
          İptal kayıp oranı
        </h3>
        {voidLoss === null ? (
          <p className="mt-2 text-[13px] text-zinc-600 dark:text-zinc-400">
            Bu dönemde hesaplanabilir ciro yok; oran hesaplanamaz.
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className={labelClass}>Kayıp oranı</p>
              <p className="text-[22px] font-semibold tabular-nums text-zinc-900 dark:text-white">
                {formatPercent(voidLoss.void_rate_percent)}
              </p>
            </div>
            <div>
              <p className={labelClass}>İptal tutarı</p>
              <p className="text-[22px] font-semibold tabular-nums text-zinc-900 dark:text-white">
                {formatCents(voidLoss.voided_cents)}
              </p>
            </div>
            <div>
              <p className={labelClass}>Toplam ciro</p>
              <p className="text-[22px] font-semibold tabular-nums text-zinc-900 dark:text-white">
                {formatCents(voidLoss.total_cents)}
              </p>
            </div>
            <div>
              <p className={labelClass}>İptal / toplam sipariş</p>
              <p className="text-[22px] font-semibold tabular-nums text-zinc-900 dark:text-white">
                {voidLoss.voided_orders} / {voidLoss.total_orders}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className={panelClass}>
        <h3 className={sectionTitleClass}>
          <TrendingDown size={16} className="text-[#007AFF]" />
          BCG matrisi
        </h3>
        <p className="mt-1 text-[12px] text-zinc-600 dark:text-zinc-400">
          Eşikler raporun kendi medyanından türetilir. Maliyeti bilinmeyen ürün yüzde
          göstermez.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {QUADRANTS.map((q) => (
            <div key={q.id} className={`rounded-xl border p-2 ${q.tone}`}>
              <p className="text-[12px] font-semibold text-zinc-900 dark:text-white">{q.title}</p>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">{q.rule}</p>
            </div>
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-3 text-[12px] text-zinc-700 dark:text-zinc-300">
          <li>Yıldız: {counts.star}</li>
          <li>Nakit ürünü: {counts.cash_cow}</li>
          <li>Bova: {counts.plowhorse}</li>
          <li>Köpek: {counts.dog}</li>
        </ul>
        <BcgMatrixTable entries={metrics.bcg_matrix} />
      </section>

      <section className={panelClass}>
        <h3 className={sectionTitleClass}>
          <Clock size={16} className="text-[#007AFF]" />
          Yoğun saatler
        </h3>
        <p className="mt-1 text-[12px] text-zinc-600 dark:text-zinc-400">
          24 saatin tamamı gösterilir; satış olmayan saat boş çubuktur.
        </p>
        <PeakHourChart buckets={metrics.peak_hours} />
      </section>

      <section className={panelClass}>
        <h3 className={sectionTitleClass}>
          <Link2 size={16} className="text-[#007AFF]" />
          Birlikte satılan ürünler
        </h3>
        <p className="mt-1 text-[12px] text-zinc-600 dark:text-zinc-400">
          Yalnız destek eşiğini geçen çiftler listelenir.
        </p>
        <CombinationTable combinations={metrics.combinations} />
      </section>

      <TargetAndCompetitorPanels
        targets={metrics.monthly_targets}
        gaps={metrics.competitor_gaps}
        onSaveTarget={onSaveTarget}
        onSaveCompetitorPrice={onSaveCompetitorPrice}
      />
    </div>
  );
});