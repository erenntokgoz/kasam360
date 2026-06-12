import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Alert, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import type { Transaction } from '../api/transactionService';
import { formatCurrency, formatDate } from '../utils/format';
import TransactionDetailModal from '../components/TransactionDetailModal';
import AddTransactionModal from '../components/AddTransactionModal';
import FilterBar from '../components/FilterBar';
import AddCard from '../components/AddCard';
import { EmptyState } from '../components/EmptyState';
import { SwipeRow } from '../components/SwipeRow';
import { useToastStore } from '../store/useToastStore';

const TransactionRow: React.FC<{ item: Transaction; onPress: (t: Transaction) => void }> = React.memo(({ item, onPress }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const isIncome = item.type === 'INCOME';
  const iconName = isIncome ? 'arrow-down-left' : 'arrow-up-right';
  const amountColor = isIncome ? theme.colors.success : theme.colors.danger;
  const displayAmount = isIncome ? item.amount : -item.amount;

  return (
    <Pressable style={styles.rowContainer} onPress={() => onPress(item)}>
      <View style={[styles.rowIconCircle, { backgroundColor: isIncome ? theme.colors.successTransparent : theme.colors.dangerTransparent }]}>
        <Icon name={iconName} size={16} color={amountColor} />
      </View>
      <View style={styles.rowMiddle}>
        <Text style={[styles.rowCategory, { color: theme.colors.textPrimary }]} numberOfLines={1}>{item.description || item.category || (isIncome ? 'Gelir' : 'Gider')}</Text>
        <Text style={[styles.rowDate, { color: theme.colors.textTertiary }]}>{formatDate(item.transactionDate)}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, { color: amountColor }]}>{formatCurrency(displayAmount, true)}</Text>
        {item.balanceAfter !== undefined && (
          <Text style={[styles.rowBalanceAfter, { color: theme.colors.textTertiary }]}>
            Kalan: {formatCurrency(item.balanceAfter)}
          </Text>
        )}
      </View>
    </Pressable>
  );
});

const TransactionsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { transactions, isLoading, fetchTransactions, loadMoreTransactions, totalIncome, totalExpense, deleteTransaction } = useLedgerStore();
  const { showToast } = useToastStore();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | undefined>(undefined);
  
  const [dateFilter, setDateFilter] = useState<{start: Date | null, end: Date | null}>({ start: null, end: null });
  const [contactFilter, setContactFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTransactions(null, 20, {
        type: typeFilter,
        search: contactFilter || undefined,
        startDate: dateFilter.start ? dateFilter.start.toISOString() : undefined,
        endDate: dateFilter.end ? dateFilter.end.toISOString() : undefined,
      }).catch(() => {});
    }, 400); // 400ms debounce
    return () => clearTimeout(timer);
  }, [contactFilter, dateFilter, typeFilter, fetchTransactions]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Gelir & Giderler</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={transactions}
        renderItem={({ item }) => (
          <SwipeRow onDelete={() => {
            Alert.alert('İşlemi Sil', 'Bu işlemi silmek istediğinize emin misiniz?', [
              { text: 'İptal', style: 'cancel' },
              { text: 'Sil', style: 'destructive', onPress: async () => {
                try {
                  await deleteTransaction(item._id);
                  showToast('İşlem başarıyla silindi.', 'success');
                } catch (err) {
                  showToast('İşlem silinemedi.', 'danger');
                }
              }}
            ]);
          }}>
            <TransactionRow item={item} onPress={setSelectedTx} />
          </SwipeRow>
        )}
        keyExtractor={(item) => item._id}
        ListHeaderComponent={(
          <View style={{ marginBottom: 16 }}>
             <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Toplam Gelir</Text>
                  <Text style={[styles.summaryMetricValue, { color: theme.colors.success }]}>{formatCurrency(totalIncome)}</Text>
                </View>
                <View style={[styles.summaryDivider, { backgroundColor: theme.colors.border }]} />
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Toplam Gider</Text>
                  <Text style={[styles.summaryMetricValue, { color: theme.colors.danger }]}>{formatCurrency(totalExpense)}</Text>
                </View>
              </View>
            </View>
            <View style={{ marginTop: 16 }}>
              <FilterBar 
                onDateChange={(start, end) => setDateFilter({ start, end })}
                onContactChange={setContactFilter}
                onTypeChange={setTypeFilter}
              />
            </View>
            <View style={{ marginTop: 16 }}>
              <AddCard 
                title="Yeni Gelir/Gider Ekle" 
                subtitle="Kasa giriş veya çıkış işlemi yapın" 
                icon="plus-circle" 
                onPress={() => { setEditTx(undefined); setShowAddModal(true); }} 
              />
            </View>
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              title="Kayıtlı İşlem Yok"
              message="Henüz bir gelir veya gider kaydı girmediniz. İlk işleminizi yukarıdan ekleyebilirsiniz."
              icon={<Icon name="file-text" size={40} color={theme.colors.accent} />}
            />
          ) : null
        }
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        onRefresh={() => fetchTransactions(null)}
        refreshing={isLoading}
        onEndReached={loadMoreTransactions}
        onEndReachedThreshold={0.3}
        ListFooterComponent={isLoading && transactions.length > 0 ? <ActivityIndicator size="small" color={theme.colors.accent} style={{ margin: 20 }} /> : null}
      />

      {selectedTx && (
        <TransactionDetailModal
          visible={!!selectedTx}
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
          onEdit={() => {
            setSelectedTx(null);
            setTimeout(() => {
              setEditTx(selectedTx);
              setShowAddModal(true);
            }, 300);
          }}
        />
      )}
      <AddTransactionModal 
        visible={showAddModal} 
        editTransaction={editTx}
        onClose={() => { setShowAddModal(false); setEditTx(undefined); fetchTransactions(null); }} 
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  listContent: { paddingHorizontal: 20, paddingTop: 16 },
  summaryCard: { borderRadius: 20, padding: 20 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryMetric: { flex: 1, alignItems: 'center' },
  summaryMetricLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  summaryMetricValue: { fontSize: 18, fontWeight: '700' },
  summaryDivider: { width: 1, height: 30, marginHorizontal: 10 },
  rowContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  rowIconCircle: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1 },
  rowCategory: { fontSize: 16, fontWeight: '500' },
  rowDate: { fontSize: 12, marginTop: 2 },
  rowAmount: { fontSize: 16, fontWeight: '600', textAlign: 'right' },
  rowRight: { alignItems: 'flex-end' },
  rowBalanceAfter: { fontSize: 10, marginTop: 2, fontWeight: '400' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 40 },
  emptyIconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});

export default TransactionsScreen;
