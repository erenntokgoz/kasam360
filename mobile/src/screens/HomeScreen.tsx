import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Alert, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { launchCamera } from 'react-native-image-picker';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { scanReceipt } from '../api/ocrService';
import type { Transaction } from '../api/transactionService';
import AddTransactionModal from '../components/AddTransactionModal';
import { formatCurrency, formatDate } from '../utils/format';

interface TransactionRowProps { item: Transaction; index: number; }

const TransactionRow: React.FC<TransactionRowProps> = React.memo(({ item }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const isIncome = item.type === 'INCOME';
  const iconName = isIncome ? 'arrow-down-left' : 'arrow-up-right';
  const amountColor = isIncome ? theme.colors.successLight : theme.colors.dangerLight;
  const displayAmount = isIncome ? item.amount : -item.amount;

  return (
    <Pressable
      style={styles.rowContainer}
      activeOpacity={0.7}
    >
      <View style={[styles.rowIconCircle, { backgroundColor: isIncome ? theme.colors.successTransparent : theme.colors.dangerTransparent }]}>
        <Icon name={iconName} size={16} color={amountColor} />
      </View>
      <View style={styles.rowMiddle}>
        <Text style={[styles.rowCategory, { color: theme.colors.textPrimary }]} numberOfLines={1}>{item.category || item.type}</Text>
        <Text style={[styles.rowDate, { color: theme.colors.textTertiary }]}>{formatDate(item.transactionDate)}</Text>
      </View>
      <Text style={[styles.rowAmount, { color: amountColor }]}>{formatCurrency(displayAmount, true)}</Text>
    </Pressable>
  );
});

interface SummaryProps { balance: number; totalIn: number; totalOut: number; }

const SummaryBar: React.FC<SummaryProps> = ({ balance, totalIn, totalOut }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  return (
    <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.summaryBalanceSection}>
        <Text style={[styles.summaryLabel, { color: theme.colors.textTertiary }]}>Balance</Text>
        <Text style={[styles.summaryBalance, { color: theme.colors.textPrimary }]}>{formatCurrency(balance)}</Text>
      </View>
      <View style={styles.summaryRow}>
        <View style={styles.summaryMetric}>
          <View style={styles.summaryDot}>
            <View style={[styles.dot, { backgroundColor: theme.colors.successLight }]} />
          </View>
          <View>
            <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Income</Text>
            <Text style={[styles.summaryMetricValue, { color: theme.colors.successLight }]}>{formatCurrency(totalIn)}</Text>
          </View>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: theme.colors.border }]} />
        <View style={styles.summaryMetric}>
          <View style={styles.summaryDot}>
            <View style={[styles.dot, { backgroundColor: theme.colors.dangerLight }]} />
          </View>
          <View>
            <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Expense</Text>
            <Text style={[styles.summaryMetricValue, { color: theme.colors.dangerLight }]}>{formatCurrency(totalOut)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const EmptyState: React.FC = () => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  return (
  <View style={styles.emptyContainer}>
    <Icon name="inbox" size={48} color={theme.colors.textTertiary} />
    <Text style={styles.emptyTitle}>No transactions yet</Text>
    <Text style={styles.emptySubtitle}>Tap the camera button below to scan your first receipt</Text>
  </View>
  );
};

