import apiClient from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonthlyTrendPoint {
  month: string;        // "2025-11" format
  income: number;       // kuruş (integer)
  expense: number;      // kuruş (integer)
  netProfit: number;    // kuruş (integer)
}

export interface CategoryBreakdown {
  category: string;
  total: number;        // kuruş (integer)
  count: number;
  percentage: number;   // 0-100, 2 ondalık
}

export interface CurrentMonthSummary {
  income: number;
  expense: number;
  netProfit: number;
  isProfit: boolean;
}

export interface ChangeFromPrevMonth {
  incomeChangePct: number;
  expenseChangePct: number;
  netProfitChangePct: number;
  prevIncome: number;
  prevExpense: number;
  prevNetProfit: number;
}

export interface OverallSummary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

export interface DashboardData {
  currentMonth: CurrentMonthSummary;
  changeFromPrevMonth: ChangeFromPrevMonth;
  overallSummary: OverallSummary;
  monthlyTrend: MonthlyTrendPoint[];
  categoryBreakdown: CategoryBreakdown[];
  generatedAt: string;
  period: {
    currentMonthStart: string;
    sixMonthsAgo: string;
  };
}

interface DashboardResponse {
  success: boolean;
  data: DashboardData;
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Mevcut tenant'ın dashboard analitik verisini çeker.
 * Backend tek bir aggregation roundtrip ile hesaplar.
 */
export const getDashboardData = async (): Promise<DashboardData> => {
  const { data } = await apiClient.get<DashboardResponse>('/api/dashboard');
  return data.data;
};
