export interface AnalyticsDashboardDataDto {
    total_sales_cents: number;
    transaction_count: number;
    average_order_value_cents: number;
    popular_categories: Record<string, number>;
}
