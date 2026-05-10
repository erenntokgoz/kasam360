import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { Transaction } from '../api/transactionService';
import { getAuditLogs, AuditLog } from '../api/auditLogService';
import { formatCurrency, formatDate } from '../utils/format';

import { useTranslation } from 'react-i18next';

const AnalyticsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const { t } = useTranslation();
  const { transactions, isLoading, fetchTransactions, pagination } = useLedgerStore();
  const totalTransactions = pagination?.total || 0;
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    fetchTransactions(1, 50);
    getAuditLogs().then(setAuditLogs).catch(() => {});
  }, []);

  const onRefresh = () => {
    fetchTransactions(1, 50);
    getAuditLogs().then(setAuditLogs).catch(() => {});
  };

  const combinedData = [
    ...transactions.map((t) => ({ ...t, _type: 'transaction' as const })),
    ...auditLogs.map((a) => ({ ...a, _type: 'audit' as const })),
  ];

  const renderItem = ({ item }: { item: any }) => {
    if (item._type === 'audit') {
      return (
        <View style={[styles.row, { backgroundColor: theme.colors.accentTransparent }]}>
          <View style={[styles.iconContainer, { backgroundColor: theme.colors.accentTransparent }]}>
            <Icon name="activity" size={20} color={theme.colors.accent} />
          </View>
          <View style={styles.rowCenter}>
            <Text style={[styles.categoryText, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              {item.action} · {item.entityType}
            </Text>
            <Text style={[styles.dateText, { color: theme.colors.textTertiary }]}>
              {formatDate(item.createdAt)}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.amountText, { color: theme.colors.accent }]}>Audit</Text>
          </View>
        </View>
      );
    }

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
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base, borderBottomColor: theme.colors.border }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Sistem Kayıtları</Text>
        <View style={{ width: 24 }} />
      </View>
      <FlatList
        data={combinedData}
        keyExtractor={(item) => item._id}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: 100 }]}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.colors.accent }]} />}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  listContent: { paddingHorizontal: 24, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 24 },
  separator: { height: 1, marginVertical: 8 },
  iconContainer: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowCenter: { flex: 1, justifyContent: 'center' },
  categoryText: { fontSize: 15, marginBottom: 4 },
  dateText: { fontSize: 11 },
  rowRight: { alignItems: 'flex-end', justifyContent: 'center', marginLeft: 8 },
  amountText: { fontSize: 15 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 18, marginBottom: 4 },
  emptySubtitle: { fontSize: 13, textAlign: 'center' },
  footerContainer: { alignItems: 'center', paddingVertical: 24 },
  footerText: { fontSize: 13 },
});

export default AnalyticsScreen;
