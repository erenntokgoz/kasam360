import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Modal, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useDebtStore } from '../store/useDebtStore';
import { useLedgerStore } from '../store/useLedgerStore';
import type { Debt, DebtType } from '../api/debtService';
import { formatCurrency, formatDate } from '../utils/format';

const DebtRow: React.FC<{ item: Debt; index: number; onPress: (d: Debt) => void }> = React.memo(({ item, onPress }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const isGiven = item.type === 'GIVEN';
  const accent = isGiven ? theme.colors.successLight : theme.colors.dangerLight;
  const iconBg = isGiven ? 'rgba(16,185,129,0.10)' : 'rgba(248,113,113,0.10)';
  const paid = item.status === 'PAID';
  const progress = item.totalAmount > 0 ? 1 - item.remainingAmount / item.totalAmount : 0;

  return (
    <Pressable
      style={styles.rowWrap}
      activeOpacity={0.7}
      onPress={() => onPress(item)}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        <Icon name={isGiven ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={accent} />
      </View>
      <View style={styles.rowMid}>
        <Text style={[styles.rowName, { color: theme.colors.textPrimary }]} numberOfLines={1}>{item.entityName}</Text>
        <Text style={[styles.rowDue, { color: theme.colors.textTertiary }]}>{item.dueDate ? formatDate(item.dueDate) : 'No due date'}</Text>
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: accent }]} />
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowRemaining, { color: paid ? theme.colors.textTertiary : accent }]}>{formatCurrency(item.remainingAmount)}</Text>
        <Text style={[styles.rowTotal, { color: theme.colors.textTertiary }]}>/ {formatCurrency(item.totalAmount)}</Text>
        {paid && <View style={[styles.paidBadge, { backgroundColor: theme.colors.successTransparent }]}><Text style={styles.paidText}>PAID</Text></View>}
      </View>
    </Pressable>
  );
});

const TABS: { label: string; value: DebtType | null }[] = [
  { label: 'All', value: null },
  { label: 'Alacaklar', value: 'GIVEN' },
  { label: 'Borçlar', value: 'TAKEN' },
];

