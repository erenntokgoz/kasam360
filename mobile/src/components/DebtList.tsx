import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, Modal, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useDebtStore } from '../store/useDebtStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { theme } from '../theme';
import { SafeIcon } from './SafeIcon';
import type { Debt, DebtType } from '../api/debtService';

interface DebtListProps {
  type: DebtType;
}

const formatCurrency = (cents: number): string => {
  return `₺${(cents / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
};

const DebtRow: React.FC<{ item: Debt; onPress: (d: Debt) => void }> = React.memo(({ item, onPress }) => {
  const isGiven = item.type === 'GIVEN';
  const color = isGiven ? theme.colors.success : theme.colors.danger;
  const isPaid = item.status === 'PAID';

  return (
    <Pressable style={styles.rowContainer} onPress={() => onPress(item)}>
      <View style={styles.rowMiddle}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.entityName}
        </Text>
        <Text style={styles.rowDate}>VADE: {formatDate(item.dueDate)}</Text>
      </View>

      <View style={styles.rowRight}>
        <Text style={[styles.rowRemaining, { color: isPaid ? theme.colors.textTertiary : color }]}>
          {formatCurrency(item.remainingAmount)}
        </Text>
        <Text style={styles.rowTotal}>/ {formatCurrency(item.totalAmount)}</Text>
      </View>
    </Pressable>
  );
});

export const DebtList: React.FC<DebtListProps> = ({ type }) => {
  const { debts, isLoading, fetchDebts, makePayment, isPaying } = useDebtStore();
  const refreshLedger = useLedgerStore((s) => s.refreshLedger);
  const [payTarget, setPayTarget] = useState<Debt | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');

  useEffect(() => {
    fetchDebts(1, 100).catch(() => {});
  }, [fetchDebts]);

  const filteredData = debts.filter(d => d.type === type);

  const handlePay = async () => {
    if (!payTarget) return;
    const val = parseFloat(paymentAmount.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      Alert.alert('Hata', 'Geçerli bir tutar girin.');
      return;
    }
    const cents = Math.round(val * 100);
    if (cents > payTarget.remainingAmount) {
      Alert.alert('Hata', 'Tutar kalan bakiyeden fazla olamaz.');
      return;
    }

    try {
      await makePayment(payTarget._id, cents);
      refreshLedger().catch(() => {});
      Alert.alert('Başarılı', 'Ödeme kaydedildi.');
      setPayTarget(null);
      setPaymentAmount('');
    } catch (err: any) {
      Alert.alert('Hata', err.message || 'Ödeme kaydedilemedi.');
    }
  };

  const renderItem = useCallback(
    ({ item }: { item: Debt }) => <DebtRow item={item} onPress={setPayTarget} />,
    []
  );

  if (isLoading && filteredData.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={filteredData}
        renderItem={renderItem}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onRefresh={() => fetchDebts(1, 100)}
        refreshing={isLoading}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>KAYIT BULUNAMADI</Text>
          </View>
        }
      />

      <Modal visible={!!payTarget} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{type === 'TAKEN' ? 'BORÇ ÖDE' : 'TAHSİLAT YAP'}</Text>
            <Text style={styles.modalSub}>{payTarget?.entityName}</Text>
            
            <View style={styles.inputWrap}>
              <Text style={styles.currency}>₺</Text>
              <TextInput
                style={styles.input}
                value={paymentAmount}
                onChangeText={setPaymentAmount}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor={theme.colors.textTertiary}
                autoFocus
              />
            </View>

            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setPayTarget(null)}>
                <Text style={styles.cancelBtnText}>İPTAL</Text>
              </Pressable>
              <Pressable style={styles.payBtn} onPress={handlePay} disabled={isPaying}>
                {isPaying ? <ActivityIndicator color="#000000" /> : <Text style={styles.payBtnText}>KAYDET</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: 100,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowMiddle: {
    flex: 1,
    marginRight: theme.spacing.md,
  },
  rowName: {
    fontSize: theme.fontSizes.base,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    color: theme.colors.textPrimary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  rowDate: {
    fontSize: theme.fontSizes.xs,
    fontFamily: theme.fonts.light,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  rowRemaining: {
    fontSize: theme.fontSizes.lg,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
  },
  rowTotal: {
    fontSize: theme.fontSizes.xs,
    fontFamily: theme.fonts.light,
    color: theme.colors.textTertiary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyText: {
    color: theme.colors.textTertiary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.primary,
    borderTopWidth: 2,
    borderColor: theme.colors.accent,
    padding: 30,
  },
  modalTitle: {
    color: theme.colors.accent,
    fontSize: 24,
    fontFamily: theme.fonts.black,
    textAlign: 'center',
  },
  modalSub: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 30,
    textTransform: 'uppercase',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderColor: theme.colors.textPrimary,
    marginBottom: 40,
  },
  currency: {
    color: theme.colors.textPrimary,
    fontSize: 32,
    fontWeight: '900',
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 48,
    fontWeight: '900',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 15,
  },
  cancelBtn: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.textTertiary,
  },
  cancelBtnText: {
    color: theme.colors.textTertiary,
    fontWeight: '900',
  },
  payBtn: {
    flex: 1,
    backgroundColor: theme.colors.accent,
    padding: 16,
    alignItems: 'center',
  },
  payBtnText: {
    color: '#000000',
    fontWeight: '900',
  },
});
