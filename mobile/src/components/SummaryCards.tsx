import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { formatCurrency } from '../utils/format';
import type { CurrentMonthSummary, ChangeFromPrevMonth, OverallSummary } from '../api/dashboardService';

interface SummaryCardsProps {
  currentMonth: CurrentMonthSummary;
  change: ChangeFromPrevMonth;
  overall: OverallSummary;
}

/**
 * Yön göstergesi bileşeni — yüzde değişimi ve ok ikonuyla birlikte.
 */
const TrendBadge: React.FC<{ pct: number; inverse?: boolean }> = ({ pct, inverse = false }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  // Gelir artışı → yeşil, Gider artışı → kırmızı (inverse = true için)
  const isPositive = inverse ? pct < 0 : pct > 0;
  const isNeutral = pct === 0;
  const color = isNeutral
    ? theme.colors.textTertiary
    : isPositive
    ? theme.colors.success
    : theme.colors.danger;
  const bgColor = isNeutral
    ? theme.colors.whiteTransparent
    : isPositive
    ? theme.colors.successTransparent
    : theme.colors.dangerTransparent;
  const iconName = isNeutral ? 'minus' : pct > 0 ? 'trending-up' : 'trending-down';

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Icon name={iconName} size={10} color={color} />
      <Text style={[styles.badgeText, { color }]}>
        {pct > 0 ? '+' : ''}
        {pct.toFixed(1)}%
      </Text>
    </View>
  );
};

/**
 * Tek bir metrik kartı.
 */
const MetricCard: React.FC<{
  label: string;
  value: number;
  iconName: string;
  accentColor: string;
  accentBg: string;
  pctChange?: number;
  inverseTrend?: boolean;
}> = ({ label, value, iconName, accentColor, accentBg, pctChange, inverseTrend }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  return (
    <View style={[styles.metricCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
      <View style={[styles.metricIconWrap, { backgroundColor: accentBg }]}>
        <Icon name={iconName} size={18} color={accentColor} />
      </View>
      <Text style={[styles.metricLabel, { color: theme.colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: theme.colors.textPrimary }]}>
        {formatCurrency(value)}
      </Text>
      {pctChange !== undefined && (
        <View style={styles.metricTrendRow}>
          <TrendBadge pct={pctChange} inverse={inverseTrend} />
          <Text style={[styles.prevMonthLabel, { color: theme.colors.textTertiary }]}>
            {' '}geçen ay
          </Text>
        </View>
      )}
    </View>
  );
};

const SummaryCards: React.FC<SummaryCardsProps> = ({ currentMonth, change, overall }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  const profitColor = currentMonth.isProfit ? theme.colors.success : theme.colors.danger;
  const profitBg = currentMonth.isProfit ? theme.colors.successTransparent : theme.colors.dangerTransparent;

  return (
    <View style={styles.container}>
      {/* Üst satır: Bakiye + Kar/Zarar */}
      <View style={[styles.heroBanner, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
        <View style={styles.heroLeft}>
          <Text style={[styles.heroLabel, { color: theme.colors.textTertiary }]}>
            TOPLAM BAKİYE
          </Text>
          <Text style={[styles.heroBalance, { color: theme.colors.textPrimary }]}>
            {formatCurrency(overall.balance)}
          </Text>
          <View style={styles.heroRow}>
            <Icon name="arrow-down-left" size={12} color={theme.colors.success} />
            <Text style={[styles.heroSub, { color: theme.colors.textSecondary }]}>
              {' '}{formatCurrency(overall.totalIncome)} gelir
            </Text>
            <Text style={[styles.heroDot, { color: theme.colors.textTertiary }]}> · </Text>
            <Icon name="arrow-up-right" size={12} color={theme.colors.danger} />
            <Text style={[styles.heroSub, { color: theme.colors.textSecondary }]}>
              {' '}{formatCurrency(overall.totalExpense)} gider
            </Text>
          </View>
        </View>
        <View style={[styles.profitBadge, { backgroundColor: profitBg }]}>
          <Icon
            name={currentMonth.isProfit ? 'trending-up' : 'trending-down'}
            size={14}
            color={profitColor}
          />
          <Text style={[styles.profitLabel, { color: profitColor }]}>
            {currentMonth.isProfit ? 'Kâr' : 'Zarar'}
          </Text>
          <Text style={[styles.profitValue, { color: profitColor }]}>
            {formatCurrency(Math.abs(currentMonth.netProfit))}
          </Text>
        </View>
      </View>

      {/* Alt satır: 3 metrik kart */}
      <View style={styles.metricsRow}>
        <View style={styles.metricWrap}>
          <MetricCard
            label="Bu Ay Gelir"
            value={currentMonth.income}
            iconName="arrow-down-left"
            accentColor={theme.colors.success}
            accentBg={theme.colors.successTransparent}
            pctChange={change.incomeChangePct}
            inverseTrend={false}
          />
        </View>
        <View style={styles.metricWrap}>
          <MetricCard
            label="Bu Ay Gider"
            value={currentMonth.expense}
            iconName="arrow-up-right"
            accentColor={theme.colors.danger}
            accentBg={theme.colors.dangerTransparent}
            pctChange={change.expenseChangePct}
            inverseTrend={true}
          />
        </View>
        <View style={styles.metricWrap}>
          <MetricCard
            label="Net Kâr/Zarar"
            value={currentMonth.netProfit}
            iconName={currentMonth.isProfit ? 'trending-up' : 'trending-down'}
            accentColor={profitColor}
            accentBg={profitBg}
            pctChange={change.netProfitChangePct}
            inverseTrend={false}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 12 },
  heroBanner: {
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLeft: { flex: 1 },
  heroLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  heroBalance: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  heroRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' },
  heroSub: { fontSize: 12, fontWeight: '500' },
  heroDot: { fontSize: 12 },
  profitBadge: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 4,
    marginLeft: 12,
  },
  profitLabel: { fontSize: 11, fontWeight: '600' },
  profitValue: { fontSize: 13, fontWeight: '800' },
  metricsRow: { flexDirection: 'row', gap: 10 },
  metricWrap: { flex: 1 },
  metricCard: { borderRadius: 16, padding: 14, gap: 6 },
  metricIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  metricLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  metricValue: { fontSize: 13, fontWeight: '700' },
  metricTrendRow: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
  prevMonthLabel: { fontSize: 9 },
});

export default SummaryCards;
