import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable } from 'react-native';
import { useLedgerStore } from '../store/useLedgerStore';
import { theme } from '../theme';
import { SafeIcon } from './SafeIcon';
import type { Transaction, TransactionType } from '../api/transactionService';

interface TransactionListProps {
  type: TransactionType;
}

const formatCurrency = (cents: number, signed = false): string => {
  const value = cents / 100;
  const abs = Math.abs(value);
  const prefix = signed && cents < 0 ? '−' : signed && cents > 0 ? '+' : '';
  return `${prefix}₺${abs.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
};

const TransactionRow: React.FC<{ item: Transaction }> = React.memo(({ item }) => {
  const isIncome = item.type === 'INCOME';
  const iconName = isIncome ? 'arrow-down-outline' : 'arrow-up-outline';
  const amountColor = isIncome ? theme.colors.success : theme.colors.danger;
  const displayAmount = isIncome ? item.amount : -item.amount;

  return (
    <View style={styles.rowContainer}>
      <View style={styles.rowIconCircle}>
        <SafeIcon name={iconName} size={18} color={amountColor} fallbackText={isIncome ? 'G' : 'H'} />
      </View>

      <View style={styles.rowMiddle}>
        <Text style={styles.rowCategory} numberOfLines={1}>
          {item.category || item.type}
        </Text>
        <Text style={styles.rowDate}>{formatDate(item.transactionDate)}</Text>
      </View>

      <Text style={[styles.rowAmount, { color: amountColor }]}>
        {formatCurrency(displayAmount, true)}
      </Text>
    </View>
  );
});

export const TransactionList: React.FC<TransactionListProps> = ({ type }) => {
  const { transactions, isLoading, fetchTransactions } = useLedgerStore();

  useEffect(() => {
    fetchTransactions(1, 20, type).catch(() => {});
  }, [fetchTransactions, type]);

  const filteredData = transactions.filter(t => t.type === type);

  const renderItem = useCallback(
    ({ item }: { item: Transaction }) => <TransactionRow item={item} />,
    []
  );

  if (isLoading && filteredData.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <FlatList
      data={filteredData}
      renderItem={renderItem}
      keyExtractor={(item) => item._id}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      onRefresh={() => fetchTransactions(1, 20, type)}
      refreshing={isLoading}
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>KAYIT BULUNAMADI</Text>
        </View>
      }
    />
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: 100,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowIconCircle: {
    marginRight: theme.spacing.md,
  },
  rowMiddle: {
    flex: 1,
    marginRight: theme.spacing.md,
  },
  rowCategory: {
    fontSize: theme.fontSizes.base,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    color: theme.colors.textPrimary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  rowDate: {
    fontSize: theme.fontSizes.xs,
    fontFamily: theme.fonts.light,
    fontWeight: '300',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  rowAmount: {
    fontSize: theme.fontSizes.lg,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    letterSpacing: -1,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyText: {
    color: theme.colors.textTertiary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
});
