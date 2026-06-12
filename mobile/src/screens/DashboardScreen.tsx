import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  StatusBar,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getDashboardData, type DashboardData, type MonthlyTrendPoint } from '../api/dashboardService';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';

const MONTH_NAMES = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "2025-11" → "Kas 25" */
function formatMonthKey(key: string): string {
  const [yearStr, monthStr] = key.split('-');
  const month = parseInt(monthStr, 10) - 1;
  const year = yearStr.slice(-2);
  return `${MONTH_NAMES[month] ?? key} ${year}`;
}

function formatAmount(cents: number): string {
  return (cents / 100).toLocaleString('tr-TR');
}

function PctBadge({ pct }: { pct: number }) {
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);
  const isPositive = pct >= 0;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: isPositive ? theme.colors.successTransparent : theme.colors.dangerTransparent },
      ]}
    >
      <Icon
        name={isPositive ? 'trending-up' : 'trending-down'}
        size={11}
        color={isPositive ? theme.colors.success : theme.colors.danger}
      />
      <Text
        style={[
          styles.badgeText,
          { color: isPositive ? theme.colors.success : theme.colors.danger },
        ]}
      >
        {Math.abs(pct)}%
      </Text>
    </View>
  );
}

export default function DashboardScreen() {
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const { data, isLoading, isError, refetch } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: getDashboardData,
    staleTime: 2 * 60 * 1000, // 2 dakika — sık değişen veri
  });

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.primary }]}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.primary }]}>
        <Icon name="wifi-off" size={40} color={theme.colors.textSecondary} />
        <Text style={[styles.errorText, { color: theme.colors.textSecondary }]}>
          Veri yüklenemedi
        </Text>
        <Pressable
          onPress={() => refetch()}
          style={[styles.retryBtn, { backgroundColor: theme.colors.accentTransparent }]}
        >
          <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  }

  const { currentMonth, changeFromPrevMonth, overallSummary, monthlyTrend, categoryBreakdown } = data;

  const maxTrend = monthlyTrend?.length > 0 ? Math.max(
    ...monthlyTrend.flatMap((d: MonthlyTrendPoint) => [d.income, d.expense]),
    1,
  ) : 1;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.primary, paddingTop: insets.top }]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      {/* ── Header ── */}
      <View
        style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}
      >
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Dashboard</Text>
        <Pressable hitSlop={12} onPress={() => refetch()}>
          <Icon name="refresh-cw" size={18} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>

        {/* ── Genel Bakiye Kartı ── */}
        <View style={[styles.card, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Genel Bakiye</Text>
          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>Toplam Bakiye</Text>
              <Text style={[styles.bigAmount, { color: theme.colors.accent }]}>
                {overallSummary ? formatAmount(overallSummary.balance) : '0'} ₺
              </Text>
            </View>
            <View style={[styles.iconCircle, { backgroundColor: theme.colors.accentTransparent }]}>
              <Icon name="credit-card" size={24} color={theme.colors.accent} />
            </View>
          </View>

          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Toplam Gelir</Text>
              <Text style={[styles.gridAmount, { color: theme.colors.success }]}>
                {overallSummary ? formatAmount(overallSummary.totalIncome) : '0'} ₺
              </Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Toplam Gider</Text>
              <Text style={[styles.gridAmount, { color: theme.colors.danger }]}>
                {overallSummary ? formatAmount(overallSummary.totalExpense) : '0'} ₺
              </Text>
            </View>
          </View>
        </View>

        {/* ── Bu Ay Özeti ── */}
        <View style={[styles.card, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Bu Ay</Text>
          <View style={styles.divider} />

          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Gelir</Text>
              <Text style={[styles.gridAmount, { color: theme.colors.success }]}>
                {formatAmount(currentMonth.income)} ₺
              </Text>
              <PctBadge pct={changeFromPrevMonth.incomeChangePct} />
            </View>
            <View style={styles.gridItem}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Gider</Text>
              <Text style={[styles.gridAmount, { color: theme.colors.danger }]}>
                {formatAmount(currentMonth.expense)} ₺
              </Text>
              <PctBadge pct={-changeFromPrevMonth.expenseChangePct} />
            </View>
            <View style={styles.gridItem}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Net Kâr</Text>
              <Text
                style={[
                  styles.gridAmount,
                  { color: currentMonth.isProfit ? theme.colors.success : theme.colors.danger },
                ]}
              >
                {formatAmount(currentMonth.netProfit)} ₺
              </Text>
              <PctBadge pct={changeFromPrevMonth.netProfitChangePct} />
            </View>
          </View>
        </View>

        {/* ── 6 Aylık Trend ── */}
        {monthlyTrend.length > 0 && (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
              Gelir / Gider Trendi (6 Ay)
            </Text>
            <View style={styles.divider} />

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chartContainer}>
                {monthlyTrend.map((d: MonthlyTrendPoint, index: number) => {
                  const incomeH = Math.max((d.income / maxTrend) * 120, d.income > 0 ? 4 : 0);
                  const expenseH = Math.max((d.expense / maxTrend) * 120, d.expense > 0 ? 4 : 0);
                  return (
                    <View key={index} style={styles.chartColumn}>
                      <View style={styles.barGroup}>
                        <View style={[styles.bar, { height: incomeH, backgroundColor: theme.colors.success }]} />
                        <View style={[styles.bar, { height: expenseH, backgroundColor: theme.colors.danger }]} />
                      </View>
                      <Text style={[styles.monthText, { color: theme.colors.textSecondary }]}>
                        {formatMonthKey(d.month)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendColor, { backgroundColor: theme.colors.success }]} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Gelir</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendColor, { backgroundColor: theme.colors.danger }]} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Gider</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── Kategori Dağılımı (Bu Ay Giderler) ── */}
        {categoryBreakdown.length > 0 && (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
              Bu Ay Gider Kategorileri
            </Text>
            <View style={styles.divider} />

            {categoryBreakdown.map((cat, index) => (
              <View key={index} style={styles.categoryRow}>
                <View style={styles.categoryLabelRow}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 13, flex: 1 }} numberOfLines={1}>
                    {cat.category}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    {formatAmount(cat.total)} ₺  ({cat.percentage}%)
                  </Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(cat.percentage, 100)}%`,
                        backgroundColor: theme.colors.danger,
                        opacity: 0.7 + (index === 0 ? 0.3 : 0),
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  errorText: { fontSize: 15, marginTop: 8 },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  container: { flex: 1, paddingHorizontal: 16 },
  card: { padding: 20, borderRadius: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.05)', marginBottom: 16 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  bigAmount: { fontSize: 26, fontWeight: 'bold', marginTop: 4 },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', gap: 12 },
  gridItem: { flex: 1 },
  gridAmount: { fontSize: 16, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    paddingHorizontal: 10,
    height: 160,
    paddingBottom: 20,
  },
  chartColumn: { alignItems: 'center' },
  barGroup: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 120 },
  bar: { width: 12, borderRadius: 4 },
  monthText: { fontSize: 11, marginTop: 8 },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 10,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendColor: { width: 12, height: 12, borderRadius: 3 },
  categoryRow: { marginBottom: 12 },
  categoryLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
});
