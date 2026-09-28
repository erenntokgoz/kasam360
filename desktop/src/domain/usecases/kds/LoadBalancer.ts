import {
  BottleneckWarning,
  KitchenLoadReport,
  LoadMetrics,
  Order,
  OrderItem,
  StationType,
} from './types';
import { ALL_STATIONS, StationRouter } from './StationRouter';

export interface LoadBalancerOptions {
  stationCapacities?: Partial<Record<StationType, number>>;
  bottleneckThresholdPercentage?: number;
  itemBaselineWeights?: Record<string, number>;
}

export class LoadBalancer {
  public static readonly DEFAULT_BASELINE_WEIGHTS: Record<string, number> = {
    burger: 1.0,
    pizza: 1.4,
    'mixed platter': 2.3,
    platter: 2.3,
    steak: 1.5,
    wings: 0.9,
    fries: 0.6,
    salad: 0.7,
    sandwich: 0.8,
    beverage: 0.4,
    drink: 0.4,
  };

  public static readonly DEFAULT_CAPACITIES: Record<StationType, number> = {
    Grill: 20.0,
    Fryer: 15.0,
    Pizza: 25.0,
    Bar: 30.0,
    Prep: 20.0,
  };

  public static readonly DEFAULT_BOTTLENECK_THRESHOLD = 80;

  private readonly capacities: Record<StationType, number>;
  private readonly bottleneckThreshold: number;
  private readonly baselineWeights: Record<string, number>;
  private readonly router: StationRouter;

  constructor(options?: LoadBalancerOptions) {
    this.capacities = {
      ...LoadBalancer.DEFAULT_CAPACITIES,
      ...options?.stationCapacities,
    };
    this.bottleneckThreshold =
      options?.bottleneckThresholdPercentage ?? LoadBalancer.DEFAULT_BOTTLENECK_THRESHOLD;
    this.baselineWeights = {
      ...LoadBalancer.DEFAULT_BASELINE_WEIGHTS,
      ...options?.itemBaselineWeights,
    };
    this.router = new StationRouter();
  }

  /**
   * Resolves the complexity weight for an individual order item based on:
   * 1. Item's explicit complexityWeight property
   * 2. Baseline weight table matched against productType, category, or name
   * 3. Fallback default of 1.0
   */
  public getItemWeight(item: OrderItem): number {
    if (typeof item.complexityWeight === 'number' && item.complexityWeight > 0) {
      return item.complexityWeight;
    }

    const descriptors = [item.productType, item.category, item.name]
      .filter((val): val is string => Boolean(val && typeof val === 'string'))
      .map((val) => val.trim().toLowerCase());

    for (const descriptor of descriptors) {
      for (const [key, weight] of Object.entries(this.baselineWeights)) {
        if (descriptor.includes(key)) {
          return weight;
        }
      }
    }

    return 1.0;
  }

  /**
   * Calculates complexity score for a single order item:
   * itemComplexity = weight * quantity
   */
  public calculateItemComplexity(item: OrderItem): number {
    const weight = this.getItemWeight(item);
    const quantity = Math.max(1, item.quantity || 1);
    return Number((weight * quantity).toFixed(2));
  }

  /**
   * Calculates total complexity score for an entire order:
   * Order Complexity = Σ Item Complexity
   */
  public calculateOrderComplexity(order: Order): number {
    if (!order.items || !Array.isArray(order.items)) {
      return 0;
    }

    const total = order.items.reduce((sum, item) => {
      return sum + this.calculateItemComplexity(item);
    }, 0);

    return Number(total.toFixed(2));
  }

  /**
   * Calculates aggregate active kitchen load:
   * Kitchen Load = Σ Order Complexity
   */
  public calculateKitchenLoad(orders: Order[]): number {
    if (!orders || !Array.isArray(orders)) {
      return 0;
    }

    const totalLoad = orders.reduce((sum, order) => {
      return sum + this.calculateOrderComplexity(order);
    }, 0);

    return Number(totalLoad.toFixed(2));
  }

  /**
   * Computes station-based analytics including active cumulative load and percentage.
   */
  public calculateStationMetrics(orders: Order[]): Record<StationType, LoadMetrics> {
    const metrics: Record<StationType, LoadMetrics> = {
      Grill: this.createEmptyMetrics('Grill'),
      Fryer: this.createEmptyMetrics('Fryer'),
      Pizza: this.createEmptyMetrics('Pizza'),
      Bar: this.createEmptyMetrics('Bar'),
      Prep: this.createEmptyMetrics('Prep'),
    };

    if (!orders || !Array.isArray(orders)) {
      return metrics;
    }

    for (const order of orders) {
      const partitioned = this.router.routeOrder(order);

      for (const station of ALL_STATIONS) {
        const items = partitioned[station];
        if (items && items.length > 0) {
          metrics[station].activeOrdersCount += 1;
          for (const item of items) {
            metrics[station].totalItemsCount += item.quantity || 1;
            metrics[station].cumulativeComplexity += this.calculateItemComplexity(item);
          }
        }
      }
    }

    for (const station of ALL_STATIONS) {
      const current = metrics[station];
      const capacity = this.capacities[station];
      current.cumulativeComplexity = Number(current.cumulativeComplexity.toFixed(2));
      current.maxCapacity = capacity;
      current.loadPercentage = Math.round((current.cumulativeComplexity / capacity) * 100);
      current.formattedLoad = `${station} Load: ${current.loadPercentage}%`;
      current.isBottleneck = current.loadPercentage >= this.bottleneckThreshold;
    }

    return metrics;
  }

  /**
   * Evaluates station metrics and produces bottleneck threshold warning events
   * for stations that exceed the operational limit.
   */
  public detectBottlenecks(metrics: Record<StationType, LoadMetrics>): BottleneckWarning[] {
    const warnings: BottleneckWarning[] = [];

    for (const station of ALL_STATIONS) {
      const metric = metrics[station];
      if (metric && metric.loadPercentage >= this.bottleneckThreshold) {
        const severity = metric.loadPercentage >= 100 ? 'CRITICAL' : 'WARNING';
        warnings.push({
          station,
          currentLoadPercentage: metric.loadPercentage,
          thresholdPercentage: this.bottleneckThreshold,
          formattedLoad: metric.formattedLoad,
          severity,
          message: `Station ${station} operational limit exceeded: ${metric.loadPercentage}% (Threshold: ${this.bottleneckThreshold}%)`,
          timestamp: new Date(),
        });
      }
    }

    return warnings;
  }

  /**
   * Generates a complete load balance report including kitchen load, station analytics,
   * and bottleneck alerts.
   */
  public analyzeKitchenLoad(orders: Order[]): KitchenLoadReport {
    const totalKitchenLoad = this.calculateKitchenLoad(orders);
    const stationMetrics = this.calculateStationMetrics(orders);
    const bottlenecks = this.detectBottlenecks(stationMetrics);

    return {
      totalKitchenLoad,
      stationMetrics,
      bottlenecks,
      timestamp: new Date(),
    };
  }

  private createEmptyMetrics(station: StationType): LoadMetrics {
    const capacity = this.capacities[station] || 1;
    return {
      station,
      activeOrdersCount: 0,
      totalItemsCount: 0,
      cumulativeComplexity: 0,
      maxCapacity: capacity,
      loadPercentage: 0,
      formattedLoad: `${station} Load: 0%`,
      isBottleneck: false,
    };
  }
}
