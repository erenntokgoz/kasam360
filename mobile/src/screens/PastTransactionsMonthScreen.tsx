import React, { useState, useEffect, useMemo } from 'react';
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
import { getTransactions } from '../api/transactionService';

const monthNames = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

export const PastTransactionsMonthScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { category, categoryTitle } = route.params;
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);

  const [availableMonths, setAvailableMonths] = useState<{ id: string; title: string; year: number; month: number }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      setIsLoading(true);
      try {
        const result = await getTransactions(null, 200); // Fetch last 200 transactions
        const monthsMap: Record<string, { id: string; title: string; year: number; month: number }> = {};
        
        const now = new Date();
        const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        result.transactions.forEach((t) => {
          const d = new Date(t.transactionDate || t.createdAt);
          const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          
          // Only include months before the current month
          if (mStr < currentMonthStr) {
            monthsMap[mStr] = {
              id: mStr,
              title: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
              year: d.getFullYear(),
              month: d.getMonth() + 1,
            };
          }
        });

        const sortedMonths = Object.values(monthsMap).sort((a, b) => b.id.localeCompare(a.id));
        setAvailableMonths(sortedMonths);
      } catch (error) {
        console.error('[PastTransactionsMonthScreen] fetch error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetch();
  }, []);

  const renderItem = ({ item }: { item: typeof availableMonths[0] }) => (
    <Pressable
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
      onPress={() => navigation.navigate('PastTransactionsDetail', { category, month: item.id, monthTitle: item.title })}
    >
      <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
        {item.title}
      </Text>
      <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primary, paddingTop: insets.top }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>{categoryTitle}</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          data={availableMonths}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
              Görüntülemek istediğiniz ayı seçiniz
            </Text>
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 16 }}>Bu kategori için geçmiş veri bulunamadı.</Text>
            </View>
          }
        />
      )}
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
  subtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PastTransactionsMonthScreen;
