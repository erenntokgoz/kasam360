import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { Transaction } from '../api/transactionService';
import { formatCurrency, formatDate } from '../utils/format';

const AnalyticsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const { transactions, isLoading, fetchTransactions, pagination } = useLedgerStore();
  const totalTransactions = pagination?.total || 0;

  useEffect(() => {
    fetchTransactions(1, 50);
  }, []);

  const onRefresh = () => {
    fetchTransactions(1, 50);
  };

  const renderItem = ({ item }: { item: Transaction }) => {
    const isIncome = item.type === 'INCOME';
    const amountStr = formatCurrency(isIncome ? item.amount : -item.amount, true);

    return (
      <View style={[styles.row, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.iconContainer}>
          <Icon
            name={isIncome ? 'arrow-down-left' : 'arrow-up-right'}
            size={20}
            color={isIncome ? theme.colors.successLight : theme.colors.dangerLight}
          />
        </View>
        <View style={styles.rowCenter}>
          <Text style={[styles.categoryText, { color: theme.colors.textPrimary }]} numberOfLines={1}>
            {item.category || item.description || 'İşlem'}
          </Text>
          <Text style={[styles.dateText, { color: theme.colors.textTertiary }]}>
            {formatDate(item.transactionDate || item.createdAt)}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.amountText, { color: isIncome ? theme.colors.successLight : theme.colors.dangerLight }]}>
            {amountStr}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>Henüz işlem kaydı yok</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>İlk işleminizi eklemek için + butonuna basın</Text>
    </View>
  );

  const renderFooter = () => {
    if (transactions.length === 0) return null;
    return (
      <View style={styles.footerContainer}>
        <Text style={[styles.footerText, { color: theme.colors.textTertiary }]}>Toplam {totalTransactions} kayıt</Text>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Sistem Kayıtları</Text>
        <Pressable hitSlop={12}>
          <Icon name="filter" size={22} color={theme.colors.textPrimary} />
        </Pressable>
      </View>
      <FlatList
        data={transactions}
        keyExtractor={(item) => item._id}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: 100 }]}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12 },
  headerTitle: { fontFamily: 'System', fontSize: 18, letterSpacing: 0.4 },
  listContent: { paddingHorizontal: 24, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 24 },
  separator: { height: 1, marginVertical: 8 },
  iconContainer: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowCenter: { flex: 1, justifyContent: 'center' },
  categoryText: { fontFamily: 'System', fontSize: 15, marginBottom: 4 },
  dateText: { fontFamily: 'System', fontSize: 11 },
  rowRight: { alignItems: 'flex-end', justifyContent: 'center', marginLeft: 8 },
  amountText: { fontFamily: 'System', fontSize: 15 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontFamily: 'System', fontSize: 18, marginBottom: 4 },
  emptySubtitle: { fontFamily: 'System', fontSize: 13, textAlign: 'center' },
  footerContainer: { alignItems: 'center', paddingVertical: 24 },
  footerText: { fontFamily: 'System', fontSize: 13 },
});

export default AnalyticsScreen;
