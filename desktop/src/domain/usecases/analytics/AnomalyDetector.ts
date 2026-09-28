import { RollingStatsCalculator } from './RollingStatsCalculator';
import {
  AnomalyScore,
  AnomalySeverity,
  AnomalyType,
  MetricStreamType,
  MetricWindow,
  OperationalEvent,
} from './types';

export interface AnomalyDetectorConfig {
  varianceZScoreWarningThreshold?: number; // örn. 2.0 standart sapma
  varianceZScoreCriticalThreshold?: number; // örn. 3.5 standart sapma
  offHoursDiscountRateThreshold?: number; // örn. 0.20 (%20)
  offHoursDiscountMaxAmount?: number; // örn. $50
  offHoursStartHour?: number; // 23 (23:00)
  offHoursEndHour?: number; // 6 (06:00)
  cancellationBurstCountThreshold?: number; // örn. 3 iptal
  cancellationBurstWindowMinutes?: number; // 15 dakika içinde
  cancellationRatioCriticalThreshold?: number; // örn. 0.15 (%15)
  erraticVoidMaxCountPerWindow?: number; // örn. 3 iptal
  erraticVoidAmountThreshold?: number; // örn. $75
  refundVolumeRatioThreshold?: number; // örn. 0.10 (gelirin %10'u)
}

/**
 * Kurumsal Anomali Tespit Motoru.
 * Anormal restoran aktivitelerini işaretlemek için deterministik kural tabanlı operasyonel monitörleri
 * ve istatistiksel varyans tabanlı puanlama algoritmalarını uygular.
 */
export class AnomalyDetector {
  private config: Required<AnomalyDetectorConfig>;
  private statsCalculator: RollingStatsCalculator;

  constructor(config?: AnomalyDetectorConfig, statsCalculator?: RollingStatsCalculator) {
    this.config = {
      varianceZScoreWarningThreshold: config?.varianceZScoreWarningThreshold ?? 2.0,
      varianceZScoreCriticalThreshold: config?.varianceZScoreCriticalThreshold ?? 3.5,
      offHoursDiscountRateThreshold: config?.offHoursDiscountRateThreshold ?? 0.2,
      offHoursDiscountMaxAmount: config?.offHoursDiscountMaxAmount ?? 50.0,
      offHoursStartHour: config?.offHoursStartHour ?? 23,
      offHoursEndHour: config?.offHoursEndHour ?? 6,
      cancellationBurstCountThreshold: config?.cancellationBurstCountThreshold ?? 3,
      cancellationBurstWindowMinutes: config?.cancellationBurstWindowMinutes ?? 15,
      cancellationRatioCriticalThreshold: config?.cancellationRatioCriticalThreshold ?? 0.15,
      erraticVoidMaxCountPerWindow: config?.erraticVoidMaxCountPerWindow ?? 3,
      erraticVoidAmountThreshold: config?.erraticVoidAmountThreshold ?? 75.0,
      refundVolumeRatioThreshold: config?.refundVolumeRatioThreshold ?? 0.1,
    };
    this.statsCalculator = statsCalculator ?? new RollingStatsCalculator();
  }

