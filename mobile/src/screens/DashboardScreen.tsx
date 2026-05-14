import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { getDashboardData, type DashboardData } from '../api/dashboardService';
import SummaryCards from '../components/SummaryCards';
import TrendChart from '../components/TrendChart';
import CategoryPieChart from '../components/CategoryPieChart';
import { Skeleton } from '../components/Skeleton';

// ─── Hata Durumu ──────────────────────────────────────────────────────────────
const ErrorView: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  return (
    <View style={[styles.centeredFlex, { backgroundColor: theme.colors.primary }]}>
      <Icon name="alert-circle" size={40} color={theme.colors.danger} />
      <Text style={[styles.errorTitle, { color: theme.colors.textPrimary }]}>
        Veri yüklenemedi
      </Text>
      <Text style={[styles.errorBody, { color: theme.colors.textSecondary }]}>{message}</Text>
      <Pressable
        style={[styles.retryBtn, { backgroundColor: theme.colors.accent }]}
        onPress={onRetry}
      >
        <Icon name="refresh-cw" size={16} color="#fff" />
        <Text style={styles.retryBtnText}>Tekrar Dene</Text>
      </Pressable>
    </View>
  );
};

// ─── İskelet Yükleme ──────────────────────────────────────────────────────────
// Using imported Skeleton component instead of local SkeletonBlock

// ─── Bölüm Başlığı ───────────────────────────────────────────────────────────
const SectionHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>{title}</Text>
      {subtitle && (
        <Text style={[styles.sectionSubtitle, { color: theme.colors.textTertiary }]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
};

// ─── Ana Ekran ────────────────────────────────────────────────────────────────
const DashboardScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const result = await getDashboardData();
      setData(result);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Analitik veriler alınamadı.';
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    load(true);
  }, [load]);

  // ── Yükleniyor ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent
        />
        <View style={[styles.header, { paddingHorizontal: 24, borderBottomColor: theme.colors.border }]}>
          <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
            <Icon name="menu" size={24} color={theme.colors.textPrimary} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Dashboard</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          <Skeleton height={120} borderRadius={20} style={{ marginBottom: 16 }} />
          <Skeleton height={80} borderRadius={16} style={{ marginBottom: 16 }} />
          <Skeleton height={220} borderRadius={20} style={{ marginBottom: 16 }} />
          <Skeleton height={200} borderRadius={20} style={{ marginBottom: 16 }} />
        </ScrollView>
      </View>
    );
  }

  // ── Hata ────────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent
        />
        <ErrorView message={error ?? 'Beklenmeyen hata'} onRetry={() => load()} />
      </View>
    );
  }

  // ── Başarılı Veri ──────────────────────────────────────────────────────────
  const generatedTime = new Date(data.generatedAt).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingHorizontal: 24, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.primary },
        ]}
      >
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Dashboard</Text>
          <Text style={[styles.headerSubtitle, { color: theme.colors.textTertiary }]}>
            {generatedTime}
          </Text>
        </View>
        <Pressable hitSlop={12} onPress={handleRefresh}>
          {isRefreshing ? (
            <ActivityIndicator size="small" color={theme.colors.accent} />
          ) : (
            <Icon name="refresh-cw" size={20} color={theme.colors.textSecondary} />
          )}
        </Pressable>
      </View>

      {/* İçerik */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
      >
        {/* ── 1. Özet Kartları ─────────────────────────────────────────── */}
        <SectionHeader
          title="Bu Ay Özeti"
          subtitle={`${new Date(data.period.currentMonthStart).toLocaleString('tr-TR', { month: 'long', year: 'numeric' })}`}
        />
        <SummaryCards
          currentMonth={data.currentMonth}
          change={data.changeFromPrevMonth}
          overall={data.overallSummary}
        />

        {/* ── 2. Trend Grafiği ──────────────────────────────────────────── */}
        <SectionHeader
          title="Gelir & Gider Trendi"
          subtitle="Son 6 ay"
        />
        <TrendChart data={data.monthlyTrend} />

        {/* ── 3. Kategori Pasta Grafik ──────────────────────────────────── */}
        <SectionHeader
          title="Harcama Kategorileri"
          subtitle="Bu ayki gider dağılımı"
        />
        <CategoryPieChart data={data.categoryBreakdown} />

        {/* ── 4. Hızlı Özet Tablosu ────────────────────────────────────── */}
        {data.categoryBreakdown.length > 0 && (
          <View style={[styles.tableCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
            <Text style={[styles.tableTitle, { color: theme.colors.textPrimary }]}>
              Kategori Detayları
            </Text>
            {data.categoryBreakdown.map((item, i) => (
              <View
                key={`row-${i}`}
                style={[
                  styles.tableRow,
                  i < data.categoryBreakdown.length - 1 && {
                    borderBottomColor: theme.colors.border,
                    borderBottomWidth: 1,
                  },
                ]}
              >
                <View style={styles.tableRowLeft}>
                  <View
                    style={[
                      styles.tableDot,
                      {
                        backgroundColor:
                          ['#6366F1','#F43F5E','#F59E0B','#10B981','#3B82F6','#8B5CF6','#EC4899','#14B8A6'][i % 8],
                      },
                    ]}
                  />
                  <Text style={[styles.tableCategory, { color: theme.colors.textPrimary }]}>
                    {item.category}
                  </Text>
                </View>
                <View style={styles.tableRowRight}>
                  <Text style={[styles.tableAmount, { color: theme.colors.textSecondary }]}>
                    {new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(
                      item.total / 100,
                    )}
                  </Text>
                  <View
                    style={[
                      styles.tablePctBadge,
                      { backgroundColor: theme.colors.accentTransparent },
                    ]}
                  >
                    <Text style={[styles.tablePct, { color: theme.colors.accent }]}>
                      %{item.percentage.toFixed(1)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

// ─── Stiller ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSubtitle: { fontSize: 10, marginTop: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, gap: 0 },
  centeredFlex: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorTitle: { fontSize: 18, fontWeight: '700', marginTop: 8 },
  errorBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sectionHeader: { marginBottom: 12, marginTop: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  sectionSubtitle: { fontSize: 12, marginTop: 2 },
  tableCard: { borderRadius: 20, padding: 20, marginTop: 20 },
  tableTitle: { fontSize: 15, fontWeight: '700', marginBottom: 16 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  tableRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  tableDot: { width: 10, height: 10, borderRadius: 5 },
  tableCategory: { fontSize: 13, fontWeight: '600', flex: 1 },
  tableRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tableAmount: { fontSize: 12, fontWeight: '500' },
  tablePctBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  tablePct: { fontSize: 11, fontWeight: '700' },
});

export default DashboardScreen;
