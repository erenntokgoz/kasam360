import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import type { Transaction } from '../api/transactionService';
import { formatCurrency, formatDate } from '../utils/format';
import TransactionDetailModal from '../components/TransactionDetailModal';

const TransactionRow: React.FC<{ item: Transaction; onPress: (t: Transaction) => void }> = React.memo(({ item, onPress }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const isIncome = item.type === 'INCOME';
  const iconName = isIncome ? 'arrow-down-left' : 'arrow-up-right';
  const amountColor = isIncome ? theme.colors.success : theme.colors.danger;
  const displayAmount = isIncome ? item.amount : -item.amount;

  return (
    <Pressable style={styles.rowContainer} activeOpacity={0.7} onPress={() => onPress(item)}>
      <View style={[styles.rowIconCircle, { backgroundColor: isIncome ? theme.colors.successTransparent : theme.colors.dangerTransparent }]}>
        <Icon name={iconName} size={16} color={amountColor} />
      </View>
      <View style={styles.rowMiddle}>
        <Text style={[styles.rowCategory, { color: theme.colors.textPrimary }]} numberOfLines={1}>{item.category || (isIncome ? 'Gelir' : 'Gider')}</Text>
        <Text style={[styles.rowDate, { color: theme.colors.textTertiary }]}>{formatDate(item.transactionDate)}</Text>
      </View>
      <Text style={[styles.rowAmount, { color: amountColor }]}>{formatCurrency(displayAmount, true)}</Text>
    </Pressable>
  );
});

const TransactionsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { transactions, isLoading, fetchTransactions } = useLedgerStore();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  useEffect(() => { fetchTransactions(1).catch(() => { }); }, [fetchTransactions]);

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
        renderItem={({ item }) => <TransactionRow item={item} onPress={setSelectedTx} />}
        keyExtractor={(item) => item._id}
        ListEmptyComponent={!isLoading ? <Text style={styles.emptyText}>Henüz işlem yok</Text> : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        onRefresh={() => fetchTransactions(1)}
        refreshing={isLoading}
      />

      {selectedTx && (
        <TransactionDetailModal
          visible={!!selectedTx}
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  listContent: { paddingHorizontal: 20, paddingTop: 16 },
  rowContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  rowIconCircle: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1 },
  rowCategory: { fontSize: 16, fontWeight: '500' },
  rowDate: { fontSize: 12, marginTop: 2 },
  rowAmount: { fontSize: 16, fontWeight: '600' },
  emptyText: { textAlign: 'center', marginTop: 40, opacity: 0.5 }
});

export default TransactionsScreen;
