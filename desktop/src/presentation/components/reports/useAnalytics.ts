/**
 * Faz 10 analitik veri kancası.
 *
 * Neden ayrı kanca: rapor merkezinin satış/vardiya verisi ile analitik verisi
 * farklı komutlardan gelir ve farklı hata politikasına sahiptir. Analitik
 * tek bir komuttan okunur; hata olursa yalnız analitik bölümü etkilenir,
 * raporun özet sekmesi çalışmaya devam eder.
 *
 * Yazma işlemleri (hedef, rakip fiyat) kaydettikten sonra listeyi yeniden okur;
 * çağıran tarafın "kaydettim" diye umutması yerine gerçeği görmesi sağlanır.
 */

import { useCallback, useEffect, useState } from 'react';

import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import type { AnalyticsMetrics } from './analyticsTypes';

export interface AnalyticsState {
  metrics: AnalyticsMetrics | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  saveTarget: (month: string, category: string, targetCents: number) => Promise<void>;
  saveCompetitorPrice: (
    productId: string,
    competitorName: string,
    priceCents: number,
  ) => Promise<void>;
}

export function useAnalytics(rangeFrom: string, rangeTo: string): AnalyticsState {
  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setIsLoading(true);
      setError(null);
      try {
        const result = await tauriInvoke<AnalyticsMetrics>('get_analytics_metrics', {
          range: { from: rangeFrom, to: rangeTo },
          minSupport: 2,
        });
        if (!cancelled) setMetrics(result);
      } catch (err) {
        // Hata yutulmaz: ekranda gösterilir, eski veri "güncel" gibi sunulmaz.
        if (!cancelled) {
          setMetrics(null);
          setError(String(err));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [rangeFrom, rangeTo, reloadToken]);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  const saveTarget = useCallback(
    async (month: string, category: string, targetCents: number) => {
      await tauriInvoke<void>('set_monthly_target', {
        input: { month, category, target_cents: targetCents },
      });
      setReloadToken((n) => n + 1);
    },
    [],
  );

  const saveCompetitorPrice = useCallback(
    async (productId: string, competitorName: string, priceCents: number) => {
      await tauriInvoke<void>('set_competitor_price', {
        input: { product_id: productId, competitor_name: competitorName, price_cents: priceCents },
      });
      setReloadToken((n) => n + 1);
    },
    [],
  );

  return { metrics, isLoading, error, refresh, saveTarget, saveCompetitorPrice };
}