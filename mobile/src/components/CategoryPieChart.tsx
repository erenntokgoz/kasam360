import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { G, Path, Circle, Text as SvgText } from 'react-native-svg';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { formatCurrency } from '../utils/format';
import type { CategoryBreakdown } from '../api/dashboardService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PIE_SIZE = Math.min(SCREEN_WIDTH * 0.45, 180);
const RADIUS = PIE_SIZE / 2 - 8;
const INNER_RADIUS = RADIUS * 0.55;   // Donut iç boşluk
const CX = PIE_SIZE / 2;
const CY = PIE_SIZE / 2;

/**
 * Sabit kategori renk paleti — en fazla 10 kategori.
 * Kategorilere deterministik renk atar (index tabanlı).
 */
const PALETTE = [
  '#6366F1',   // indigo   — Personel
  '#F43F5E',   // rose     — Kira/Fatura
  '#F59E0B',   // amber    — Mutfak
  '#10B981',   // emerald  — Kargo
  '#3B82F6',   // blue     — Pazarlama
  '#8B5CF6',   // violet   — Diğer
  '#EC4899',   // pink
  '#14B8A6',   // teal
  '#F97316',   // orange
  '#6B7280',   // gray
];

const getColor = (index: number) => PALETTE[index % PALETTE.length];

/**
 * Tek bir dilim için SVG arc Path'i üretir.
 * startAngle ve endAngle — radyan cinsinden.
 */
const describeArc = (
  cx: number,
  cy: number,
  r: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string => {
  const clamp = Math.min(endAngle - startAngle, Math.PI * 2 - 0.001);
  const end = startAngle + clamp;

  const cosS = Math.cos(startAngle);
  const sinS = Math.sin(startAngle);
  const cosE = Math.cos(end);
  const sinE = Math.sin(end);

  const x1 = cx + r * cosS;
  const y1 = cy + r * sinS;
  const x2 = cx + r * cosE;
  const y2 = cy + r * sinE;
  const x3 = cx + innerR * cosE;
  const y3 = cy + innerR * sinE;
  const x4 = cx + innerR * cosS;
  const y4 = cy + innerR * sinS;

  const largeArcFlag = clamp > Math.PI ? 1 : 0;

  return [
    `M ${x1.toFixed(3)} ${y1.toFixed(3)}`,
    `A ${r} ${r} 0 ${largeArcFlag} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`,
    `L ${x3.toFixed(3)} ${y3.toFixed(3)}`,
    `A ${innerR} ${innerR} 0 ${largeArcFlag} 0 ${x4.toFixed(3)} ${y4.toFixed(3)}`,
    'Z',
  ].join(' ');
};

interface CategoryPieChartProps {
  data: CategoryBreakdown[];
}

const CategoryPieChart: React.FC<CategoryPieChartProps> = ({ data }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  // En fazla 8 kategori göster, gerisini "Diğer" altında topla
  const normalized = useMemo(() => {
    if (data.length === 0) return [];
    const sorted = [...data].sort((a, b) => b.total - a.total);
    if (sorted.length <= 8) return sorted;
    const top7 = sorted.slice(0, 7);
    const rest = sorted.slice(7);
    const restTotal = rest.reduce((s, c) => s + c.total, 0);
    const restCount = rest.reduce((s, c) => s + c.count, 0);
    const grandTotal = sorted.reduce((s, c) => s + c.total, 0);
    top7.push({
      category: 'Diğer',
      total: restTotal,
      count: restCount,
      percentage: grandTotal > 0 ? (restTotal / grandTotal) * 100 : 0,
    });
    return top7;
  }, [data]);

  const slices = useMemo(() => {
    let start = -Math.PI / 2; // 12 o'clock
    return normalized.map((item, i) => {
      const angle = (item.percentage / 100) * 2 * Math.PI;
      const path = describeArc(CX, CY, RADIUS, INNER_RADIUS, start, start + angle);
      const midAngle = start + angle / 2;
      start += angle;
      return {
        ...item,
        path,
        color: getColor(i),
        midAngle,
      };
    });
  }, [normalized]);

  if (data.length === 0) {
    return (
      <View style={[styles.emptyBox, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
        <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
          Bu ay henüz gider kaydı yok
        </Text>
      </View>
    );
  }

  const topCategory = normalized[0];

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
        Gider Dağılımı — Bu Ay
      </Text>

      <View style={styles.body}>
        {/* Donut Grafik */}
        <View style={styles.pieWrap}>
          <Svg width={PIE_SIZE} height={PIE_SIZE}>
            {slices.map((slice, i) => (
              <Path
                key={`${slice.category}-${i}`}
                d={slice.path}
                fill={slice.color}
                stroke={theme.colors.surface}
                strokeWidth={2}
              />
            ))}
            {/* Orta etiket */}
            <SvgText
              x={CX}
              y={CY - 6}
              textAnchor="middle"
              fontSize={11}
              fontWeight="600"
              fill={theme.colors.textTertiary}
            >
              {topCategory?.category?.length > 10
                ? topCategory?.category?.slice(0, 9) + '…'
                : topCategory?.category}
            </SvgText>
            <SvgText
              x={CX}
              y={CY + 12}
              textAnchor="middle"
              fontSize={14}
              fontWeight="800"
              fill={theme.colors.textPrimary}
            >
              {topCategory ? `%${topCategory.percentage.toFixed(0)}` : ''}
            </SvgText>
          </Svg>
        </View>

        {/* Lejant Listesi */}
        <View style={styles.legend}>
          {slices.map((slice, i) => (
            <View key={`leg-${i}`} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: slice.color }]} />
              <View style={styles.legendTextGroup}>
                <Text
                  style={[styles.legendCategory, { color: theme.colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {slice.category}
                </Text>
                <Text style={[styles.legendPct, { color: theme.colors.textTertiary }]}>
                  %{slice.percentage.toFixed(1)}
                </Text>
              </View>
              <Text style={[styles.legendAmount, { color: theme.colors.textSecondary }]}>
                {formatCurrency(slice.total)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20 },
  title: { fontSize: 15, fontWeight: '700', marginBottom: 16 },
  body: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  pieWrap: { alignItems: 'center', justifyContent: 'center' },
  legend: { flex: 1, gap: 10 },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  legendTextGroup: { flex: 1 },
  legendCategory: { fontSize: 12, fontWeight: '600' },
  legendPct: { fontSize: 10, fontWeight: '500' },
  legendAmount: { fontSize: 11, fontWeight: '600', flexShrink: 0 },
  emptyBox: {
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    height: 140,
  },
  emptyText: { fontSize: 14 },
});

export default CategoryPieChart;