const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [isScanning, setIsScanning] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const { transactions, totalIncome, totalExpense, balance, isLoading, fetchTransactions, addTransaction } = useLedgerStore();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  useEffect(() => { fetchTransactions(1).catch(() => { }); }, [fetchTransactions]);

  const handleScanReceipt = useCallback(async () => {
    try {
      const result = await launchCamera({ mediaType: 'photo', includeBase64: true, quality: 0.8, maxWidth: 1920, maxHeight: 1920 });
      if (result.didCancel || !result.assets?.[0]?.base64) return;
      setIsScanning(true);
      const base64 = result.assets[0].base64;
      const ocrResult = await scanReceipt(base64);
      if (!ocrResult.amount || ocrResult.amount === 0) {
        Alert.alert('No Amount Found', 'Could not detect a monetary value on this receipt.');
        setIsScanning(false);
        return;
      }
      Alert.alert('Receipt Scanned', `Amount: ₺${ocrResult.amountDisplay.toFixed(2)}${ocrResult.date ? `\nDate: ${new Date(ocrResult.date).toLocaleDateString('tr-TR')}` : ''}`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add as Expense', onPress: async () => { await addTransaction({ type: 'EXPENSE', amount: ocrResult.amount, method: 'CASH', category: 'Receipt Scan', description: 'Scanned via camera', transactionDate: ocrResult.date || undefined }); } },
        { text: 'Add as Income', onPress: async () => { await addTransaction({ type: 'INCOME', amount: ocrResult.amount, method: 'CASH', category: 'Receipt Scan', description: 'Scanned via camera', transactionDate: ocrResult.date || undefined }); } },
      ]);
    } catch (err) { Alert.alert('Scan Error', err instanceof Error ? err.message : 'Failed to scan receipt.'); }
    finally { setIsScanning(false); }
  }, [addTransaction]);

  const renderItem = useCallback(({ item, index }: { item: Transaction; index: number }) => <TransactionRow item={item} index={index} />, []);
  const keyExtractor = useCallback((item: Transaction) => item._id, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.colors.primary} />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Ledger</Text>
        <Pressable hitSlop={12} onPress={() => setShowAddModal(true)}>
          <Icon name="plus-circle" size={22} color={theme.colors.accent} />
        </Pressable>
      </View>
      <FlatList
        data={transactions}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={<SummaryBar balance={balance} totalIn={totalIncome} totalOut={totalExpense} />}
        ListEmptyComponent={!isLoading ? <EmptyState /> : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.colors.accent }]} />}
        refreshing={isLoading}
        onRefresh={() => fetchTransactions(1)}
      />
      <Pressable style={[styles.fab, { bottom: insets.bottom + theme.spacing.xl, backgroundColor: theme.colors.accent }, isScanning && { opacity: 0.6 }]} onPress={handleScanReceipt} disabled={isScanning}>
        {isScanning ? <ActivityIndicator size="small" color={theme.colors.textPrimary} /> : <Icon name="camera" size={24} color={theme.colors.textPrimary} />}
      </Pressable>
      <AddTransactionModal
        visible={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          fetchTransactions(1).catch(() => { });
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontFamily: 'System', fontSize: 18, letterSpacing: 0.4 },
  listContent: { paddingHorizontal: 24, paddingTop: 8 },
  separator: { height: 1, marginLeft: 56 },
  summaryCard: { borderRadius: 16, padding: 24, marginBottom: 32 },
  summaryBalanceSection: { alignItems: 'center', marginBottom: 24 },
  summaryLabel: { fontFamily: 'System', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 },
  summaryBalance: { fontFamily: 'System', fontSize: 36, letterSpacing: -0.5 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  summaryMetric: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  summaryMetricLabel: { fontFamily: 'System', fontSize: 11, marginBottom: 1 },
  summaryMetricValue: { fontFamily: 'System', fontSize: 15 },
  summaryDivider: { width: 1, height: 32 },
  rowContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 4 },
  rowIconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1, marginRight: 8 },
  rowCategory: { fontFamily: 'System', fontSize: 15, marginBottom: 2 },
  rowDate: { fontFamily: 'System', fontSize: 11 },
  rowAmount: { fontFamily: 'System', fontSize: 15, letterSpacing: -0.3 },
  fab: { position: 'absolute', right: 32, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 8 },
  emptyTitle: { fontFamily: 'System', fontSize: 18, marginTop: 12 },
  emptySubtitle: { fontFamily: 'System', fontSize: 13, textAlign: 'center', maxWidth: 260 },
});

export default HomeScreen;