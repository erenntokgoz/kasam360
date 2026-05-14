import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useLedgerStore } from '../store/useLedgerStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';
import { formatCurrency, formatDate } from '../utils/format';
import type { Transaction } from '../api/transactionService';

export const PastTransactionsDetailScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { category, month, monthTitle } = route.params;
  const { transactions } = useLedgerStore();
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const d = new Date(t.transactionDate || t.createdAt);
      const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      
      const matchesMonth = mStr === month;
      const matchesCategory = category === 'all' || t.type === category || t.category === category;
      
      return matchesMonth && matchesCategory;
    });
  }, [transactions, category, month]);

  const renderItem = ({ item }: { item: Transaction }) => {
    const isIncome = item.type === 'INCOME';
    const amountColor = isIncome ? theme.colors.success : theme.colors.danger;
    const displayAmount = isIncome ? item.amount : -item.amount;

    return (
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.description, { color: theme.colors.textPrimary }]}>
            {item.description || item.category || (isIncome ? 'Gelir' : 'Gider')}
          </Text>
          <Text style={[styles.amount, { color: amountColor }]}>
            {formatCurrency(displayAmount, true)}
          </Text>
        </View>
        <View style={styles.cardFooter}>
          <Text style={[styles.date, { color: theme.colors.textTertiary }]}>
            {formatDate(item.transactionDate)}
          </Text>
          {item.category && (
            <View style={[styles.tag, { backgroundColor: theme.colors.accentTransparent }]}>
              <Text style={[styles.tagText, { color: theme.colors.accent }]}>
                {item.category}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primary, paddingTop: insets.top }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>{monthTitle}</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={filteredTransactions}
        keyExtractor={(item) => item._id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ color: theme.colors.textSecondary }}>Bu dönemde işlem bulunamadı.</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  description: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  date: {
    fontSize: 12,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 40,
  },
});

export default PastTransactionsDetailScreen;
