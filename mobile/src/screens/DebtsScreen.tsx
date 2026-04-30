/**
 * DebtsScreen — Veresiye Management
 * ──────────────────────────────────────────────────────────────────────────────
 * Segmented tabs (Alacaklar / Borçlar), debt list, partial-payment modal.
 * Strict Executive Slate & Emerald tokens.
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  StatusBar,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  Layout,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { theme } from '../theme';
import { useDebtStore } from '../store/useDebtStore';
import { useLedgerStore } from '../store/useLedgerStore';
import type { Debt, DebtType } from '../api/debtService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (cents: number): string => {
  const v = Math.abs(cents) / 100;
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ─── Animated Row ────────────────────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const DebtRow: React.FC<{ item: Debt; index: number; onPress: (d: Debt) => void }> = React.memo(
  ({ item, index, onPress }) => {
    const scale = useSharedValue(1);
    const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
    const pIn = useCallback(() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 200 }); }, [scale]);
    const pOut = useCallback(() => { scale.value = withSpring(1, { damping: 15, stiffness: 200 }); }, [scale]);

    const isGiven = item.type === 'GIVEN';
    const accent = isGiven ? theme.colors.successLight : theme.colors.dangerLight;
    const iconBg = isGiven ? 'rgba(16,185,129,0.10)' : 'rgba(248,113,113,0.10)';
    const paid = item.status === 'PAID';
    const progress = item.totalAmount > 0 ? 1 - item.remainingAmount / item.totalAmount : 0;

    return (
      <AnimatedPressable
        entering={FadeInDown.delay(index * 50).duration(350).springify().damping(18)}
        layout={Layout.springify()}
        style={[styles.rowWrap, animStyle]}
        onPressIn={pIn}
        onPressOut={pOut}
        onPress={() => onPress(item)}
      >
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <Icon name={isGiven ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={accent} />
        </View>

        <View style={styles.rowMid}>
          <Text style={styles.rowName} numberOfLines={1}>{item.entityName}</Text>
          <Text style={styles.rowDue}>{item.dueDate ? fmtDate(item.dueDate) : 'No due date'}</Text>
          {/* Progress bar */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: accent }]} />
          </View>
        </View>

        <View style={styles.rowRight}>
          <Text style={[styles.rowRemaining, { color: paid ? theme.colors.textTertiary : accent }]}>
            {fmt(item.remainingAmount)}
          </Text>
          <Text style={styles.rowTotal}>/ {fmt(item.totalAmount)}</Text>
          {paid && (
            <View style={styles.paidBadge}>
              <Text style={styles.paidText}>PAID</Text>
            </View>
          )}
        </View>
      </AnimatedPressable>
    );
  },
);

// ─── Segmented Control ───────────────────────────────────────────────────────

const TABS: { label: string; value: DebtType | null }[] = [
  { label: 'All', value: null },
  { label: 'Alacaklar', value: 'GIVEN' },
  { label: 'Borçlar', value: 'TAKEN' },
];

const SegmentedControl: React.FC<{ active: DebtType | null; onChange: (v: DebtType | null) => void }> = ({ active, onChange }) => (
  <View style={styles.segWrap}>
    {TABS.map((t) => {
      const sel = t.value === active;
      return (
        <Pressable key={t.label} style={[styles.segBtn, sel && styles.segBtnActive]} onPress={() => onChange(t.value)}>
          <Text style={[styles.segLabel, sel && styles.segLabelActive]}>{t.label}</Text>
        </Pressable>
      );
    })}
  </View>
);

// ─── Summary Header ──────────────────────────────────────────────────────────

const SummaryHeader: React.FC = () => {
  const summary = useDebtStore((s) => s.summary);
  if (!summary) return null;

  return (
    <Animated.View entering={FadeInDown.duration(500).springify()} style={styles.summaryCard}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryCol}>
          <View style={styles.summaryDotWrap}>
            <View style={[styles.sDot, { backgroundColor: theme.colors.successLight }]} />
          </View>
          <View>
            <Text style={styles.summaryLabel}>Alacaklar</Text>
            <Text style={[styles.summaryVal, { color: theme.colors.successLight }]}>{fmt(summary.given.remaining)}</Text>
          </View>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <View style={styles.summaryDotWrap}>
            <View style={[styles.sDot, { backgroundColor: theme.colors.dangerLight }]} />
          </View>
          <View>
            <Text style={styles.summaryLabel}>Borçlar</Text>
            <Text style={[styles.summaryVal, { color: theme.colors.dangerLight }]}>{fmt(summary.taken.remaining)}</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

// ─── Empty State ─────────────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <View style={styles.emptyWrap}>
    <Icon name="inbox" size={48} color={theme.colors.textTertiary} />
    <Text style={styles.emptyTitle}>No debts yet</Text>
    <Text style={styles.emptySub}>Tap + to add a new debt record</Text>
  </View>
);

