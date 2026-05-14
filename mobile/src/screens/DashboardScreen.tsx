import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, StatusBar, Dimensions } from 'react-native';
import { useDashboardStore } from '../store/useDashboardStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTransactions } from '../api/transactionService';

export default function DashboardScreen() {
  const { summary, loading, fetchDashboard } = useDashboardStore();
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [chartData, setChartData] = useState<{ month: string; income: number; expense: number }[]>([]);
  const [isChartLoading, setIsChartLoading] = useState(false);

  const monthNames = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

  useEffect(() => {
    fetchDashboard();
    
    const fetchChartData = async () => {
      setIsChartLoading(true);
      try {
        const result = await getTransactions({}); // Fetch all transactions
        
        const monthsMap: Record<string, { month: string; income: number; expense: number }> = {};
        
        result.transactions.forEach((t: any) => {
          const d = new Date(t.transactionDate || t.createdAt);
          const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          
          if (!monthsMap[mStr]) {
            monthsMap[mStr] = { month: `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`, income: 0, expense: 0 };
          }
          
          if (t.type === 'GELİR' || t.type === 'INCOME') {
            monthsMap[mStr].income += (t.amount || 0) / 100;
          } else if (t.type === 'GİDER' || t.type === 'EXPENSE') {
            monthsMap[mStr].expense += (t.amount || 0) / 100;
          }
        });

        // Sort months ascending
        const sortedKeys = Object.keys(monthsMap).sort();
        const sortedData = sortedKeys.map(key => monthsMap[key]);
        setChartData(sortedData);
      } catch (error) {
        console.error('[DashboardScreen] chart fetch error:', error);
      } finally {
        setIsChartLoading(false);
      }
    };

    fetchChartData();
  }, []);

  const maxVal = Math.max(...chartData.flatMap(d => [d.income, d.expense]), 10000);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.accent} /></View>;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.primary, paddingTop: insets.top }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Dashboard</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
        {/* Monthly Summary Card */}
        <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Aylık Özet</Text>
          <View style={styles.divider} />
          
          <View style={styles.summaryRow}>
            <View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>Kasa Bakiyesi</Text>
              <Text style={[styles.amount, { color: theme.colors.accent }]}>
                {summary?.balance ? (summary.balance / 100).toLocaleString('tr-TR') : '0'} ₺
              </Text>
            </View>
            <View style={[styles.iconCircle, { backgroundColor: theme.colors.accentTransparent }]}>
              <Icon name="credit-card" size={24} color={theme.colors.accent} />
            </View>
          </View>

          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Toplam Gelir</Text>
              <Text style={[styles.gridAmount, { color: '#4caf50' }]}>
                {summary?.totalIncome ? (summary.totalIncome / 100).toLocaleString('tr-TR') : '0'} ₺
              </Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Toplam Gider</Text>
              <Text style={[styles.gridAmount, { color: '#ff5252' }]}>
                {summary?.totalExpense ? (summary.totalExpense / 100).toLocaleString('tr-TR') : '0'} ₺
              </Text>
            </View>
          </View>
        </View>

        {/* Column Chart */}
        <View style={[styles.chartCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Gelir / Gider Karşılaştırması</Text>
          <View style={styles.divider} />
          
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={[styles.chartContainer, { gap: 16, paddingHorizontal: 10 }]}>
              {chartData.map((data, index) => {
                const incomeHeight = (data.income / maxVal) * 120;
                const expenseHeight = (data.expense / maxVal) * 120;

                return (
                  <View key={index} style={styles.chartColumn}>
                    <View style={styles.barGroup}>
                      <View style={[styles.bar, { height: incomeHeight, backgroundColor: '#4caf50' }]} />
                      <View style={[styles.bar, { height: expenseHeight, backgroundColor: '#ff5252' }]} />
                    </View>
                    <Text style={[styles.monthText, { color: theme.colors.textSecondary }]}>{data.month}</Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
          
          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#4caf50' }]} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Gelir</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#ff5252' }]} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Gider</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  container: { flex: 1, padding: 16 },
  summaryCard: { padding: 20, borderRadius: 16, marginBottom: 16 },
  chartCard: { padding: 20, borderRadius: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.05)', marginBottom: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  amount: { fontSize: 24, fontWeight: 'bold', marginTop: 4 },
  iconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', gap: 16 },
  gridItem: { flex: 1 },
  gridAmount: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  chartContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 160, paddingBottom: 20 },
  chartColumn: { alignItems: 'center' },
  barGroup: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 120 },
  bar: { width: 12, borderRadius: 4 },
  monthText: { fontSize: 12, marginTop: 8 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendColor: { width: 12, height: 12, borderRadius: 3 },
});

