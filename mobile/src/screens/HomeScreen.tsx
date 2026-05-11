import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Alert, ActivityIndicator, Image } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { launchCamera } from 'react-native-image-picker';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { scanReceipt } from '../api/ocrService';
import type { Transaction } from '../api/transactionService';
import { useContactStore } from '../store/useContactStore';
import { useStaffStore } from '../store/useStaffStore';
import TransactionDetailModal from '../components/TransactionDetailModal';
import AddTransactionModal from '../components/AddTransactionModal';
import FilterBar from '../components/FilterBar';
import { formatCurrency, formatDate } from '../utils/format';

import AddCard from '../components/AddCard';
interface TransactionRowProps { item: Transaction; index: number; onPress: (t: Transaction) => void; }

const TransactionRow: React.FC<TransactionRowProps> = React.memo(({ item, onPress }) => {
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
        <Text style={[styles.rowCategory, { color: theme.colors.textPrimary }]} numberOfLines={1}>{item.category || (isIncome ? 'Gelir' : 'Gider')}</Text>
        <Text style={[styles.rowDate, { color: theme.colors.textTertiary }]}>{formatDate(item.transactionDate)}</Text>
      </View>
      <Text style={[styles.rowAmount, { color: amountColor }]}>{formatCurrency(displayAmount, true)}</Text>
    </Pressable>
  );
});

const SummaryBar: React.FC<{ 
  balance: number; 
  totalIn: number; 
  totalOut: number; 
  totalDebt: number; 
  totalReceivable: number; 
  onAdd: () => void 
}> = ({ balance, totalIn, totalOut, totalDebt, totalReceivable, onAdd }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card, marginBottom: 16 }]}>
        <View style={styles.summaryBalanceSection}>
          <Text style={[styles.summaryLabel, { color: theme.colors.textTertiary }]}>TOPLAM BAKİYE</Text>
          <Text style={[styles.summaryBalance, { color: theme.colors.textPrimary }]}>{formatCurrency(balance)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <View style={styles.summaryMetric}>
            <View style={[styles.dot, { backgroundColor: theme.colors.success }]} />
            <View>
              <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Gelir</Text>
              <Text style={[styles.summaryMetricValue, { color: theme.colors.success }]}>{formatCurrency(totalIn)}</Text>
            </View>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.summaryMetric}>
            <View style={[styles.dot, { backgroundColor: theme.colors.danger }]} />
            <View>
              <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Gider</Text>
              <Text style={[styles.summaryMetricValue, { color: theme.colors.danger }]}>{formatCurrency(totalOut)}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.summaryDividerH, { backgroundColor: theme.colors.border }]} />

        <View style={styles.summaryRow}>
          <View style={styles.summaryMetric}>
            <Icon name="arrow-down-left" size={12} color={theme.colors.successLight} style={{ marginRight: 6 }} />
            <View>
              <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Alacak</Text>
              <Text style={[styles.summaryMetricValue, { color: theme.colors.successLight, fontSize: 13 }]}>{formatCurrency(totalReceivable)}</Text>
            </View>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.summaryMetric}>
            <Icon name="arrow-up-right" size={12} color={theme.colors.dangerLight} style={{ marginRight: 6 }} />
            <View>
              <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Borç</Text>
              <Text style={[styles.summaryMetricValue, { color: theme.colors.dangerLight, fontSize: 13 }]}>{formatCurrency(totalDebt)}</Text>
            </View>
          </View>
        </View>
      </View>
      
      <AddCard 
        title="Yeni İşlem Ekle" 
        subtitle="Gelir, gider veya borç kaydı oluşturun" 
        icon="plus-circle" 
        onPress={onAdd} 
      />
    </View>
  );
};

import { useTranslation } from 'react-i18next';