// ─── Payment Modal ───────────────────────────────────────────────────────────

interface PayModalProps {
  visible: boolean;
  debt: Debt | null;
  onClose: () => void;
}

const PaymentModal: React.FC<PayModalProps> = ({ visible, debt, onClose }) => {
  const [input, setInput] = useState('');
  const { makePayment, isPaying } = useDebtStore();
  const refreshLedger = useLedgerStore((s) => s.refreshLedger);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setInput('');
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [visible]);

  const handlePay = async () => {
    if (!debt) return;
    const val = parseFloat(input.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }
    const cents = Math.round(val * 100);
    if (cents > debt.remainingAmount) {
      Alert.alert('Exceeds Balance', `Maximum payable: ${fmt(debt.remainingAmount)}`);
      return;
    }
    try {
      const result = await makePayment(debt._id, cents);
      refreshLedger().catch(() => {});
      Alert.alert('Success', result.debt.status === 'PAID' ? 'Debt fully paid!' : 'Partial payment recorded.');
      onClose();
    } catch {
      Alert.alert('Error', 'Payment failed. Please try again.');
    }
  };

  const handlePayFull = async () => {
    if (!debt) return;
    try {
      const result = await makePayment(debt._id, debt.remainingAmount);
      refreshLedger().catch(() => {});
      Alert.alert('Success', 'Debt fully paid!');
      onClose();
    } catch {
      Alert.alert('Error', 'Payment failed. Please try again.');
    }
  };

  if (!debt) return null;
  const isGiven = debt.type === 'GIVEN';
  const accent = isGiven ? theme.colors.successLight : theme.colors.dangerLight;
  const actionLabel = isGiven ? 'Tahsil Et' : 'Öde';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <Pressable style={styles.modalOverlay} onPress={onClose}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            {/* Header */}
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{actionLabel}</Text>
            <Text style={styles.modalEntity}>{debt.entityName}</Text>

            {/* Remaining */}
            <View style={styles.modalAmountRow}>
              <Text style={styles.modalAmountLabel}>Remaining</Text>
              <Text style={[styles.modalAmountVal, { color: accent }]}>{fmt(debt.remainingAmount)}</Text>
            </View>

            {/* Input */}
            <View style={styles.modalInputWrap}>
              <Text style={styles.modalCurrency}>₺</Text>
              <TextInput
                ref={inputRef}
                style={styles.modalInput}
                value={input}
                onChangeText={setInput}
                placeholder="0.00"
                placeholderTextColor={theme.colors.textTertiary}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalBtnOutline]} onPress={handlePayFull} disabled={isPaying}>
                <Text style={[styles.modalBtnText, { color: accent }]}>Pay Full</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, { backgroundColor: accent }]} onPress={handlePay} disabled={isPaying}>
                {isPaying ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text style={[styles.modalBtnText, { color: theme.colors.primary }]}>{actionLabel}</Text>
                )}
              </Pressable>
            </View>

            {/* Cancel */}
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

const DebtsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [payTarget, setPayTarget] = useState<Debt | null>(null);

  const { debts, activeFilter, isLoading, setFilter, fetchDebts } = useDebtStore();

  useEffect(() => { fetchDebts(1).catch(() => {}); }, [fetchDebts]);

  const handleRowPress = useCallback((d: Debt) => {
    if (d.status === 'PAID') return;
    setPayTarget(d);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Debt; index: number }) => (
      <DebtRow item={item} index={index} onPress={handleRowPress} />
    ), [handleRowPress],
  );

  const keyExtractor = useCallback((item: Debt) => item._id, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primary} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Debts</Text>
        <Pressable hitSlop={12}>
          <Icon name="plus-circle" size={22} color={theme.colors.successLight} />
        </Pressable>
      </View>

      {/* Segmented Control */}
      <View style={styles.segContainer}>
        <SegmentedControl active={activeFilter} onChange={setFilter} />
      </View>

      {/* List */}
      <FlatList
        data={debts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={<SummaryHeader />}
        ListEmptyComponent={!isLoading ? <EmptyState /> : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + theme.spacing['2xl'] }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={isLoading}
        onRefresh={() => fetchDebts(1)}
      />

      {/* Payment Modal */}
      <PaymentModal visible={!!payTarget} debt={payTarget} onClose={() => setPayTarget(null)} />
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.primary },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base },
  headerTitle: { fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.lg, color: theme.colors.textPrimary, letterSpacing: 0.4 },

  segContainer: { paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.sm },
  segWrap: { flexDirection: 'row', backgroundColor: theme.colors.surface, borderRadius: theme.radii.base, padding: 3 },
  segBtn: { flex: 1, paddingVertical: theme.spacing.sm, alignItems: 'center', borderRadius: theme.radii.sm },
  segBtnActive: { backgroundColor: theme.colors.card },
  segLabel: { fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary },
  segLabelActive: { color: theme.colors.textPrimary, fontFamily: theme.fonts.semiBold },

  listContent: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm },
  separator: { height: 1, backgroundColor: theme.colors.border, marginLeft: 56 },

  // Summary
  summaryCard: { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, padding: theme.spacing.xl, marginBottom: theme.spacing.xl, ...theme.shadows.card },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  summaryCol: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  summaryDotWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  sDot: { width: 8, height: 8, borderRadius: 4 },
  summaryLabel: { fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginBottom: 1 },
  summaryVal: { fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base },
  summaryDivider: { width: 1, height: 32, backgroundColor: theme.colors.border },

  // Row
  rowWrap: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.xs },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: theme.spacing.md },
  rowMid: { flex: 1, marginRight: theme.spacing.sm },
  rowName: { fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginBottom: 2 },
  rowDue: { fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginBottom: 6 },
  progressTrack: { height: 3, backgroundColor: theme.colors.border, borderRadius: 1.5, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 1.5 },
  rowRight: { alignItems: 'flex-end' },
  rowRemaining: { fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.base, letterSpacing: -0.3 },
  rowTotal: { fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginTop: 1 },
  paidBadge: { marginTop: 4, backgroundColor: 'rgba(16,185,129,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  paidText: { fontFamily: theme.fonts.semiBold, fontSize: 9, color: theme.colors.successLight, letterSpacing: 0.8 },

  // Empty
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing['4xl'], gap: theme.spacing.sm },
  emptyTitle: { fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.lg, color: theme.colors.textSecondary, marginTop: theme.spacing.base },
  emptySub: { fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary, textAlign: 'center', maxWidth: 260 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.60)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.xl, borderTopRightRadius: theme.radii.xl, padding: theme.spacing.xl, paddingBottom: 40 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: 'center', marginBottom: theme.spacing.lg },
  modalTitle: { fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.xl, color: theme.colors.textPrimary, textAlign: 'center' },
  modalEntity: { fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary, textAlign: 'center', marginTop: 4, marginBottom: theme.spacing.xl },
  modalAmountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.lg },
  modalAmountLabel: { fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary },
  modalAmountVal: { fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.xl },
  modalInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, marginBottom: theme.spacing.xl },
  modalCurrency: { fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.xl, color: theme.colors.textTertiary, marginRight: theme.spacing.sm },
  modalInput: { flex: 1, fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes['2xl'], color: theme.colors.textPrimary, paddingVertical: theme.spacing.base },
  modalActions: { flexDirection: 'row', gap: theme.spacing.md },
  modalBtn: { flex: 1, height: 48, borderRadius: theme.radii.base, alignItems: 'center', justifyContent: 'center' },
  modalBtnOutline: { borderWidth: 1, borderColor: theme.colors.border },
  modalBtnText: { fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base },
  modalCancel: { marginTop: theme.spacing.lg, alignItems: 'center' },
  modalCancelText: { fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary },
});

export default DebtsScreen;
