import { AnomalyDetector } from './AnomalyDetector';
import { RollingStatsCalculator } from './RollingStatsCalculator';
import {
  AnomalyScore,
  FactorialCategory,
  FactorialDriver,
  OperationalEvent,
  RootCauseInsight,
  RootCauseSourceDataSummary,
} from './types';

export interface FinancialBucket {
  revenue: number;
  cogs: number;
  waste: number;
  discounts: number;
  refunds: number;
  cancellations: number;
  voids: number;
  labor: number;
  overhead: number;
  netProfit: number;
  cogsByCategory: Record<string, number>;
  wasteByCategory: Record<string, number>;
  discountsByReason: Record<string, number>;
  cancellationsByReason: Record<string, number>;
}

export interface IntelligenceEngineConfig {
  defaultCurrency?: string;
  significanceThresholdPercentage?: number;
}

/**
 * Kurumsal Faktöriyel Kök Neden Zeka Motoru.
 * Değişmez olay kaynaklı kayıtları analiz eder, faktöriyel ilişkilendirme yoluyla varyans sürücülerini izole eder,
 * ve matematiksel kanıtlarla doğal dil tanısal yanıtlar sentezler.
 */
export class IntelligenceEngine {
  private statsCalculator: RollingStatsCalculator;
  private anomalyDetector: AnomalyDetector;
  private significanceThreshold: number;

  constructor(
    config?: IntelligenceEngineConfig,
    statsCalculator?: RollingStatsCalculator,
    anomalyDetector?: AnomalyDetector
  ) {
    this.statsCalculator = statsCalculator ?? new RollingStatsCalculator();
    this.anomalyDetector = anomalyDetector ?? new AnomalyDetector(undefined, this.statsCalculator);
    this.significanceThreshold = config?.significanceThresholdPercentage ?? 2.0;
  }

  public getSignificanceThreshold(): number {
    return this.significanceThreshold;
  }

  public getStatsCalculator(): RollingStatsCalculator {
    return this.statsCalculator;
  }

  public getAnomalyDetector(): AnomalyDetector {
    return this.anomalyDetector;
  }

