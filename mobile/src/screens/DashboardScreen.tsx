import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useDashboardStore } from '../store/useDashboardStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';

export default function DashboardScreen() {
  const { summary, loading, fetchDashboard } = useDashboardStore();
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);

  useEffect(() => { fetchDashboard(); }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.accent} /></View>;

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.primary }]}>
      <Text style={[styles.header, { color: theme.colors.text }]}>Finansal Özet</Text>
      <View style={styles.cardContainer}>
        <View style={[styles.card, { backgroundColor: theme.colors.card }]}>
          <Text style={{ color: theme.colors.textMuted }}>Kasa Bakiyesi</Text>
          <Text style={[styles.amount, { color: theme.colors.accent }]}>
            {summary?.balance ? (summary.balance / 100).toLocaleString('tr-TR') : '0'} ₺
          </Text>
        </View>
        <View style={[styles.card, { backgroundColor: theme.colors.card }]}>
          <Text style={{ color: theme.colors.textMuted }}>Toplam Gelir</Text>
          <Text style={[styles.amount, { color: '#4caf50' }]}>
            {summary?.totalIncome ? (summary.totalIncome / 100).toLocaleString('tr-TR') : '0'} ₺
          </Text>
        </View>
        <View style={[styles.card, { backgroundColor: theme.colors.card }]}>
          <Text style={{ color: theme.colors.textMuted }}>Toplam Gider</Text>
          <Text style={[styles.amount, { color: '#ff5252' }]}>
            {summary?.totalExpense ? (summary.totalExpense / 100).toLocaleString('tr-TR') : '0'} ₺
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, padding: 16 },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, marginTop: 10 },
  cardContainer: { gap: 16 },
  card: { padding: 20, borderRadius: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  amount: { fontSize: 28, fontWeight: 'bold', marginTop: 8 }
});