const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const [isScanning, setIsScanning] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const { transactions, totalIncome, totalExpense, totalDebt, totalReceivable, balance, isLoading, fetchTransactions, addTransaction } = useLedgerStore();
  const fetchContacts = useContactStore(s => s.fetchContacts);
  const fetchStaff = useStaffStore(s => s.fetchStaff);
  
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  const [dateFilter, setDateFilter] = useState<{start: Date | null, end: Date | null}>({ start: null, end: null });
  const [contactFilter, setContactFilter] = useState<string | null>(null);

  useEffect(() => { 
    fetchTransactions(1).catch(() => { });
    fetchContacts();
    fetchStaff();
  }, [fetchTransactions, fetchContacts, fetchStaff]);

  const handleScanReceipt = useCallback(async () => {
    try {
      const result = await launchCamera({ mediaType: 'photo', includeBase64: true, quality: 0.8, maxWidth: 1920, maxHeight: 1920 });
      if (result.didCancel || !result.assets?.[0]?.base64) return;
      setIsScanning(true);
      const ocrResult = await scanReceipt(result.assets[0].base64);
      if (!ocrResult.amount) {
        Alert.alert('Hata', 'Fiş üzerinde tutar bulunamadı.');
        return;
      }
      Alert.alert('Fiş Tarandı', `Tutar: ₺${ocrResult.amountDisplay.toFixed(2)}`, [
        { text: 'İptal', style: 'cancel' },
        { text: 'Gider Ekle', onPress: () => addTransaction({ type: 'EXPENSE', amount: ocrResult.amount, method: 'CASH', category: 'Fiş Tarama', description: 'Kamera ile tarandı', transactionDate: ocrResult.date || undefined }) },
      ]);
    } catch (err) { Alert.alert('Hata', 'Fiş taranırken bir hata oluştu.'); }
    finally { setIsScanning(false); }
  }, [addTransaction]);

  const filteredTransactions = useMemo(() => transactions.filter(t => {
    if (contactFilter && !t.description?.toLowerCase().includes(contactFilter.toLowerCase()) && !t.category?.toLowerCase().includes(contactFilter.toLowerCase())) return false;
    if (dateFilter.start) {
      const d = new Date(t.transactionDate || t.createdAt);
      if (d < dateFilter.start) return false;
    }
    if (dateFilter.end) {
      const d = new Date(t.transactionDate || t.createdAt);
      if (d > dateFilter.end) return false;
    }
    return true;
  }), [transactions, contactFilter, dateFilter]);

  const displayTransactions = useMemo(() => filteredTransactions.slice(0, 20), [filteredTransactions]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base, borderBottomColor: theme.colors.border }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Image source={require('../assets/logo-text.png')} style={styles.headerLogo} resizeMode="contain" />
        <View style={{ width: 24 }} />
      </View>
      <FlatList
        data={displayTransactions}
        renderItem={({ item, index }) => <TransactionRow item={item} index={index} onPress={setSelectedTx} />}
        keyExtractor={(item) => item._id}
        ListHeaderComponent={(
          <View>
            <SummaryBar 
              balance={balance} 
              totalIn={totalIncome} 
              totalOut={totalExpense} 
              totalDebt={totalDebt}
              totalReceivable={totalReceivable}
              onAdd={() => setShowAddModal(true)} 
            />
            <FilterBar 
              onDateChange={(start, end) => setDateFilter({ start, end })}
              onContactChange={setContactFilter}
            />
          </View>
        )}
        ListEmptyComponent={!isLoading ? <Text style={styles.emptyText}>Henüz işlem yok</Text> : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        onRefresh={() => fetchTransactions(1)}
        refreshing={isLoading}
        ListFooterComponent={transactions.length > 20 ? (
          <Pressable style={styles.viewMoreBtn} onPress={() => navigation.navigate('Transactions')}>
            <Text style={[styles.viewMoreText, { color: theme.colors.accent }]}>Tüm İşlemleri Gör</Text>
            <Icon name="chevron-right" size={16} color={theme.colors.accent} />
          </Pressable>
        ) : null}
      />
      <Pressable style={[styles.fab, { bottom: insets.bottom + 32, backgroundColor: theme.colors.accent }, isScanning && { opacity: 0.6 }]} onPress={handleScanReceipt} disabled={isScanning}>
        {isScanning ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="camera" size={24} color="#fff" />}
      </Pressable>
      <AddTransactionModal visible={showAddModal} onClose={() => { setShowAddModal(false); fetchTransactions(1); }} />
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerLogo: { width: 120, height: 30 },
  listContent: { paddingHorizontal: 20, paddingTop: 16 },
  summaryCard: { borderRadius: 20, padding: 24, marginBottom: 24 },
  summaryBalanceSection: { marginBottom: 16, alignItems: 'center' },
  summaryLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  summaryBalance: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryMetric: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  summaryDivider: { width: 1, height: 24, marginHorizontal: 16 },
  summaryDividerH: { height: 1, marginVertical: 12, opacity: 0.5 },
  rowContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  rowIconCircle: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1 },
  rowCategory: { fontSize: 16, fontWeight: '500' },
  rowDate: { fontSize: 12, marginTop: 2 },
  rowAmount: { fontSize: 16, fontWeight: '600' },
  viewMoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 4 },
  viewMoreText: { fontSize: 14, fontWeight: '600' },
  fab: { position: 'absolute', right: 24, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  emptyText: { textAlign: 'center', marginTop: 40, opacity: 0.5 }
});

export default HomeScreen;