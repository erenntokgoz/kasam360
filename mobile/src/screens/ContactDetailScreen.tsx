import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import Share from 'react-native-share';
import { useTranslation } from 'react-i18next';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useDebtStore } from '../store/useDebtStore';
import { useLedgerStore } from '../store/useLedgerStore';
import type { Debt } from '../api/debtService';
import type { Transaction } from '../api/transactionService';
import { PaymentModal } from './DebtsScreen';
import { formatCurrency, formatDate } from '../utils/format';
import TransactionDetailModal from '../components/TransactionDetailModal';
import DebtDetailModal from '../components/DebtDetailModal';
import AddTransactionModal from '../components/AddTransactionModal';
import AddCard from '../components/AddCard';

type ParamList = {
  ContactDetail: { contactName: string };
};



const ContactDetailScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<ParamList, 'ContactDetail'>>();
  const insets = useSafeAreaInsets();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  
  const { contactName } = route.params;
  const { debts, fetchDebts } = useDebtStore();
  const { transactions, fetchTransactions } = useLedgerStore();
  
  const [payTarget, setPayTarget] = useState<Debt | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedDebt, setSelectedDebt] = useState<Debt | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchDebts(1).catch(() => {});
    fetchTransactions(1).catch(() => {});
  }, [fetchDebts, fetchTransactions]);

  const contactDebts = useMemo(() => {
    return debts
      .filter(d => d.entityName === contactName)
      .sort((a, b) => {
        const dateA = new Date(a.createdAt || a.dueDate || 0).getTime();
        const dateB = new Date(b.createdAt || b.dueDate || 0).getTime();
        return dateB - dateA;
      });
  }, [debts, contactName]);

  const contactTransactions = useMemo(() => {
    return transactions
      .filter((t: Transaction) => t.description?.includes(contactName) || t.category?.includes(contactName))
      .sort((a: Transaction, b: Transaction) => new Date(b.transactionDate || b.createdAt).getTime() - new Date(a.transactionDate || a.createdAt).getTime());
  }, [transactions, contactName]);

  const { totalGiven, totalTaken, netStatus } = useMemo(() => {
    let given = 0;
    let taken = 0;
    contactDebts.forEach((d: Debt) => {
      if (d.type === 'GIVEN') given += d.remainingAmount;
      if (d.type === 'TAKEN') taken += d.remainingAmount;
    });
    return {
      totalGiven: given,
      totalTaken: taken,
      netStatus: given - taken, // positive means they owe us
    };
  }, [contactDebts]);

  const combinedData = useMemo(() => {
    const list: any[] = [];
    contactDebts.forEach((d: Debt) => list.push({ ...d, rowType: 'DEBT' }));
    contactTransactions.forEach((t: Transaction) => list.push({ ...t, rowType: 'TX' }));
    return list.sort((a, b) => {
      const dateA = new Date(a.transactionDate || a.createdAt || a.dueDate || 0).getTime();
      const dateB = new Date(b.transactionDate || b.createdAt || b.dueDate || 0).getTime();
      return dateB - dateA;
    });
  }, [contactDebts, contactTransactions]);

  const renderItem = useCallback(({ item }: { item: any }) => {
    if (item.rowType === 'DEBT') {
      const isGiven = item.type === 'GIVEN';
      const accent = isGiven ? theme.colors.successLight : theme.colors.dangerLight;
      const iconBg = isGiven ? theme.colors.successTransparent : theme.colors.dangerTransparent;
      const paid = item.status === 'PAID';

      return (
        <Pressable style={styles.rowWrap} onPress={() => setSelectedDebt(item)}>
          <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
            <Icon name={isGiven ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={accent} />
          </View>
          <View style={styles.rowMid}>
            <Text style={[styles.rowDesc, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              {isGiven ? t('debts.typeGiven') : t('debts.typeTaken')}
            </Text>
            <Text style={[styles.rowDate, { color: theme.colors.textTertiary }]}>{formatDate(item.createdAt || item.dueDate)}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowRemaining, { color: paid ? theme.colors.textTertiary : accent }]}>
              {formatCurrency(item.remainingAmount)}
            </Text>
            <Text style={[styles.rowTotal, { color: theme.colors.textTertiary }]}>/ {formatCurrency(item.totalAmount)}</Text>
          </View>
          
          {!paid && (
            <Pressable 
              style={[styles.payBtn, { backgroundColor: accent }]}
              onPress={() => setPayTarget(item)}
            >
              <Text style={styles.payBtnText}>{t('paymentModal.payFull')}</Text>
            </Pressable>
          )}
        </Pressable>
      );
    } else {
      const isIncome = item.type === 'INCOME';
      const accent = isIncome ? theme.colors.success : theme.colors.danger;
      return (
        <Pressable style={styles.rowWrap} onPress={() => setSelectedTx(item)}>
          <View style={[styles.rowIcon, { backgroundColor: theme.colors.card }]}>
            <Icon name={isIncome ? 'plus' : 'minus'} size={14} color={accent} />
          </View>
          <View style={styles.rowMid}>
            <Text style={[styles.rowDesc, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              {item.category || (isIncome ? 'Gelir' : 'Gider')}
            </Text>
            <Text style={[styles.rowDate, { color: theme.colors.textTertiary }]}>{formatDate(item.transactionDate || item.createdAt)}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowRemaining, { color: accent }]}>
              {isIncome ? '+' : '-'}{formatCurrency(item.amount)}
            </Text>
            <Text style={[styles.rowTotal, { color: theme.colors.textTertiary }]}>{item.method}</Text>
          </View>
        </Pressable>
      );
    }
  }, [theme, t]);

  const handleShare = async () => {
    const message = `Kasam360 Özet: ${contactName}\n\n` +
      `Toplam Alacak: ${formatCurrency(totalGiven)}\n` +
      `Toplam Borç: ${formatCurrency(totalTaken)}\n` +
      `-------------------\n` +
      `Net Durum: ${netStatus >= 0 ? 'Alacaklıyız' : 'Borçluyuz'} (${formatCurrency(Math.abs(netStatus))})`;
    
    try {
      await Share.open({ message });
    } catch (err) {
      // User cancelled or error
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      
      {/* Header */}
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-left" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>{contactName}</Text>
        <Pressable hitSlop={12} onPress={handleShare}>
          <Icon name="share-2" size={22} color={theme.colors.accent} />
        </Pressable>
      </View>

      {/* Summary Card */}
      <View style={styles.cardContainer}>
        <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing.xl }]}>
          <View style={styles.cardTop}>
            <Text style={[styles.cardTitle, { color: theme.colors.textTertiary }]}>{t('debts.netStatus')}</Text>
            <Text style={[styles.netAmount, { color: netStatus >= 0 ? theme.colors.successLight : theme.colors.dangerLight }]}>
              {netStatus > 0 ? '+' : ''}{formatCurrency(netStatus)}
            </Text>
          </View>
          
          <View style={[styles.summaryRow, { backgroundColor: theme.colors.card }]}>
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: theme.colors.textTertiary }]}>{t('debts.summaryGiven')}</Text>
              <Text style={[styles.summaryVal, { color: theme.colors.successLight }]}>{formatCurrency(totalGiven)}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: theme.colors.textTertiary }]}>{t('debts.summaryTaken')}</Text>
              <Text style={[styles.summaryVal, { color: theme.colors.dangerLight }]}>{formatCurrency(totalTaken)}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Transactions List */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginBottom: 16 }}>
        <Text style={[styles.listTitle, { color: theme.colors.textPrimary, paddingHorizontal: 0, marginBottom: 0 }]}>İşlemler & Borçlar</Text>
        <Pressable 
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          onPress={() => setShowAddModal(true)}
        >
          <Icon name="plus-circle" size={20} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 13 }}>İşlem Ekle</Text>
        </Pressable>
      </View>
      <FlatList
        data={combinedData}
        renderItem={renderItem}
        keyExtractor={(item, index) => item._id || index.toString()}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + theme.spacing['2xl'] }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Icon name="inbox" size={48} color={theme.colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: theme.colors.textSecondary }]}>Henüz bir işlem kaydı bulunmuyor.</Text>
          </View>
        }
      />

      <PaymentModal visible={!!payTarget} debt={payTarget} onClose={() => setPayTarget(null)} />
      {selectedTx && (
        <TransactionDetailModal 
          visible={!!selectedTx} 
          transaction={selectedTx} 
          onClose={() => setSelectedTx(null)} 
        />
      )}
      {selectedDebt && (
        <DebtDetailModal 
          visible={!!selectedDebt} 
          debt={selectedDebt} 
          onClose={() => setSelectedDebt(null)} 
          onPay={setPayTarget}
        />
      )}
      <AddTransactionModal 
        visible={showAddModal} 
        onClose={() => { setShowAddModal(false); fetchDebts(1); fetchTransactions(1); }} 
        initialType="BORÇ"
        initialWho={contactName}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12 },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, letterSpacing: 0.4 },
  cardContainer: { paddingHorizontal: 24, marginTop: 16, marginBottom: 24 },
  summaryCard: {},
  cardTop: { alignItems: 'center', marginBottom: 24 },
  cardTitle: { fontSize: 13, marginBottom: 4 },
  netAmount: { fontSize: 36, letterSpacing: -0.5 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, padding: 16 },
  summaryCol: { flex: 1, alignItems: 'center' },
  summaryLabel: { fontSize: 11, marginBottom: 2 },
  summaryVal: { fontSize: 15 },
  summaryDivider: { width: 1, height: 24 },
  listTitle: { paddingHorizontal: 24, fontSize: 18, marginBottom: 16 },
  listContent: { paddingHorizontal: 24 },
  separator: { height: 1, marginLeft: 56, marginVertical: 8 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMid: { flex: 1, marginRight: 8 },
  rowDesc: { fontSize: 15, marginBottom: 2 },
  rowDate: { fontSize: 11 },
  rowRight: { alignItems: 'flex-end', marginRight: 16 },
  rowRemaining: { fontSize: 15, letterSpacing: -0.3 },
  rowTotal: { fontSize: 11, marginTop: 1 },
  paidBadge: { marginTop: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  paidText: { fontSize: 9, letterSpacing: 0.8 },
  payBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  payBtnText: { fontSize: 11 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 8 },
  emptyTitle: { fontSize: 15, marginTop: 12 },
});

export default ContactDetailScreen;
