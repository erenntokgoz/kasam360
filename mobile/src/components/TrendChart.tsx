import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import Svg, { Path, Polyline, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { formatCurrency } from '../utils/format';
import type { MonthlyTrendPoint } from '../api/dashboardService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 48;    // paddings dahil
const CHART_HEIGHT = 180;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;                    // X eksen etiketleri için alan

/**
 * Türkçe kısa ay adları ("2025-11" → "Kas 25")
 */
const formatMonthLabel = (key: string): string => {
  const [year, month] = key.split('-');
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${months[parseInt(month, 10) - 1]} ${year.slice(2)}`;
};

/**
 * Polyline koordinatlarını "x1,y1 x2,y2 ..." formatına çevirir.
 */
const buildPolylinePoints = (
  data: number[],
  max: number,
  min: number,
  plotW: number,
  plotH: number,
): string => {
  if (data.length < 2) return '';
  const range = max - min || 1;
  return data
    .map((v, i) => {
      const x = PAD_LEFT + (i / (data.length - 1)) * plotW;
      const y = PAD_TOP + plotH - ((v - min) / range) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
};

/**
 * SVG Path "area fill" (polyline altında dolgu için)
 */
const buildAreaPath = (
  data: number[],
  max: number,
  min: number,
  plotW: number,
  plotH: number,
): string => {
  if (data.length < 2) return '';
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = PAD_LEFT + (i / (data.length - 1)) * plotW;
    const y = PAD_TOP + plotH - ((v - min) / range) * plotH;
    return { x, y };
  });
  const first = pts[0];
  const last = pts[pts.length - 1];
  const bottom = PAD_TOP + plotH;
  let d = `M ${first.x.toFixed(1)} ${bottom.toFixed(1)}`;
  pts.forEach((p) => { d += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`; });
  d += ` L ${last.x.toFixed(1)} ${bottom.toFixed(1)} Z`;
  return d;
};

interface TrendChartProps {
  data: MonthlyTrendPoint[];
}

const TrendChart: React.FC<TrendChartProps> = ({ data }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  const plotW = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const { incomeValues, expenseValues, max, min } = useMemo(() => {
    const inc = data.map((d) => d.income / 100);      // kuruş → lira (görsel)
    const exp = data.map((d) => d.expense / 100);
    const all = [...inc, ...exp];
    const max = Math.max(...all, 1);
    const min = Math.min(...all, 0);
    return { incomeValues: inc, expenseValues: exp, max, min };
  }, [data]);

  if (data.length === 0) {
    return (
      <View style={[styles.emptyBox, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
          Henüz yeterli veri yok
        </Text>
      </View>
    );
  }

  const incomePoints = buildPolylinePoints(incomeValues, max, min, plotW, plotH);
  const expensePoints = buildPolylinePoints(expenseValues, max, min, plotW, plotH);
  const incomeArea = buildAreaPath(incomeValues, max, min, plotW, plotH);
  const expenseArea = buildAreaPath(expenseValues, max, min, plotW, plotH);

  // Son nokta koordinatları (tooltip referansı)
  const lastInX = PAD_LEFT + plotW;
  const lastInY = PAD_TOP + plotH - ((incomeValues[incomeValues.length - 1] - min) / (max - min || 1)) * plotH;
  const lastExX = PAD_LEFT + plotW;
  const lastExY = PAD_TOP + plotH - ((expenseValues[expenseValues.length - 1] - min) / (max - min || 1)) * plotH;

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
          6 Aylık Gelir / Gider Trendi
        </Text>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.success }]} />
            <Text style={[styles.legendLabel, { color: theme.colors.textSecondary }]}>Gelir</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.danger }]} />
            <Text style={[styles.legendLabel, { color: theme.colors.textSecondary }]}>Gider</Text>
          </View>
        </View>
      </View>

      <Svg width={CHART_WIDTH} height={CHART_HEIGHT + PAD_BOTTOM}>
        <Defs>
          {/* Gelir gradient */}
          <LinearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.colors.success} stopOpacity={0.25} />
            <Stop offset="1" stopColor={theme.colors.success} stopOpacity={0} />
          </LinearGradient>
          {/* Gider gradient */}
          <LinearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.colors.danger} stopOpacity={0.2} />
            <Stop offset="1" stopColor={theme.colors.danger} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {/* Alan dolguları */}
        <Path d={incomeArea} fill="url(#incGrad)" />
        <Path d={expenseArea} fill="url(#expGrad)" />

        {/* Çizgiler */}
        <Polyline
          points={incomePoints}
          fill="none"
          stroke={theme.colors.success}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Polyline
          points={expensePoints}
          fill="none"
          stroke={theme.colors.danger}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Son nokta göstergeleri */}
        <Circle cx={lastInX} cy={lastInY} r={5} fill={theme.colors.surface} stroke={theme.colors.success} strokeWidth={2} />
        <Circle cx={lastExX} cy={lastExY} r={5} fill={theme.colors.surface} stroke={theme.colors.danger} strokeWidth={2} />

        {/* X eksen etiketleri */}
        {data.map((point, i) => {
          const x = PAD_LEFT + (i / (data.length - 1)) * plotW;
          return (
            <Text
              key={point.month}
              style={{
                position: 'absolute',
                left: x - 16,
                top: PAD_TOP + plotH + 8,
                fontSize: 9,
                color: theme.colors.textTertiary,
                width: 32,
                textAlign: 'center',
              }}
            >
              {formatMonthLabel(point.month)}
            </Text>
          );
        })}
      </Svg>

      {/* X eksen etiketleri — SVG dışında Text bileşenleri */}
      <View style={[styles.xAxis, { width: CHART_WIDTH }]}>
        {data.map((point, i) => {
          const leftPct = (i / (data.length - 1)) * 100;
          return (
            <Text
              key={point.month}
              style={[
                styles.xLabel,
                { color: theme.colors.textTertiary, left: `${leftPct}%` as any },
              ]}
            >
              {formatMonthLabel(point.month)}
            </Text>
          );
        })}
      </View>

      {/* Son ayın özet değerleri */}
      {data.length > 0 && (
        <View style={[styles.lastMonthRow, { borderTopColor: theme.colors.border }]}>
          <Text style={[styles.lastMonthTitle, { color: theme.colors.textTertiary }]}>
            Bu Ay
          </Text>
          <View style={styles.lastMonthStats}>
            <Text style={[styles.lastMonthIncome, { color: theme.colors.success }]}>
              +{formatCurrency(data[data.length - 1].income)}
            </Text>
            <Text style={[styles.lastMonthExpense, { color: theme.colors.danger }]}>
              -{formatCurrency(data[data.length - 1].expense)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 15, fontWeight: '700' },
  legend: { flexDirection: 'row', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontWeight: '500' },
  xAxis: { flexDirection: 'row', position: 'relative', height: 16, marginTop: -8 },
  xLabel: {
    position: 'absolute',
    fontSize: 9,
    fontWeight: '500',
    transform: [{ translateX: -16 }],
    width: 32,
    textAlign: 'center',
  },
  lastMonthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  lastMonthTitle: { fontSize: 12, fontWeight: '600' },
  lastMonthStats: { flexDirection: 'row', gap: 12 },
  lastMonthIncome: { fontSize: 13, fontWeight: '700' },
  lastMonthExpense: { fontSize: 13, fontWeight: '700' },
  emptyBox: {
    height: CHART_HEIGHT,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { fontSize: 14 },
});

export default TrendChart;
