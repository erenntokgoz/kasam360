import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Modal, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withSpring, Layout } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useDebtStore } from '../store/useDebtStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { useContactStore } from '../store/useContactStore';
import type { Debt, DebtType } from '../api/debtService';
import { useTranslation } from 'react-i18next';

const fmt = (cents: number): string => {
  const v = Math.abs(cents) / 100;
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const DebtRow: React.FC<{ item: Debt; index: number; onPress: (d: Debt) => void; onLongPress: (d: Debt) => void }> = React.memo(({ item, index, onPress, onLongPress }) => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pIn = useCallback(() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 200 }); }, [scale]);
  const pOut = useCallback(() => { scale.value = withSpring(1, { damping: 15, stiffness: 200 }); }, [scale]);

  const isGiven = item.type === 'GIVEN';
  const accent = isGiven ? theme.colors.successLight : theme.colors.dangerLight;
  const iconBg = isGiven ? 'rgba(16,185,129,0.10)' : 'rgba(248,113,113,0.10)';
  const paid = item.status === 'PAID';
  const progress = item.totalAmount > 0 ? 1 - item.remainingAmount / item.totalAmount : 0;
  const { t } = useTranslation();

  return (
    <AnimatedPressable
      entering={FadeInDown.delay(index * 50).duration(350).springify().damping(18)}
      layout={Layout.springify()}
      style={[
        styles.rowWrap,
        { paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.xs },
        animStyle,
      ]}
      onPressIn={pIn} onPressOut={pOut}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBg, marginRight: theme.spacing.md }]}>
        <Icon name={isGiven ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={accent} />
      </View>
      <View style={[styles.rowMid, { marginRight: theme.spacing.sm }]}>
        <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginBottom: 2 }} numberOfLines={1}>{item.entityName}</Text>
        <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginBottom: 6 }}>{item.dueDate ? fmtDate(item.dueDate) : t('debts.noDueDate')}</Text>
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%` as any, backgroundColor: accent }]} />
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={{ fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.base, letterSpacing: -0.3, color: paid ? theme.colors.textTertiary : accent }}>{fmt(item.remainingAmount)}</Text>
        <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginTop: 1 }}>/ {fmt(item.totalAmount)}</Text>
        {paid && <View style={styles.paidBadge}><Text style={styles.paidText}>{t('debts.paid')}</Text></View>}
      </View>
    </AnimatedPressable>
  );
});

const SegmentedControl: React.FC<{ active: DebtType | null; onChange: (v: DebtType | null) => void }> = ({ active, onChange }) => {
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const TABS: { label: string; value: DebtType | null }[] = [
    { label: t('debts.tabAll'), value: null },
    { label: t('debts.tabGiven'), value: 'GIVEN' },
    { label: t('debts.tabTaken'), value: 'TAKEN' },
  ];
  return (
  <View style={[styles.segWrap, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.base }]}>
    {TABS.map((t) => {
      const sel = t.value === active;
      return (
        <Pressable
          key={t.label}
          style={[
            styles.segBtn,
            { paddingVertical: theme.spacing.sm, borderRadius: theme.radii.sm },
            sel && { backgroundColor: theme.colors.card },
          ]}
          onPress={() => onChange(t.value)}
        >
          <Text style={[
            { fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary },
            sel && { color: theme.colors.textPrimary, fontFamily: theme.fonts.semiBold },
          ]}>{t.label}</Text>
        </Pressable>
      );
    })}
  </View>
);
};

const SummaryHeader: React.FC = () => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const summary = useDebtStore((s) => s.summary);
  const { t } = useTranslation();
  if (!summary) return null;
  return (
    <Animated.View entering={FadeInDown.duration(500).springify()} style={{
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.base,
      padding: theme.spacing.xl,
      marginBottom: theme.spacing.xl,
      ...theme.shadows.card,
    }}>
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCol, { gap: theme.spacing.sm }]}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
            <View style={[styles.sDot, { backgroundColor: theme.colors.successLight }]} />
          </View>
          <View>
            <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginBottom: 1 }}>{t('debts.summaryGiven')}</Text>
            <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: theme.colors.successLight }}>{fmt(summary.given.remaining)}</Text>
          </View>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: theme.colors.border }]} />
        <View style={[styles.summaryCol, { gap: theme.spacing.sm }]}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
            <View style={[styles.sDot, { backgroundColor: theme.colors.dangerLight }]} />
          </View>
          <View>
            <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginBottom: 1 }}>{t('debts.summaryTaken')}</Text>
            <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: theme.colors.dangerLight }}>{fmt(summary.taken.remaining)}</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

const EmptyState: React.FC = () => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { t } = useTranslation();
  return (
  <View style={[styles.emptyWrap, { paddingVertical: theme.spacing['4xl'], gap: theme.spacing.sm }]}>
    <Icon name="inbox" size={48} color={theme.colors.textTertiary} />
    <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.lg, color: theme.colors.textSecondary, marginTop: theme.spacing.base }}>{t('debts.noDebtsTitle')}</Text>
    <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary, textAlign: 'center', maxWidth: 260 }}>{t('debts.noDebtsSub')}</Text>
  </View>
);
};

export interface PayModalProps { visible: boolean; debt: Debt | null; onClose: () => void; }

export const PaymentModal: React.FC<PayModalProps> = ({ visible, debt, onClose }) => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const { makePayment, isPaying } = useDebtStore();
  const refreshLedger = useLedgerStore((s) => s.refreshLedger);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => { if (visible) { setInput(''); setTimeout(() => inputRef.current?.focus(), 300); } }, [visible]);

  const handlePay = async () => {
    if (!debt) return;
    const val = parseFloat(input.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert(t('paymentModal.invalidAmountTitle')); return; }
    const cents = Math.round(val * 100);
    if (cents > debt.remainingAmount) { Alert.alert(t('paymentModal.exceedsBalanceTitle'), `${t('paymentModal.exceedsBalanceMsg')}${fmt(debt.remainingAmount)}`); return; }
    try { await makePayment(debt._id, cents); refreshLedger().catch(() => { }); Alert.alert(t('paymentModal.successTitle')); onClose(); }
    catch { Alert.alert(t('paymentModal.errorTitle'), t('paymentModal.errorMsg')); }
  };

  const handlePayFull = async () => {
    if (!debt) return;
    try { await makePayment(debt._id, debt.remainingAmount); refreshLedger().catch(() => { }); Alert.alert(t('paymentModal.successTitle'), t('paymentModal.successMsg')); onClose(); }
    catch { Alert.alert(t('paymentModal.errorTitle'), t('paymentModal.errorMsg')); }
  };

  if (!debt) return null;
  const isGiven = debt.type === 'GIVEN';
  const accent = isGiven ? theme.colors.successLight : theme.colors.dangerLight;
  const actionLabel = isGiven ? t('paymentModal.titleGiven') : t('paymentModal.titleTaken');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <Pressable style={styles.modalOverlay} onPress={onClose}>
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.xl, borderTopRightRadius: theme.radii.xl, padding: theme.spacing.xl, paddingBottom: 40 }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.modalHandle, { backgroundColor: theme.colors.border, marginBottom: theme.spacing.lg }]} />
            <Text style={{ fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.xl, color: theme.colors.textPrimary, textAlign: 'center' }}>{actionLabel}</Text>
            <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary, textAlign: 'center', marginTop: 4, marginBottom: theme.spacing.xl }}>{debt.entityName}</Text>
            <View style={[styles.modalAmountRow, { marginBottom: theme.spacing.lg }]}>
              <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary }}>{t('paymentModal.remaining')}</Text>
              <Text style={{ fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.xl, color: accent }}>{fmt(debt.remainingAmount)}</Text>
            </View>
            <View style={[styles.modalInputWrap, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, marginBottom: theme.spacing.xl }]}>
              <Text style={{ fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.xl, color: theme.colors.textTertiary, marginRight: theme.spacing.sm }}>₺</Text>
              <TextInput ref={inputRef} style={{ flex: 1, fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes['2xl'], color: theme.colors.textPrimary, paddingVertical: theme.spacing.base }} value={input} onChangeText={setInput} placeholder="0.00" placeholderTextColor={theme.colors.textTertiary} keyboardType="decimal-pad" returnKeyType="done" />
            </View>
            <View style={[styles.modalActions, { gap: theme.spacing.md }]}>
              <Pressable style={[styles.modalBtn, { borderRadius: theme.radii.base }]} onPress={handlePayFull} disabled={isPaying}>
                <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: accent }}>{t('paymentModal.payFull')}</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, { backgroundColor: accent, borderRadius: theme.radii.base }]} onPress={handlePay} disabled={isPaying}>
                {isPaying ? <ActivityIndicator size="small" color={theme.colors.primary} /> : <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: theme.colors.primary }}>{actionLabel}</Text>}
              </Pressable>
            </View>
            <Pressable style={[styles.modalCancel, { marginTop: theme.spacing.lg }]} onPress={onClose}><Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary }}>{t('paymentModal.cancel')}</Text></Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const AddDebtModal: React.FC<{ visible: boolean; onClose: () => void; initialData?: Debt | null }> = ({ visible, onClose, initialData }) => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { t } = useTranslation();
  const { addDebt, updateDebt, isCreating, isLoading } = useDebtStore();
  const { contacts, addContact } = useContactStore();

  const [type, setType] = useState<DebtType>('GIVEN');
  const [entityName, setEntityName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    if (visible) {
      if (initialData) {
        setType(initialData.type);
        setEntityName(initialData.entityName);
        setAmount((initialData.totalAmount / 100).toString());
        setDueDate(initialData.dueDate ? new Date(initialData.dueDate).toISOString().split('T')[0] : '');
      } else {
        setType('GIVEN');
        setEntityName('');
        setAmount('');
        setDueDate('');
      }
    }
  }, [visible, initialData]);

  const handleSubmit = async () => {
    if (!entityName.trim() || !amount.trim()) {
      Alert.alert(t('addDebtModal.errorMissingTitle'), t('addDebtModal.errorMissingMsg'));
      return;
    }

    const numericAmount = parseFloat(amount.replace(',', '.'));
    if (isNaN(numericAmount) || numericAmount <= 0) {
      Alert.alert(t('addDebtModal.errorInvalidTitle'), t('addDebtModal.errorInvalidMsg'));
      return;
    }

    try {
      if (initialData) {
        await updateDebt(initialData._id, {
          type,
          entityName: entityName.trim(),
          totalAmount: Math.round(numericAmount * 100),
          dueDate: dueDate.trim() || undefined,
        });
      } else {
        await addDebt({
          type,
          entityName: entityName.trim(),
          totalAmount: Math.round(numericAmount * 100),
          dueDate: dueDate.trim() || undefined,
        });
        addContact(entityName.trim());
      }
      onClose();
    } catch (err) {
      Alert.alert(t('addDebtModal.errorSaveTitle'), t('addDebtModal.errorSaveMsg'));
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.cardOverlay}>
        <Pressable style={[styles.cardOverlay, { padding: theme.spacing.lg }]} onPress={onClose}>
          <Pressable style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.xl, padding: theme.spacing.xl, ...theme.shadows.card, maxHeight: '90%' }} onPress={(e) => e.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={[styles.modalCardHeader, { marginBottom: theme.spacing.xl }]}>
                <Text style={{ fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.xl, color: theme.colors.textPrimary }}>{initialData ? 'Borç Güncelle' : t('addDebtModal.title')}</Text>
                <Pressable onPress={onClose} hitSlop={8}>
                  <Icon name="x" size={24} color={theme.colors.textTertiary} />
                </Pressable>
              </View>

              <View>
                <View style={[styles.typeSelector, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, padding: 4, marginBottom: theme.spacing.md }]}>
                  <Pressable
                    style={[styles.typeBtn, { paddingVertical: theme.spacing.sm, borderRadius: theme.radii.sm }, type === 'GIVEN' && styles.typeBtnIncome]}
                    onPress={() => setType('GIVEN')}
                  >
                    <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.sm, color: type === 'GIVEN' ? theme.colors.successLight : theme.colors.textTertiary }}>{t('addDebtModal.typeGiven')}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.typeBtn, { paddingVertical: theme.spacing.sm, borderRadius: theme.radii.sm }, type === 'TAKEN' && styles.typeBtnExpense]}
                    onPress={() => setType('TAKEN')}
                  >
                    <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.sm, color: type === 'TAKEN' ? theme.colors.dangerLight : theme.colors.textTertiary }}>{t('addDebtModal.typeTaken')}</Text>
                  </Pressable>
                </View>

                {contacts.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.sm, marginBottom: theme.spacing.md }}>
                    {contacts.map((c) => (
                      <Pressable key={c.name} style={[{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.radii.full, backgroundColor: theme.colors.card }, entityName === c.name && styles.categoryPillActive]} onPress={() => setEntityName(c.name)}>
                        <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: entityName === c.name ? '#FFFFFF' : theme.colors.textSecondary }}>{c.name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}

                <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, paddingVertical: Platform.select({ ios: 14, android: 8 }), marginBottom: theme.spacing.md }]}>
                  <Icon name="user" size={16} color={theme.colors.textTertiary} />
                  <TextInput
                    style={{ flex: 1, fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }}
                    placeholder={t('addDebtModal.entityName')}
                    placeholderTextColor={theme.colors.textTertiary}
                    value={entityName}
                    onChangeText={setEntityName}
                  />
                </View>

                <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, paddingVertical: Platform.select({ ios: 14, android: 8 }), marginBottom: theme.spacing.md }]}>
                  <Icon name="dollar-sign" size={16} color={theme.colors.textTertiary} />
                  <TextInput
                    style={{ flex: 1, fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }}
                    placeholder={t('addDebtModal.amount')}
                    placeholderTextColor={theme.colors.textTertiary}
                    keyboardType="decimal-pad"
                    value={amount}
                    onChangeText={setAmount}
                  />
                </View>

                <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, paddingVertical: Platform.select({ ios: 14, android: 8 }), marginBottom: theme.spacing.md }]}>
                  <Icon name="calendar" size={16} color={theme.colors.textTertiary} />
                  <TextInput
                    style={{ flex: 1, fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }}
                    placeholder={t('addDebtModal.dueDate')}
                    placeholderTextColor={theme.colors.textTertiary}
                    value={dueDate}
                    onChangeText={setDueDate}
                  />
                </View>

                <Pressable
                  style={({ pressed }) => [{ backgroundColor: theme.colors.accent, borderRadius: theme.radii.base, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.sm, ...theme.shadows.button }, pressed && { opacity: 0.9 }]}
                  onPress={handleSubmit}
                  disabled={isCreating || isLoading}
                >
                  {isCreating || isLoading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: '#FFFFFF', letterSpacing: 0.3 }}>{initialData ? 'Güncelle' : t('addDebtModal.submit')}</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const DebtsScreen: React.FC = () => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [payTarget, setPayTarget] = useState<Debt | null>(null);
  const [editTarget, setEditTarget] = useState<Debt | null>(null);
  const { debts, activeFilter, isLoading, setFilter, fetchDebts, deleteDebt } = useDebtStore();
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);

  useEffect(() => { fetchDebts(1).catch(() => { }); }, [fetchDebts]);

  const handleRowPress = useCallback((d: Debt) => {
    (navigation as any).navigate('ContactDetail', { contactName: d.entityName });
  }, [navigation]);

  const handleDelete = async (d: Debt) => {
    Alert.alert(
      'Emin misiniz?',
      'Bu borç kaydını silmek istediğinize emin misiniz?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Sil', style: 'destructive', onPress: async () => {
          try {
            await deleteDebt(d._id);
          } catch (e) {
            Alert.alert('Hata', 'Borç silinemedi');
          }
        }},
      ]
    );
  };

  const handleRowLongPress = useCallback((d: Debt) => {
    Alert.alert(
      'İşlem Seçin',
      `${d.entityName} için ne yapmak istersiniz?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Düzenle', onPress: () => { setEditTarget(d); setIsAddModalVisible(true); } },
        { text: 'Sil', style: 'destructive', onPress: () => handleDelete(d) },
      ]
    );
  }, []);

  const renderItem = useCallback(({ item, index }: { item: Debt; index: number }) => <DebtRow item={item} index={index} onPress={handleRowPress} onLongPress={handleRowLongPress} />, [handleRowPress, handleRowLongPress]);
  const keyExtractor = useCallback((item: Debt) => item._id, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.colors.primary} />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.lg, color: theme.colors.textPrimary, letterSpacing: 0.4 }}>{t('debts.title')}</Text>
        <Pressable hitSlop={12} onPress={() => setIsAddModalVisible(true)}>
          <Icon name="plus-circle" size={22} color={theme.colors.accent} />
        </Pressable>
      </View>
      <View style={[styles.segContainer, { paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.sm }]}>
        <SegmentedControl active={activeFilter} onChange={setFilter} />
      </View>
      <FlatList
        data={debts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={<SummaryHeader />}
        ListEmptyComponent={!isLoading ? <EmptyState /> : null}
        contentContainerStyle={[{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }, { paddingBottom: insets.bottom + theme.spacing['2xl'] }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.colors.border, marginLeft: 56 }} />}
        refreshing={isLoading}
        onRefresh={() => fetchDebts(1)}
      />
      <PaymentModal visible={!!payTarget} debt={payTarget} onClose={() => setPayTarget(null)} />
      <AddDebtModal visible={isAddModalVisible} initialData={editTarget} onClose={() => { setIsAddModalVisible(false); setEditTarget(null); }} />
    </View>
  );
};

