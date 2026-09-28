import { MetricDataPoint, MetricStreamType, MetricWindow, OperationalEvent } from './types';

export interface RollingStatsConfig {
  defaultWindowSize?: number;
  minSamplesForVariance?: number;
}

/**
 * Enterprise Sliding-Window Statistical Engine.
 * Computes moving averages, sample variance, standard deviation, and Z-scores
 * across operational streams without external statistical packages.
 */
export class RollingStatsCalculator {
  private defaultWindowSize: number;
  private minSamplesForVariance: number;

  constructor(config?: RollingStatsConfig) {
    this.defaultWindowSize = config?.defaultWindowSize ?? 14;
    this.minSamplesForVariance = config?.minSamplesForVariance ?? 2;
  }

  /**
   * Computes sample mean (moving average).
   */
  public calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, val) => acc + val, 0);
    return this.round(sum / values.length);
  }

  /**
   * Computes variance (Bessel's correction for sample variance by default).
   */
  public calculateVariance(values: number[], isSample = true): number {
    if (values.length < (isSample ? this.minSamplesForVariance : 1)) {
      return 0;
    }

    const mean = this.calculateMean(values);
    const sumSquaredDiffs = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
    const denominator = isSample ? values.length - 1 : values.length;

    if (denominator <= 0) return 0;
    return this.round(sumSquaredDiffs / denominator);
  }

  /**
   * Computes standard deviation from sample variance.
   */
  public calculateStandardDeviation(values: number[], isSample = true): number {
    const variance = this.calculateVariance(values, isSample);
    return this.round(Math.sqrt(variance));
  }

  /**
   * Computes Z-Score: number of standard deviations an observation is from the mean.
   */
  public computeZScore(value: number, mean: number, standardDeviation: number): number {
    if (standardDeviation === 0) return 0;
    return this.round((value - mean) / standardDeviation);
  }

  /**
   * Computes a strict MetricWindow over an array of timestamped data points.
   */
  public calculateWindow(
    dataPoints: MetricDataPoint[],
    streamType: MetricStreamType = 'CUSTOM',
    windowSize?: number
  ): MetricWindow {
    const effectiveWindowSize = windowSize ?? this.defaultWindowSize;
    const activePoints = dataPoints.slice(-effectiveWindowSize);
    const values = activePoints.map((p) => p.value);

    const currentValue = values.length > 0 ? values[values.length - 1] : 0;
    const mean = this.calculateMean(values);
    const variance = this.calculateVariance(values, true);
    const standardDeviation = this.round(Math.sqrt(variance));
    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const zScore = this.computeZScore(currentValue, mean, standardDeviation);

    const latestTimestamp =
      activePoints.length > 0
        ? activePoints[activePoints.length - 1].timestamp
        : new Date().toISOString();

    return {
      streamType,
      windowSize: effectiveWindowSize,
      dataPoints: activePoints,
      currentValue,
      mean,
      standardDeviation,
      variance,
      min: this.round(min),
      max: this.round(max),
      zScore,
      timestamp: latestTimestamp,
    };
  }

  /**
   * Computes a MetricWindow directly from an array of numeric values.
   */
  public calculateWindowFromValues(
    values: number[],
    streamType: MetricStreamType = 'CUSTOM',
    windowSize?: number,
    baseTimestamp?: string
  ): MetricWindow {
    const effectiveTimestamp = baseTimestamp ?? new Date().toISOString();
    const dataPoints: MetricDataPoint[] = values.map((val, idx) => ({
      value: val,
      timestamp: new Date(
        new Date(effectiveTimestamp).getTime() - (values.length - 1 - idx) * 3600000
      ).toISOString(),
    }));

    return this.calculateWindow(dataPoints, streamType, windowSize);
  }

  /**
   * Computes a series of sliding windows across the full timeseries.
   */
  public calculateRollingSeries(
    dataPoints: MetricDataPoint[],
    windowSize: number = this.defaultWindowSize,
    streamType: MetricStreamType = 'CUSTOM'
  ): MetricWindow[] {
    if (dataPoints.length === 0) return [];

    const windows: MetricWindow[] = [];
    for (let i = 1; i <= dataPoints.length; i++) {
      const slice = dataPoints.slice(Math.max(0, i - windowSize), i);
      windows.push(this.calculateWindow(slice, streamType, windowSize));
    }

    return windows;
  }

  /**
   * Computes Revenue Velocity: Sales revenue rate per interval over a sliding window.
   */
  public calculateRevenueVelocity(
    events: OperationalEvent[],
    intervalMinutes = 60,
    windowSize?: number
  ): MetricWindow {
    const sales = events.filter((e) => e.type === 'SALE');
    const buckets = this.bucketEventsByInterval(sales, intervalMinutes);
    const dataPoints: MetricDataPoint[] = buckets.map((b) => ({
      timestamp: b.intervalStart,
      value: this.round(b.events.reduce((sum, e) => sum + e.amount, 0)),
    }));

    return this.calculateWindow(dataPoints, 'REVENUE_VELOCITY', windowSize);
  }

  /**
   * Computes Food Cost Ratio: Ratio of COGS to Gross Revenue per interval over a sliding window.
   */
  public calculateFoodCostRatio(
    salesEvents: OperationalEvent[],
    costEvents: OperationalEvent[],
    intervalMinutes = 60,
    windowSize?: number
  ): MetricWindow {
    const allEvents = [...salesEvents, ...costEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const buckets = this.bucketEventsByInterval(allEvents, intervalMinutes);
    const dataPoints: MetricDataPoint[] = buckets.map((b) => {
      const revenue = b.events
        .filter((e) => e.type === 'SALE')
        .reduce((sum, e) => sum + e.amount, 0);

      const cost = b.events
        .filter((e) => e.type === 'RECEIVING_COST' || e.type === 'WASTE')
        .reduce((sum, e) => sum + e.amount, 0);

      const ratio = revenue > 0 ? this.round(cost / revenue) : 0;

      return {
        timestamp: b.intervalStart,
        value: ratio,
      };
    });

    return this.calculateWindow(dataPoints, 'FOOD_COST_RATIO', windowSize);
  }

  /**
   * Computes Cancellation Frequency: Cancellation count per total orders over a sliding window.
   */
  public calculateCancellationFrequency(
    events: OperationalEvent[],
    intervalMinutes = 60,
    windowSize?: number
  ): MetricWindow {
    const orderEvents = events.filter((e) => e.type === 'SALE' || e.type === 'CANCELLATION');
    const buckets = this.bucketEventsByInterval(orderEvents, intervalMinutes);

    const dataPoints: MetricDataPoint[] = buckets.map((b) => {
      const cancellations = b.events.filter((e) => e.type === 'CANCELLATION').length;
      const totalOrders = b.events.length;
      const frequency = totalOrders > 0 ? this.round(cancellations / totalOrders) : 0;

      return {
        timestamp: b.intervalStart,
        value: frequency,
      };
    });

    return this.calculateWindow(dataPoints, 'CANCELLATION_FREQUENCY', windowSize);
  }

  /**
   * Computes Refund Volume: Total refund amounts per interval over a sliding window.
   */
  public calculateRefundVolume(
    events: OperationalEvent[],
    intervalMinutes = 60,
    windowSize?: number
  ): MetricWindow {
    const refunds = events.filter((e) => e.type === 'REFUND');
    const buckets = this.bucketEventsByInterval(refunds, intervalMinutes);

    const dataPoints: MetricDataPoint[] = buckets.map((b) => ({
      timestamp: b.intervalStart,
      value: this.round(b.events.reduce((sum, e) => sum + e.amount, 0)),
    }));

    return this.calculateWindow(dataPoints, 'REFUND_VOLUME', windowSize);
  }

  /**
   * Helper: Groups events into chronological time buckets.
   */
  private bucketEventsByInterval(
    events: OperationalEvent[],
    intervalMinutes: number
  ): Array<{ intervalStart: string; events: OperationalEvent[] }> {
    if (events.length === 0) return [];

    const sorted = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const intervalMs = intervalMinutes * 60 * 1000;
    const firstTime = new Date(sorted[0].timestamp).getTime();
    const lastTime = new Date(sorted[sorted.length - 1].timestamp).getTime();

    const bucketsMap = new Map<number, OperationalEvent[]>();
    for (let time = firstTime; time <= lastTime; time += intervalMs) {
      bucketsMap.set(time, []);
    }

    for (const event of sorted) {
      const eventTime = new Date(event.timestamp).getTime();
      const bucketKey = firstTime + Math.floor((eventTime - firstTime) / intervalMs) * intervalMs;
      const bucket = bucketsMap.get(bucketKey);
      if (bucket) {
        bucket.push(event);
      } else {
        bucketsMap.set(bucketKey, [event]);
      }
    }

    return Array.from(bucketsMap.entries()).map(([timeKey, bucketEvents]) => ({
      intervalStart: new Date(timeKey).toISOString(),
      events: bucketEvents,
    }));
  }

  private round(val: number, decimals = 4): number {
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
  }
}
