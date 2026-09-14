import { BranchIsolationGuard } from './BranchIsolationGuard';
import {
  BranchFinancialMetrics,
  BranchReportingPeriod,
  ConsolidatedReport,
  OwnerDashboardMetrics,
  TenantBranchContext,
} from './types';

export class ConsolidatedReportingEngine {
  private static round(value: number, decimals: number = 4): number {
    const factor = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  /**
   * İki ISO tarihi arasındaki saatleri hesaplar, minimum 1 saat düşme payı ile.
   */
  public static calculatePeriodHours(startDate: string, endDate: string): number {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const diffHours = (end - start) / (1000 * 60 * 60);
    return diffHours > 0 ? ConsolidatedReportingEngine.round(diffHours, 2) : 1;
  }

  /**
   * Doğrulanmış hassasiyet ve marj korumalarıyla tek şubeli finansal ölçümleri sentezler.
   */
  public static computeBranchMetrics(params: {
    branchId: string;
    branchName: string;
    currency: string;
    grossRevenue: number;
    netRevenue?: number;
    cogs: number;
    operatingExpenses: number;
    ordersCount: number;
    stockTransfersOutValue?: number;
    stockTransfersInValue?: number;
    inventoryValuation?: number;
  }): BranchFinancialMetrics {
    const grossRevenue = ConsolidatedReportingEngine.round(params.grossRevenue, 2);
    const netRevenue = ConsolidatedReportingEngine.round(
      params.netRevenue !== undefined ? params.netRevenue : params.grossRevenue,
      2
    );
    const cogs = ConsolidatedReportingEngine.round(params.cogs, 2);
    const operatingExpenses = ConsolidatedReportingEngine.round(params.operatingExpenses, 2);
    const netProfit = ConsolidatedReportingEngine.round(netRevenue - cogs - operatingExpenses, 2);

    const foodCostPercentage =
      grossRevenue > 0 ? ConsolidatedReportingEngine.round((cogs / grossRevenue) * 100, 2) : 0;

    const netProfitMarginPercentage =
      netRevenue > 0 ? ConsolidatedReportingEngine.round((netProfit / netRevenue) * 100, 2) : 0;

    const averageOrderValue =
      params.ordersCount > 0
        ? ConsolidatedReportingEngine.round(grossRevenue / params.ordersCount, 2)
        : 0;

    return {
      branchId: params.branchId,
      branchName: params.branchName,
      currency: params.currency,
      grossRevenue,
      netRevenue,
      cogs,
      foodCostPercentage,
      operatingExpenses,
      netProfit,
      netProfitMarginPercentage,
      ordersCount: params.ordersCount,
      averageOrderValue,
      stockTransfersOutValue: ConsolidatedReportingEngine.round(
        params.stockTransfersOutValue || 0,
        2
      ),
      stockTransfersInValue: ConsolidatedReportingEngine.round(
        params.stockTransfersInValue || 0,
        2
      ),
      inventoryValuation: ConsolidatedReportingEngine.round(params.inventoryValuation || 0, 2),
    };
  }

  /**
   * Tüm aktif şubeler genelinde merkezi Sahip Gösterge Tablosu Ölçümleri özetini sentezler.
   */
  public static synthesizeOwnerDashboardMetrics(
    branchMetrics: BranchFinancialMetrics[],
    durationHours: number
  ): OwnerDashboardMetrics {
    let totalRevenue = 0;
    let totalNetRevenue = 0;
    let totalCogs = 0;
    let totalOperatingExpenses = 0;
    let totalOrdersCount = 0;

    for (const b of branchMetrics) {
      totalRevenue += b.grossRevenue;
      totalNetRevenue += b.netRevenue;
      totalCogs += b.cogs;
      totalOperatingExpenses += b.operatingExpenses;
      totalOrdersCount += b.ordersCount;
    }

    totalRevenue = ConsolidatedReportingEngine.round(totalRevenue, 2);
    totalNetRevenue = ConsolidatedReportingEngine.round(totalNetRevenue, 2);
    totalCogs = ConsolidatedReportingEngine.round(totalCogs, 2);
    totalOperatingExpenses = ConsolidatedReportingEngine.round(totalOperatingExpenses, 2);

    const grossProfit = ConsolidatedReportingEngine.round(totalRevenue - totalCogs, 2);
    const netProfit = ConsolidatedReportingEngine.round(
      totalNetRevenue - totalCogs - totalOperatingExpenses,
      2
    );

    const blendedFoodCostPercentage =
      totalRevenue > 0 ? ConsolidatedReportingEngine.round((totalCogs / totalRevenue) * 100, 2) : 0;

    const grossProfitMarginPercentage =
      totalRevenue > 0
        ? ConsolidatedReportingEngine.round((grossProfit / totalRevenue) * 100, 2)
        : 0;

    const netProfitMarginPercentage =
      totalNetRevenue > 0
        ? ConsolidatedReportingEngine.round((netProfit / totalNetRevenue) * 100, 2)
        : 0;

    const safeHours = Math.max(durationHours, 0.01);
    const revenueVelocityPerHour = ConsolidatedReportingEngine.round(totalRevenue / safeHours, 2);

    const averageOrderValue =
      totalOrdersCount > 0
        ? ConsolidatedReportingEngine.round(totalRevenue / totalOrdersCount, 2)
        : 0;

    // En iyi performans gösterenleri ve verimlilik liderlerini belirle
    let topPerformingBranchId = '';
    let highestRevenue = -1;

    let lowestFoodCostBranchId = '';
    let lowestFoodCost = Number.MAX_VALUE;

    let mostProfitableBranchId = '';
    let highestNetProfit = -Number.MAX_VALUE;

    for (const b of branchMetrics) {
      if (b.grossRevenue > highestRevenue) {
        highestRevenue = b.grossRevenue;
        topPerformingBranchId = b.branchId;
      }

      // Gıda maliyeti verimliliği kıyaslaması için sıfır gelirli şubeleri filtrele
      if (b.grossRevenue > 0 && b.foodCostPercentage < lowestFoodCost) {
        lowestFoodCost = b.foodCostPercentage;
        lowestFoodCostBranchId = b.branchId;
      }

      if (b.netProfit > highestNetProfit) {
        highestNetProfit = b.netProfit;
        mostProfitableBranchId = b.branchId;
      }
    }

    return {
      totalRevenue,
      totalNetRevenue,
      revenueVelocityPerHour,
      totalCogs,
      blendedFoodCostPercentage,
      grossProfit,
      grossProfitMarginPercentage,
      totalOperatingExpenses,
      netProfit,
      netProfitMarginPercentage,
      totalOrdersCount,
      averageOrderValue,
      activeBranchesCount: branchMetrics.length,
      topPerformingBranchId: topPerformingBranchId || (branchMetrics[0]?.branchId ?? ''),
      lowestFoodCostBranchId: lowestFoodCostBranchId || (branchMetrics[0]?.branchId ?? ''),
      mostProfitableBranchId: mostProfitableBranchId || (branchMetrics[0]?.branchId ?? ''),
    };
  }

  /**
   * Tüm yönetilen şubeler genelinde, kiracı sınırlarını uygulayarak ve finansal anomalileri belirleyerek
   * tamamen birleştirilmiş kurumsal bir rapor oluşturur.
   */
  public static generateConsolidatedReport(params: {
    tenantId: string;
    startDate: string;
    endDate: string;
    reportingCurrency: string;
    branches: BranchFinancialMetrics[];
    context?: TenantBranchContext;
  }): ConsolidatedReport {
    // Kiracı izolasyon sınırını kesinlikle iddia et
    BranchIsolationGuard.assertTenantAccess(params.tenantId, params.context);

    const durationHours = ConsolidatedReportingEngine.calculatePeriodHours(
      params.startDate,
      params.endDate
    );

    const period: BranchReportingPeriod = {
      startDate: params.startDate,
      endDate: params.endDate,
      durationHours,
    };

    const summary = ConsolidatedReportingEngine.synthesizeOwnerDashboardMetrics(
      params.branches,
      durationHours
    );

    const branchBreakdowns: Record<string, BranchFinancialMetrics> = {};
    for (const b of params.branches) {
      branchBreakdowns[b.branchId] = b;
    }

    // Şube Sıralamaları
    const byRevenue = [...params.branches]
      .sort((a, b) => b.grossRevenue - a.grossRevenue)
      .map((b) => b.branchId);

    const byNetProfit = [...params.branches]
      .sort((a, b) => b.netProfit - a.netProfit)
      .map((b) => b.branchId);

    const byFoodCostEfficiency = [...params.branches]
      .filter((b) => b.grossRevenue > 0)
      .sort((a, b) => a.foodCostPercentage - b.foodCostPercentage)
      .map((b) => b.branchId);

    // Operasyonel ve Finansal Anomaliler
    const anomalies: string[] = [];
    for (const b of params.branches) {
      if (b.foodCostPercentage > 40) {
        anomalies.push(
          `[CRITICAL_FOOD_COST] Branch ${b.branchName} (${b.branchId}) food cost at ${b.foodCostPercentage}% exceeds 40% threshold.`
        );
      }
      if (b.netProfit < 0) {
        anomalies.push(
          `[NEGATIVE_MARGIN] Branch ${b.branchName} (${b.branchId}) is operating at a net loss (${b.netProfit} ${b.currency}).`
        );
      }
      if (b.grossRevenue === 0 && b.ordersCount === 0) {
        anomalies.push(
          `[ZERO_ACTIVITY] Branch ${b.branchName} (${b.branchId}) logged zero orders and revenue during the period.`
        );
      }
    }

    const reportId = `rep_${params.tenantId}_${Date.now()}`;

    return {
      reportId,
      tenantId: params.tenantId,
      period,
      currency: params.reportingCurrency,
      generatedAt: new Date().toISOString(),
      summary,
      branchBreakdowns,
      branchRankings: {
        byRevenue,
        byNetProfit,
        byFoodCostEfficiency,
      },
      anomalies,
    };
  }
}