const SegmentedControl: React.FC<{ active: DebtType | null; onChange: (v: DebtType | null) => void }> = ({ active, onChange }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  return (
    <View style={[styles.segWrap, { backgroundColor: theme.colors.surface }]}>
      {TABS.map((t) => {
        const sel = t.value === active;
        return (
          <Pressable key={t.label} style={[styles.segBtn, sel && { backgroundColor: theme.colors.card }]} onPress={() => onChange(t.value)}>
            <Text style={[styles.segLabel, { color: theme.colors.textTertiary }, sel && { color: theme.colors.textPrimary }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const SummaryHeader: React.FC = () => {
  const summary = useDebtStore((s) => s.summary);
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  if (!summary) return null;
  return (
    <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryCol}>
          <View style={styles.summaryDotWrap}><View style={[styles.sDot, { backgroundColor: theme.colors.successLight }]} /></View>
          <View>
            <Text style={[styles.summaryLabel, { color: theme.colors.textTertiary }]}>Alacaklar</Text>
            <Text style={[styles.summaryVal, { color: theme.colors.successLight }]}>{formatCurrency(summary.given.remaining)}</Text>
          </View>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: theme.colors.border }]} />
        <View style={styles.summaryCol}>
          <View style={styles.summaryDotWrap}><View style={[styles.sDot, { backgroundColor: theme.colors.dangerLight }]} /></View>
          <View>
            <Text style={[styles.summaryLabel, { color: theme.colors.textTertiary }]}>Borçlar</Text>
            <Text style={[styles.summaryVal, { color: theme.colors.dangerLight }]}>{formatCurrency(summary.taken.remaining)}</Text>
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
    <View style={styles.emptyWrap}>
      <Icon name="inbox" size={48} color={theme.colors.textTertiary} />
      <Text style={[styles.emptyTitle, { color: theme.colors.textSecondary }]}>No debts yet</Text>
      <Text style={[styles.emptySub, { color: theme.colors.textTertiary }]}>Tap + to add a new debt record</Text>
    </View>
  );
};

interface PayModalProps { visible: boolean; debt: Debt | null; onClose: () => void; }

export const PaymentModal: React.FC<PayModalProps> = ({ visible, debt, onClose }) => {
  const [input, setInput] = useState('');
  const { makePayment, isPaying } = useDebtStore();
  const refreshLedger = useLedgerStore((s) => s.refreshLedger);
  const inputRef = useRef<TextInput>(null);
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  useEffect(() => { if (visible) { setInput(''); setTimeout(() => inputRef.current?.focus(), 300); } }, [visible]);

  const handlePay = async () => {
    if (!debt) return;
    const val = parseFloat(input.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert('Invalid Amount'); return; }
    const cents = Math.round(val * 100);
    if (cents > debt.remainingAmount) { Alert.alert('Exceeds Balance', `Max: ${formatCurrency(debt.remainingAmount)}`); return; }
    try { await makePayment(debt._id, cents); refreshLedger().catch(() => { }); Alert.alert('Success'); onClose(); }
    catch { Alert.alert('Error', 'Payment failed.'); }
  };

  const handlePayFull = async () => {
    if (!debt) return;
    try { await makePayment(debt._id, debt.remainingAmount); refreshLedger().catch(() => { }); Alert.alert('Success', 'Debt fully paid!'); onClose(); }
    catch { Alert.alert('Error', 'Payment failed.'); }
  };

  if (!debt) return null;
  const isGiven = debt.type === 'GIVEN';
  const accent = isGiven ? theme.colors.successLight : theme.colors.dangerLight;
  const actionLabel = isGiven ? 'Tahsil Et' : 'Öde';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalOverlay, { backgroundColor: theme.colors.overlay }]}>
        <Pressable style={[styles.modalOverlay, { backgroundColor: theme.colors.overlay }]} onPress={onClose}>
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.modalHandle, { backgroundColor: theme.colors.border }]} />
            <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>{actionLabel}</Text>
            <Text style={[styles.modalEntity, { color: theme.colors.textTertiary }]}>{debt.entityName}</Text>
            <View style={styles.modalAmountRow}>
              <Text style={[styles.modalAmountLabel, { color: theme.colors.textTertiary }]}>Remaining</Text>
              <Text style={[styles.modalAmountVal, { color: accent }]}>{formatCurrency(debt.remainingAmount)}</Text>
            </View>
            <View style={[styles.modalInputWrap, { backgroundColor: theme.colors.card }]}>
              <Text style={[styles.modalCurrency, { color: theme.colors.textTertiary }]}>₺</Text>
              <TextInput ref={inputRef} style={[styles.modalInput, { color: theme.colors.textPrimary }]} value={input} onChangeText={setInput} placeholder="0.00" placeholderTextColor={theme.colors.textTertiary} keyboardType="decimal-pad" returnKeyType="done" />
            </View>
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, { borderColor: theme.colors.border, borderWidth: 1 }]} onPress={handlePayFull} disabled={isPaying}>
                <Text style={[styles.modalBtnText, { color: accent }]}>Pay Full</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, { backgroundColor: accent }]} onPress={handlePay} disabled={isPaying}>
                {isPaying ? <ActivityIndicator size="small" color={theme.colors.primary} /> : <Text style={[styles.modalBtnText, { color: theme.colors.primary }]}>{actionLabel}</Text>}
              </Pressable>
            </View>
            <Pressable style={styles.modalCancel} onPress={onClose}><Text style={[styles.modalCancelText, { color: theme.colors.textTertiary }]}>Cancel</Text></Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const DebtsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [payTarget, setPayTarget] = useState<Debt | null>(null);
  const { debts, activeFilter, isLoading, setFilter, fetchDebts } = useDebtStore();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  useEffect(() => { fetchDebts(1).catch(() => { }); }, [fetchDebts]);

  const handleRowPress = useCallback((d: Debt) => { 
    navigation.navigate('ContactDetail', { contactName: d.entityName });
  }, [navigation]);
  const renderItem = useCallback(({ item, index }: { item: Debt; index: number }) => <DebtRow item={item} index={index} onPress={handleRowPress} />, [handleRowPress]);
  const keyExtractor = useCallback((item: Debt) => item._id, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.colors.primary} />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Debts</Text>
        <Pressable hitSlop={12}>
          <Icon name="plus-circle" size={22} color={theme.colors.accent} />
        </Pressable>
      </View>
      <View style={styles.segContainer}>
        <SegmentedControl active={activeFilter} onChange={setFilter} />
      </View>
      <FlatList
        data={debts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={<SummaryHeader />}
        ListEmptyComponent={!isLoading ? <EmptyState /> : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.colors.accent }]} />}
        refreshing={isLoading}
        onRefresh={() => fetchDebts(1)}
      />
      <PaymentModal visible={!!payTarget} debt={payTarget} onClose={() => setPayTarget(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 18, letterSpacing: 0.4 },
  segContainer: { paddingHorizontal: 24, marginBottom: 8 },
  segWrap: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  segLabel: { fontSize: 13 },
  listContent: { paddingHorizontal: 24, paddingTop: 8 },
  separator: { height: 1, marginLeft: 56 },
  summaryCard: { borderRadius: 16, padding: 24, marginBottom: 32 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  summaryCol: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryDotWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sDot: { width: 8, height: 8, borderRadius: 4 },
  summaryLabel: { fontSize: 11, marginBottom: 1 },
  summaryVal: { fontSize: 15 },
  summaryDivider: { width: 1, height: 32 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 4 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMid: { flex: 1, marginRight: 8 },
  rowName: { fontSize: 15, marginBottom: 2 },
  rowDue: { fontSize: 11, marginBottom: 6 },
  progressTrack: { height: 3, borderRadius: 1.5, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 1.5 },
  rowRight: { alignItems: 'flex-end' },
  rowRemaining: { fontSize: 15, letterSpacing: -0.3 },
  rowTotal: { fontSize: 11, marginTop: 1 },
  paidBadge: { marginTop: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  paidText: { fontSize: 9, letterSpacing: 0.8 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 8 },
  emptyTitle: { fontSize: 18, marginTop: 12 },
  emptySub: { fontSize: 13, textAlign: 'center', maxWidth: 260 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 22, textAlign: 'center' },
  modalEntity: { fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 32 },
  modalAmountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalAmountLabel: { fontSize: 13 },
  modalAmountVal: { fontSize: 22 },
  modalInputWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 12, marginBottom: 32 },
  modalCurrency: { fontSize: 22, marginRight: 8 },
  modalInput: { flex: 1, fontSize: 28, paddingVertical: 12 },
  modalActions: { flexDirection: 'row', gap: 16 },
  modalBtn: { flex: 1, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modalBtnText: { fontSize: 15 },
  modalCancel: { marginTop: 24, alignItems: 'center' },
  modalCancelText: { fontSize: 13 },
});

export default DebtsScreen;