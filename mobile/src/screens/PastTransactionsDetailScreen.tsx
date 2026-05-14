import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';
import { EmptyState } from '../components/EmptyState';
import { formatCurrency, formatDate } from '../utils/format';
import type { Transaction } from '../api/transactionService';
import { getTransactions } from '../api/transactionService';

export const PastTransactionsDetailScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { category, month, monthTitle } = route.params;
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);

  const [localTransactions, setLocalTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      setIsLoading(true);
      try {
        const [year, monthNum] = month.split('-').map(Number);
        const startDate = new Date(year, monthNum - 1, 1).toISOString();
        const endDate = new Date(year, monthNum, 0, 23, 59, 59).toISOString();
        
        const result = await getTransactions(null, 100, { startDate, endDate });
        setLocalTransactions(result.transactions);
      } catch (error) {
        console.error('[PastTransactionsDetailScreen] fetch error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetch();
  }, [month]);

  const filteredTransactions = useMemo(() => {
    return localTransactions.filter((t) => {
      const matchesCategory = category === 'all' || t.type === category || t.category === category;
      return matchesCategory;
    });
  }, [localTransactions, category]);


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
          <EmptyState
            title="İşlem Bulunamadı"
            message="Bu dönemde seçtiğiniz kriterlere uygun işlem kaydı bulunmuyor."
            icon={<Icon name="inbox" size={48} color={theme.colors.textTertiary} />}
          />
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