  /**
   * Varyans tabanlı istatistiksel puanlama kullanarak bir MetricWindow'u değerlendirir.
   */
  public scoreMetricWindow(
    window: MetricWindow,
    targetValue?: number,
    associatedEventIds?: string[]
  ): AnomalyScore {
    const valueToEvaluate = targetValue ?? window.currentValue;
    const zScore = this.statsCalculator.computeZScore(
      valueToEvaluate,
      window.mean,
      window.standardDeviation
    );

    const absZ = Math.abs(zScore);
    const deviation = this.round(valueToEvaluate - window.mean);
    const deviationPercentage =
      window.mean !== 0
        ? this.round((deviation / window.mean) * 100, 2)
        : valueToEvaluate !== 0
          ? 100
          : 0;

    let severity: AnomalySeverity = 'NORMAL';
    if (absZ >= this.config.varianceZScoreCriticalThreshold) {
      severity = 'CRITICAL';
    } else if (absZ >= 2.8) {
      severity = 'HIGH';
    } else if (absZ >= this.config.varianceZScoreWarningThreshold) {
      severity = 'MEDIUM';
    } else if (absZ >= 1.5) {
      severity = 'LOW';
    }

    const isAnomaly = severity !== 'NORMAL';
    const normalizedScore = Math.min(100, this.round((absZ / 4.0) * 100, 1));
    const anomalyType = this.resolveAnomalyType(window.streamType, zScore);

    const direction = zScore > 0 ? 'surge above' : 'drop below';
    const reason = isAnomaly
      ? `Statistically significant ${direction} rolling mean (|z| = ${absZ.toFixed(2)}, deviation = ${deviationPercentage > 0 ? '+' : ''}${deviationPercentage}%).`
      : 'Within expected statistical variance limits.';

    return {
      id: `ANOM-VAR-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      metric: window.streamType,
      method: 'VARIANCE_BASED',
      type: anomalyType,
      severity,
      score: normalizedScore,
      zScore,
      isAnomaly,
      currentValue: valueToEvaluate,
      expectedValue: window.mean,
      deviation,
      deviationPercentage,
      reason,
      timestamp: window.timestamp,
      context: {
        streamType: window.streamType,
        windowSize: window.windowSize,
        sampleStandardDeviation: window.standardDeviation,
      },
      associatedEventIds,
    };
  }

  /**
   * Kural Tabanlı Algoritma: Mesai dışı indirimlerdeki ani artışları tespit eder.
   */
  public detectOffHoursDiscountAnomalies(events: OperationalEvent[]): AnomalyScore[] {
    const discountEvents = events.filter((e) => e.type === 'DISCOUNT');
    const anomalies: AnomalyScore[] = [];

    for (const discount of discountEvents) {
      const eventDate = new Date(discount.timestamp);
      const hour = eventDate.getHours();
      const isOffHours =
        discount.metadata?.isOffHours === true ||
        hour >= this.config.offHoursStartHour ||
        hour < this.config.offHoursEndHour;

      if (!isOffHours) continue;

      const discountRate = (discount.metadata?.discountRate as number | undefined) ?? 0;
      const isHighRate = discountRate >= this.config.offHoursDiscountRateThreshold;
      const isHighAmount = discount.amount >= this.config.offHoursDiscountMaxAmount;
      const lacksManagerAuth = !discount.metadata?.managerId;

      if (isHighRate || isHighAmount || (isOffHours && lacksManagerAuth && discount.amount > 20)) {
        const severity: AnomalySeverity =
          isHighRate && isHighAmount
            ? 'CRITICAL'
            : isHighAmount || lacksManagerAuth
              ? 'HIGH'
              : 'MEDIUM';

        anomalies.push({
          id: `ANOM-OFFHRS-${discount.id}`,
          metric: 'DISCOUNT_RATE',
          method: 'RULE_BASED',
          type: lacksManagerAuth ? 'UNAUTHORIZED_DISCOUNT_LEAK' : 'OFF_HOURS_DISCOUNT_SPIKE',
          severity,
          score: severity === 'CRITICAL' ? 95 : severity === 'HIGH' ? 80 : 65,
          zScore: 3.5,
          isAnomaly: true,
          currentValue: discount.amount,
          expectedValue: 0,
          deviation: discount.amount,
          deviationPercentage: 100,
          reason: `Off-hours discount of $${discount.amount.toFixed(2)} applied at ${eventDate.toLocaleTimeString()} (${isHighRate ? `Rate: ${(discountRate * 100).toFixed(0)}%, ` : ''}${lacksManagerAuth ? 'Missing Manager Authorization' : 'Exceeds threshold'}).`,
          timestamp: discount.timestamp,
          context: {
            discountId: discount.id,
            staffId: discount.metadata?.staffId,
            managerId: discount.metadata?.managerId,
            offHoursHour: hour,
            discountRate,
          },
          associatedEventIds: [discount.id],
        });
      }
    }

    return anomalies;
  }

  /**
   * Kural Tabanlı Algoritma: Karakteristik olmayan iptal artışlarını ve ani patlamaları tespit eder.
   */
  public detectCancellationSpikes(events: OperationalEvent[]): AnomalyScore[] {
    const cancellations = events
      .filter((e) => e.type === 'CANCELLATION')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const anomalies: AnomalyScore[] = [];
    const burstWindowMs = this.config.cancellationBurstWindowMinutes * 60 * 1000;

    for (let i = 0; i < cancellations.length; i++) {
      const windowStart = new Date(cancellations[i].timestamp).getTime();
      const burstEvents = cancellations.slice(i).filter((c) => {
        const t = new Date(c.timestamp).getTime();
        return t >= windowStart && t <= windowStart + burstWindowMs;
      });

      if (burstEvents.length >= this.config.cancellationBurstCountThreshold) {
        const totalBurstAmount = burstEvents.reduce((acc, c) => acc + c.amount, 0);
        const alreadyFlagged = anomalies.some((a) =>
          burstEvents.some((be) => a.associatedEventIds?.includes(be.id))
        );

        if (!alreadyFlagged) {
          const severity: AnomalySeverity =
            burstEvents.length >= this.config.cancellationBurstCountThreshold * 2
              ? 'CRITICAL'
              : 'HIGH';

          anomalies.push({
            id: `ANOM-CANCEL-BURST-${cancellations[i].id}`,
            metric: 'CANCELLATION_FREQUENCY',
            method: 'RULE_BASED',
            type: 'UNCHARACTERISTIC_CANCELLATION_SPIKE',
            severity,
            score: severity === 'CRITICAL' ? 90 : 75,
            zScore: 3.2,
            isAnomaly: true,
            currentValue: burstEvents.length,
            expectedValue: 1,
            deviation: burstEvents.length - 1,
            deviationPercentage: this.round(((burstEvents.length - 1) / 1) * 100, 1),
            reason: `Rapid cancellation burst detected: ${burstEvents.length} cancellations within ${this.config.cancellationBurstWindowMinutes} minutes (total loss: $${totalBurstAmount.toFixed(2)}).`,
            timestamp: cancellations[i].timestamp,
            context: {
              burstCount: burstEvents.length,
              windowMinutes: this.config.cancellationBurstWindowMinutes,
              totalBurstAmount,
            },
            associatedEventIds: burstEvents.map((b) => b.id),
          });
        }
      }
    }

    return anomalies;
  }

  /**
   * Kural Tabanlı Algoritma: Düzensiz ürün iptallerini (tekrarlayan iptaller veya gönderim sonrası iptaller) tespit eder.
   */
  public detectErraticItemVoids(events: OperationalEvent[]): AnomalyScore[] {
    const voids = events.filter((e) => e.type === 'VOID');
    const anomalies: AnomalyScore[] = [];

    const staffVoidMap = new Map<string, OperationalEvent[]>();
    for (const v of voids) {
      const staffKey = (v.metadata?.staffId as string) || 'UNKNOWN_STAFF';
      const staffList = staffVoidMap.get(staffKey) ?? [];
      staffList.push(v);
      staffVoidMap.set(staffKey, staffList);
    }

    for (const [staffId, staffVoids] of staffVoidMap.entries()) {
      const totalVoidAmount = staffVoids.reduce((sum, v) => sum + v.amount, 0);

      if (
        staffVoids.length >= this.config.erraticVoidMaxCountPerWindow ||
        totalVoidAmount >= this.config.erraticVoidAmountThreshold
      ) {
        const severity: AnomalySeverity =
          staffVoids.length > this.config.erraticVoidMaxCountPerWindow * 2 ||
          totalVoidAmount > this.config.erraticVoidAmountThreshold * 2
            ? 'CRITICAL'
            : 'HIGH';

        anomalies.push({
          id: `ANOM-VOID-${staffId}-${Date.now()}`,
          metric: 'VOID_FREQUENCY',
          method: 'RULE_BASED',
          type: 'ERRATIC_ITEM_VOID',
          severity,
          score: severity === 'CRITICAL' ? 92 : 78,
          zScore: 3.1,
          isAnomaly: true,
          currentValue: staffVoids.length,
          expectedValue: 1,
          deviation: staffVoids.length - 1,
          deviationPercentage: this.round(((staffVoids.length - 1) / 1) * 100, 1),
          reason: `Erratic item voids flagged for staff ${staffId}: ${staffVoids.length} voids totaling $${totalVoidAmount.toFixed(2)}.`,
          timestamp: staffVoids[staffVoids.length - 1].timestamp,
          context: {
            staffId,
            voidCount: staffVoids.length,
            totalVoidAmount,
            voidReasons: staffVoids.map(
              (v) => v.metadata?.reason || v.metadata?.voidReason || 'None'
            ),
          },
          associatedEventIds: staffVoids.map((v) => v.id),
        });
      }
    }

    return anomalies;
  }

  /**
   * Kapsamlı Anomali İşlem Hattı: Varyans tabanlı istatistiksel kontrolleri
   * deterministik kural tabanlı tetikleyicilerle birleştirir.
   */
  public detectAllAnomalies(
    events: OperationalEvent[],
    baselineWindows?: Map<MetricStreamType, MetricWindow>
  ): AnomalyScore[] {
    const allAnomalies: AnomalyScore[] = [];

    // 1. Kural tabanlı tetikleyiciler
    allAnomalies.push(...this.detectOffHoursDiscountAnomalies(events));
    allAnomalies.push(...this.detectCancellationSpikes(events));
    allAnomalies.push(...this.detectErraticItemVoids(events));

    // 2. Temel pencereler sağlanmışsa varyans tabanlı kontroller
    if (baselineWindows) {
      for (const window of baselineWindows.values()) {
        const score = this.scoreMetricWindow(window);
        if (score.isAnomaly) {
          allAnomalies.push(score);
        }
      }
    } else {
      // Operasyonel olay akışlarından temel pencereleri dinamik olarak hesapla
      const revenueWindow = this.statsCalculator.calculateRevenueVelocity(events);
      if (revenueWindow.dataPoints.length >= 2) {
        const score = this.scoreMetricWindow(revenueWindow);
        if (score.isAnomaly) allAnomalies.push(score);
      }

      const cancellationWindow = this.statsCalculator.calculateCancellationFrequency(events);
      if (cancellationWindow.dataPoints.length >= 2) {
        const score = this.scoreMetricWindow(cancellationWindow);
        if (score.isAnomaly) allAnomalies.push(score);
      }

      const refundWindow = this.statsCalculator.calculateRefundVolume(events);
      if (refundWindow.dataPoints.length >= 2) {
        const score = this.scoreMetricWindow(refundWindow);
        if (score.isAnomaly) allAnomalies.push(score);
      }
    }

    // Önem derecesine göre azalan şekilde sırala (CRITICAL -> HIGH -> MEDIUM -> LOW)
    const severityOrder: Record<AnomalySeverity, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
      NORMAL: 0,
    };

    return allAnomalies.sort(
      (a, b) => severityOrder[b.severity] - severityOrder[a.severity] || b.score - a.score
    );
  }

  private resolveAnomalyType(streamType: MetricStreamType, zScore: number): AnomalyType {
    switch (streamType) {
      case 'FOOD_COST_RATIO':
        return 'FOOD_COST_SURGE';
      case 'REVENUE_VELOCITY':
        return zScore < 0 ? 'SUDDEN_REVENUE_DROP' : 'REVENUE_VELOCITY_SPIKE';
      case 'CANCELLATION_FREQUENCY':
        return 'UNCHARACTERISTIC_CANCELLATION_SPIKE';
      case 'REFUND_VOLUME':
        return 'REFUND_VOLUME_SURGE';
      case 'DISCOUNT_RATE':
        return 'UNAUTHORIZED_DISCOUNT_LEAK';
      case 'VOID_FREQUENCY':
        return 'ERRATIC_ITEM_VOID';
      default:
        return 'HIGH_VARIANCE_OUTLIER';
    }
  }

  private round(val: number, decimals = 4): number {
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
  }
}