  /**
   * Tanısal Sorgu Sentezleyici.
   * Faktöriyel ilişkilendirme yürüterek "Net kar bu ay neden düştü?" gibi sorguları yanıtlar.
   */
  public diagnose(
    query: string,
    currentPeriodEvents: OperationalEvent[],
    baselinePeriodEvents: OperationalEvent[],
    options?: {
      periodStart?: string;
      periodEnd?: string;
      baselineStart?: string;
      baselineEnd?: string;
    }
  ): RootCauseInsight {
    const currentBucket = this.aggregateFinancials(currentPeriodEvents);
    const baselineBucket = this.aggregateFinancials(baselinePeriodEvents);

    const periodStart = options?.periodStart ?? this.findEarliestTimestamp(currentPeriodEvents);
    const periodEnd = options?.periodEnd ?? this.findLatestTimestamp(currentPeriodEvents);
    const baselineStart =
      options?.baselineStart ?? this.findEarliestTimestamp(baselinePeriodEvents);
    const baselineEnd = options?.baselineEnd ?? this.findLatestTimestamp(baselinePeriodEvents);

    const netVariance = this.round(currentBucket.netProfit - baselineBucket.netProfit);
    const netVariancePercentage =
      baselineBucket.netProfit !== 0
        ? this.round(
            ((currentBucket.netProfit - baselineBucket.netProfit) /
              Math.abs(baselineBucket.netProfit)) *
              100,
            2
          )
        : currentBucket.netProfit !== 0
          ? 100
          : 0;

    // Mevcut dönemdeki operasyonel anomalileri tespit et
    const detectedAnomalies = this.anomalyDetector.detectAllAnomalies(currentPeriodEvents);

    // Faktöriyel sürücüleri izole et
    const drivers = this.computeFactorialDrivers(
      currentBucket,
      baselineBucket,
      netVariance,
      detectedAnomalies
    );

    // Birincil sürücü, net kar üzerinde en yüksek olumsuz etkiye sahip olan faktördür
    const primaryDriver =
      drivers.length > 0
        ? drivers[0]
        : this.createNeutralDriver(currentBucket.netProfit, baselineBucket.netProfit);

    const contributingFactors = drivers.slice(1);

    // Yönetici özet başlığını oluştur
    const headline = this.synthesizeHeadline(
      query,
      netVariance,
      netVariancePercentage,
      primaryDriver,
      contributingFactors
    );

    // Veriye dayalı eyleme geçirilebilir öneriler sentezle
    const actionableRecommendations = this.generateRecommendations(
      primaryDriver,
      contributingFactors
    );

    const sourceDataSummary: RootCauseSourceDataSummary = {
      baselineRevenue: baselineBucket.revenue,
      currentRevenue: currentBucket.revenue,
      baselineCogs: baselineBucket.cogs,
      currentCogs: currentBucket.cogs,
      baselineWaste: baselineBucket.waste,
      currentWaste: currentBucket.waste,
      baselineDiscounts: baselineBucket.discounts,
      currentDiscounts: currentBucket.discounts,
      baselineRefunds: baselineBucket.refunds,
      currentRefunds: currentBucket.refunds,
      baselineCancellations: baselineBucket.cancellations,
      currentCancellations: currentBucket.cancellations,
      eventsAnalyzedCount: currentPeriodEvents.length + baselinePeriodEvents.length,
      anomaliesDetectedCount: detectedAnomalies.length,
    };

    return {
      id: `INSIGHT-RC-${Date.now()}`,
      query,
      periodStart,
      periodEnd,
      baselineStart,
      baselineEnd,
      headline,
      targetMetric: 'NET_PROFIT',
      baselineProfit: baselineBucket.netProfit,
      currentProfit: currentBucket.netProfit,
      netVariance,
      netVariancePercentage,
      primaryDriver,
      contributingFactors,
      actionableRecommendations,
      sourceDataSummary,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Değişmez operasyonel olayları yapılandırılmış bir finansal kovada toplar.
   */
  public aggregateFinancials(events: OperationalEvent[]): FinancialBucket {
    let revenue = 0;
    let cogs = 0;
    let waste = 0;
    let discounts = 0;
    let refunds = 0;
    let cancellations = 0;
    let voids = 0;
    let labor = 0;
    let overhead = 0;

    const cogsByCategory: Record<string, number> = {};
    const wasteByCategory: Record<string, number> = {};
    const discountsByReason: Record<string, number> = {};
    const cancellationsByReason: Record<string, number> = {};

    for (const e of events) {
      const amt = Math.abs(e.amount);
      const cat = e.category || 'Uncategorized';
      const reason =
        (e.metadata?.reason as string) || (e.metadata?.voidReason as string) || 'General';

      switch (e.type) {
        case 'SALE':
          revenue += amt;
          break;
        case 'RECEIVING_COST':
          cogs += amt;
          cogsByCategory[cat] = (cogsByCategory[cat] || 0) + amt;
          break;
        case 'WASTE':
          waste += amt;
          wasteByCategory[cat] = (wasteByCategory[cat] || 0) + amt;
          break;
        case 'DISCOUNT':
          discounts += amt;
          discountsByReason[reason] = (discountsByReason[reason] || 0) + amt;
          break;
        case 'REFUND':
          refunds += amt;
          break;
        case 'CANCELLATION':
          cancellations += amt;
          cancellationsByReason[reason] = (cancellationsByReason[reason] || 0) + amt;
          break;
        case 'VOID':
          voids += amt;
          break;
        case 'LABOR_COST':
          labor += amt;
          break;
        case 'OVERHEAD_COST':
          overhead += amt;
          break;
      }
    }

    const netRevenue = Math.max(0, revenue - refunds);
    const netProfit = netRevenue - cogs - waste - labor - overhead - discounts;

    return {
      revenue: this.round(revenue),
      cogs: this.round(cogs),
      waste: this.round(waste),
      discounts: this.round(discounts),
      refunds: this.round(refunds),
      cancellations: this.round(cancellations),
      voids: this.round(voids),
      labor: this.round(labor),
      overhead: this.round(overhead),
      netProfit: this.round(netProfit),
      cogsByCategory,
      wasteByCategory,
      discountsByReason,
      cancellationsByReason,
    };
  }

  /**
   * Faktöriyel İlişkilendirme: Finansal varyans sürücülerini izole eder ve kâr etkisine göre sıralar.
   */
  public computeFactorialDrivers(
    current: FinancialBucket,
    baseline: FinancialBucket,
    totalProfitVariance: number,
    anomalies: AnomalyScore[] = []
  ): FactorialDriver[] {
    const drivers: FactorialDriver[] = [];
    const absTotalVariance = Math.abs(totalProfitVariance) || 1;

    // 1. Ayrıntılı COGS Kategori Kırılımı (örn. Kümes Hayvanları, Et, Süt Ürünleri)
    const allCogsCategories = new Set([
      ...Object.keys(current.cogsByCategory),
      ...Object.keys(baseline.cogsByCategory),
    ]);

    for (const cat of allCogsCategories) {
      const curCatCogs = current.cogsByCategory[cat] || 0;
      const baseCatCogs = baseline.cogsByCategory[cat] || 0;
      const variance = this.round(curCatCogs - baseCatCogs);

      if (Math.abs(variance) > 0.01) {
        const pct = baseCatCogs > 0 ? this.round((variance / baseCatCogs) * 100, 2) : 100;

        if (Math.abs(pct) >= this.significanceThreshold || Math.abs(variance) >= 20.0) {
          const profitImpact = this.round(-variance);
          const share = this.round((Math.abs(profitImpact) / absTotalVariance) * 100, 2);

          drivers.push({
            factor: `${cat} cost variance`,
            category: 'COGS_VARIANCE',
            impactAmount: profitImpact,
            baselineValue: baseCatCogs,
            currentValue: curCatCogs,
            varianceAmount: variance,
            variancePercentage: pct,
            varianceSharePercentage: share,
            evidence: [
              `${cat} expenditure shifted from $${baseCatCogs.toFixed(2)} to $${curCatCogs.toFixed(2)} (${pct > 0 ? '+' : ''}${pct}%).`,
              `Direct net profit impact of -$${Math.abs(profitImpact).toFixed(2)}.`,
            ],
          });
        }
      }
    }

    // 2. Atık Sapma Kırılımı
    const wasteVariance = this.round(current.waste - baseline.waste);
    if (Math.abs(wasteVariance) > 0.01) {
      const wastePct =
        baseline.waste > 0 ? this.round((wasteVariance / baseline.waste) * 100, 2) : 100;

      if (Math.abs(wastePct) >= this.significanceThreshold || Math.abs(wasteVariance) >= 20.0) {
        const profitImpact = this.round(-wasteVariance);
        const share = this.round((Math.abs(profitImpact) / absTotalVariance) * 100, 2);

        const subDrivers: FactorialDriver[] = Object.keys({
          ...current.wasteByCategory,
          ...baseline.wasteByCategory,
        }).map((cat) => {
          const curW = current.wasteByCategory[cat] || 0;
          const baseW = baseline.wasteByCategory[cat] || 0;
          const wVar = this.round(curW - baseW);
          return {
            factor: `${cat} waste`,
            category: 'WASTE_DEVIATION' as FactorialCategory,
            impactAmount: -wVar,
            baselineValue: baseW,
            currentValue: curW,
            varianceAmount: wVar,
            variancePercentage: baseW > 0 ? this.round((wVar / baseW) * 100, 2) : 100,
            varianceSharePercentage: this.round((Math.abs(wVar) / absTotalVariance) * 100, 2),
            evidence: [`${cat} waste moved by $${wVar.toFixed(2)}`],
          };
        });

        drivers.push({
          factor: 'Waste deviation',
          category: 'WASTE_DEVIATION',
          impactAmount: profitImpact,
          baselineValue: baseline.waste,
          currentValue: current.waste,
          varianceAmount: wasteVariance,
          variancePercentage: wastePct,
          varianceSharePercentage: share,
          evidence: [
            `Inventory waste moved from $${baseline.waste.toFixed(2)} to $${current.waste.toFixed(2)} (${wastePct > 0 ? '+' : ''}${wastePct}%).`,
            `Unaccounted shrinkage and prep waste reduced profit by $${Math.abs(profitImpact).toFixed(2)}.`,
          ],
          subDrivers,
        });
      }
    }

    // 3. İndirim Kaçağı
    const discountVariance = this.round(current.discounts - baseline.discounts);
    if (Math.abs(discountVariance) > 0.01) {
      const discountPct =
        baseline.discounts > 0 ? this.round((discountVariance / baseline.discounts) * 100, 2) : 100;

      if (
        Math.abs(discountPct) >= this.significanceThreshold ||
        Math.abs(discountVariance) >= 20.0
      ) {
        const profitImpact = this.round(-discountVariance);
        const share = this.round((Math.abs(profitImpact) / absTotalVariance) * 100, 2);

        const offHoursAnomaly = anomalies.find(
          (a) => a.type === 'OFF_HOURS_DISCOUNT_SPIKE' || a.type === 'UNAUTHORIZED_DISCOUNT_LEAK'
        );
        const anomalyEvidence = offHoursAnomaly
          ? ` (Off-hours discount anomaly detected: ${offHoursAnomaly.reason})`
          : '';

        drivers.push({
          factor: offHoursAnomaly ? 'Off-hours discount leakage' : 'Discount leakage',
          category: 'DISCOUNT_LEAKAGE',
          impactAmount: profitImpact,
          baselineValue: baseline.discounts,
          currentValue: current.discounts,
          varianceAmount: discountVariance,
          variancePercentage: discountPct,
          varianceSharePercentage: share,
          evidence: [
            `Discounts shifted from $${baseline.discounts.toFixed(2)} to $${current.discounts.toFixed(2)} (${discountPct > 0 ? '+' : ''}${discountPct}%).${anomalyEvidence}`,
          ],
        });
      }
    }

    // 4. İade Artış Etkisi
    const refundVariance = this.round(current.refunds - baseline.refunds);
    if (Math.abs(refundVariance) > 0.01) {
      const refundPct =
        baseline.refunds > 0 ? this.round((refundVariance / baseline.refunds) * 100, 2) : 100;

      if (Math.abs(refundPct) >= this.significanceThreshold || Math.abs(refundVariance) >= 20.0) {
        const profitImpact = this.round(-refundVariance);
        const share = this.round((Math.abs(profitImpact) / absTotalVariance) * 100, 2);

        drivers.push({
          factor: 'Refund surge',
          category: 'REFUND_IMPACT',
          impactAmount: profitImpact,
          baselineValue: baseline.refunds,
          currentValue: current.refunds,
          varianceAmount: refundVariance,
          variancePercentage: refundPct,
          varianceSharePercentage: share,
          evidence: [
            `Customer refunds escalated from $${baseline.refunds.toFixed(2)} to $${current.refunds.toFixed(2)} (${refundPct > 0 ? '+' : ''}${refundPct}%).`,
          ],
        });
      }
    }

    // 5. İptal Kaybı Etkisi
    const cancelVariance = this.round(current.cancellations - baseline.cancellations);
    if (Math.abs(cancelVariance) > 0.01) {
      const cancelPct =
        baseline.cancellations > 0
          ? this.round((cancelVariance / baseline.cancellations) * 100, 2)
          : 100;

      if (Math.abs(cancelPct) >= this.significanceThreshold || Math.abs(cancelVariance) >= 20.0) {
        const profitImpact = this.round(-cancelVariance);
        const share = this.round((Math.abs(profitImpact) / absTotalVariance) * 100, 2);

        drivers.push({
          factor: 'Order cancellation loss',
          category: 'CANCELLATION_LOSS',
          impactAmount: profitImpact,
          baselineValue: baseline.cancellations,
          currentValue: current.cancellations,
          varianceAmount: cancelVariance,
          variancePercentage: cancelPct,
          varianceSharePercentage: share,
          evidence: [
            `Lost ticket value due to order cancellations rose from $${baseline.cancellations.toFixed(2)} to $${current.cancellations.toFixed(2)}.`,
          ],
        });
      }
    }

    // 6. Brüt Gelir Hacmi Etkisi
    const revVariance = this.round(current.revenue - baseline.revenue);
    if (Math.abs(revVariance) > 0.01) {
      const revPct =
        baseline.revenue > 0 ? this.round((revVariance / baseline.revenue) * 100, 2) : 100;

      if (Math.abs(revPct) >= this.significanceThreshold || Math.abs(revVariance) >= 20.0) {
        const profitImpact = revVariance;
        const share = this.round((Math.abs(profitImpact) / absTotalVariance) * 100, 2);

        drivers.push({
          factor: 'Gross revenue volume',
          category: 'REVENUE_VOLUME',
          impactAmount: profitImpact,
          baselineValue: baseline.revenue,
          currentValue: current.revenue,
          varianceAmount: revVariance,
          variancePercentage: revPct,
          varianceSharePercentage: share,
          evidence: [
            `Top-line revenue changed from $${baseline.revenue.toFixed(2)} to $${current.revenue.toFixed(2)} (${revPct > 0 ? '+' : ''}${revPct}%).`,
          ],
        });
      }
    }

    // Sürücüleri azalan kâr etkisine göre sırala (en zararlı sürücü ilk)
    return drivers.sort((a, b) => a.impactAmount - b.impactAmount);
  }

  /**
   * Faktöriyel kaynak verilerle desteklenen doğal dilde tanısal başlık sentezler.
   */
  private synthesizeHeadline(
    _query: string,
    netVariance: number,
    netVariancePercentage: number,
    primaryDriver: FactorialDriver,
    contributingFactors: FactorialDriver[]
  ): string {
    const isDrop = netVariance < 0;
    const directionWord = isDrop ? 'düştü' : 'arttı';
    const amountStr = `$${Math.abs(netVariance).toFixed(2)}`;
    const pctStr = `${netVariancePercentage > 0 ? '+' : ''}${netVariancePercentage.toFixed(1)}%`;

    const primaryDesc = `${primaryDriver.factor} ${primaryDriver.variancePercentage > 0 ? '+' : ''}${primaryDriver.variancePercentage.toFixed(1)}%`;

    const topContributors = contributingFactors
      .slice(0, 2)
      .map(
        (c) =>
          `${c.factor} ${c.variancePercentage > 0 ? '+' : ''}${c.variancePercentage.toFixed(1)}%`
      );

    const contributorsStr =
      topContributors.length > 0 ? `, desteklenen: ${topContributors.join(', ')}` : '';

    return `Net kar ${amountStr} (${pctStr}) kadar ${directionWord}, başlıca itici güç ${primaryDesc}${contributorsStr}.`;
  }

  /**
   * Belirlenen kök nedenlere dayalı eyleme geçirilebilir öneriler üretir.
   */
  private generateRecommendations(
    primaryDriver: FactorialDriver,
    contributingFactors: FactorialDriver[]
  ): string[] {
    const recommendations: string[] = [];
    const allKeyDrivers = [primaryDriver, ...contributingFactors.slice(0, 3)];

    for (const d of allKeyDrivers) {
      switch (d.category) {
        case 'COGS_VARIANCE':
          recommendations.push(
            `Audit supplier contracts and purchase price variance for ${d.factor.replace(' cost variance', '')}; renegotiate bulk pricing or adjust retail menu margins.`
          );
          break;
        case 'WASTE_DEVIATION':
          recommendations.push(
            'Conduct immediate kitchen prep station audit and enforce FIFO rotation to stem avoidable food spoilage and trimming loss.'
          );
          break;
        case 'DISCOUNT_LEAKAGE':
          recommendations.push(
            'Tighten POS authorization matrices; restrict manual discount overrides during off-peak and graveyard shifts.'
          );
          break;
        case 'REFUND_IMPACT':
          recommendations.push(
            'Investigate kitchen fulfillment speed and order accuracy tickets to eliminate root causes of customer chargebacks and refunds.'
          );
          break;
        case 'CANCELLATION_LOSS':
          recommendations.push(
            'Examine kitchen display load times during peak rushes to minimize order abandonment and walk-outs.'
          );
          break;
        case 'REVENUE_VOLUME':
          recommendations.push(
            'Deploy targeted upselling campaigns and examine ticket average size to recover top-line sales velocity.'
          );
          break;
      }
    }

    return Array.from(new Set(recommendations));
  }

  private createNeutralDriver(currentProfit: number, baselineProfit: number): FactorialDriver {
    return {
      factor: 'Operational stability',
      category: 'REVENUE_VOLUME',
      impactAmount: this.round(currentProfit - baselineProfit),
      baselineValue: baselineProfit,
      currentValue: currentProfit,
      varianceAmount: 0,
      variancePercentage: 0,
      varianceSharePercentage: 0,
      evidence: ['No statistically significant variance detected between periods.'],
    };
  }

  private findEarliestTimestamp(events: OperationalEvent[]): string {
    if (events.length === 0) return new Date().toISOString();
    return events.reduce(
      (earliest, e) => (new Date(e.timestamp) < new Date(earliest) ? e.timestamp : earliest),
      events[0].timestamp
    );
  }

  private findLatestTimestamp(events: OperationalEvent[]): string {
    if (events.length === 0) return new Date().toISOString();
    return events.reduce(
      (latest, e) => (new Date(e.timestamp) > new Date(latest) ? e.timestamp : latest),
      events[0].timestamp
    );
  }

  private round(val: number, decimals = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
  }
}