// Static layout styles (non-color properties only)
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  segContainer: { },
  segWrap: { flexDirection: 'row', padding: 3 },
  segBtn: { flex: 1, alignItems: 'center' },
  listContent: { },
  separator: { height: 1, marginLeft: 56 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  summaryCol: { flexDirection: 'row', alignItems: 'center' },
  sDot: { width: 8, height: 8, borderRadius: 4 },
  summaryDivider: { width: 1, height: 32 },
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowMid: { flex: 1 },
  progressTrack: { height: 3, borderRadius: 1.5, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 1.5 },
  rowRight: { alignItems: 'flex-end' },
  paidBadge: { marginTop: 4, backgroundColor: 'rgba(16,185,129,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  paidText: { fontFamily: 'System', fontSize: 9, color: '#10B981', letterSpacing: 0.8 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.60)', justifyContent: 'flex-end' },
  modalHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center' },
  modalAmountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalInputWrap: { flexDirection: 'row', alignItems: 'center' },
  modalActions: { flexDirection: 'row' },
  modalBtn: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
  modalBtnOutline: {},
  modalCancel: { alignItems: 'center' },
  typeSelector: { flexDirection: 'row', padding: 4 },
  typeBtn: { flex: 1, alignItems: 'center' },
  typeBtnIncome: { backgroundColor: 'rgba(16,185,129,0.15)' },
  typeBtnExpense: { backgroundColor: 'rgba(248,113,113,0.15)' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center' },
  categoryPill: { },
  categoryPillActive: { backgroundColor: '#2563EB' },
  categoryTextActive: { color: '#FFFFFF' },
  cardOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.60)', justifyContent: 'center' },
  modalCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

export default DebtsScreen;