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

// ─── Debt Row Component ──────────────────────────────────────────────────────

const DebtRow: React.FC<{ item: Debt; index: number; onPress: (d: Debt) => void; onPay: (d: Debt) => void }> = React.memo(({ item, onPress, onPay }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const isGiven = item.type === 'GIVEN';
  const accent = isGiven ? theme.colors.success : theme.colors.danger;
  const iconBg = isGiven ? theme.colors.successTransparent : theme.colors.dangerTransparent;
  const paid = item.status === 'PAID';
  const progress = item.totalAmount > 0 ? 1 - item.remainingAmount / item.totalAmount : 0;

  return (
    <Pressable style={[styles.rowWrap, { backgroundColor: theme.colors.surface }]} activeOpacity={0.7} onPress={() => onPress(item)}>
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        <Icon name={isGiven ? 'arrow-down-left' : 'arrow-up-right'} size={18} color={accent} />
      </View>
      <View style={styles.rowMid}>
        <Text style={[styles.rowName, { color: theme.colors.textPrimary }]} numberOfLines={1}>{item.entityName}</Text>
        <Text style={[styles.rowDue, { color: theme.colors.textTertiary }]}>{item.dueDate ? `Vade: ${formatDate(item.dueDate)}` : 'Vade tarihi yok'}</Text>
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: accent }]} />
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowRemaining, { color: paid ? theme.colors.textTertiary : accent }]}>{formatCurrency(item.remainingAmount)}</Text>
        <Pressable style={[styles.payBadge, { backgroundColor: accent }]} onPress={() => onPay(item)}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{isGiven ? 'TAHSİL' : 'ÖDE'}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
});

// ─── Add Debt Modal ─────────────────────────────────────────────────────────

const AddDebtModal: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const { addDebt, isCreating } = useDebtStore();
  const { addTransaction } = useLedgerStore();
  
  const [type, setType] = useState<DebtType>('TAKEN');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  const handleSave = async () => {
    if (!name || !amount) { Alert.alert('Hata', 'Lütfen isim ve tutar giriniz.'); return; }
    const val = parseFloat(amount.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert('Hata', 'Geçersiz tutar.'); return; }
    
    try {
      const cents = Math.round(val * 100);
      await addDebt({
        entityName: name,
        type: type,
        totalAmount: cents,
        dueDate: dueDate || undefined,
      });

      // Also create a transaction as requested: "HER BORÇ BİR GİDER HER ALACAK BİR GELİR"
      // Wait, if I TAKE a debt (Borç), it should be recorded as Expense? 
      // User said: "HER BORÇ BİR GİDER HER ALACAK BİR GELİR"
      await addTransaction({
        type: type === 'TAKEN' ? 'EXPENSE' : 'INCOME',
        amount: cents,
        category: type === 'TAKEN' ? 'Alınan Borç' : 'Verilen Borç (Alacak)',
        description: `${name}: ${description}`,
        method: 'CASH'
      });

      Alert.alert('Başarılı', 'Kayıt oluşturuldu.');
      onClose();
      // Reset
      setName(''); setAmount(''); setDescription(''); setDueDate('');
    } catch (err) {
      Alert.alert('Hata', 'Kayıt oluşturulamadı.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>Yeni Borç/Alacak Ekle</Text>
          
          <View style={styles.typeSelector}>
            <Pressable style={[styles.typeBtn, type === 'TAKEN' && { backgroundColor: theme.colors.danger }]} onPress={() => setType('TAKEN')}>
              <Text style={[styles.typeBtnText, type === 'TAKEN' ? { color: '#fff' } : { color: theme.colors.textSecondary }]}>BORÇ ALDIM</Text>
            </Pressable>
            <Pressable style={[styles.typeBtn, type === 'GIVEN' && { backgroundColor: theme.colors.success }]} onPress={() => setType('GIVEN')}>
              <Text style={[styles.typeBtnText, type === 'GIVEN' ? { color: '#fff' } : { color: theme.colors.textSecondary }]}>ALACAKLIYIM</Text>
            </Pressable>
          </View>

          <TextInput style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]} placeholder="Kime / Kimden" placeholderTextColor={theme.colors.textTertiary} value={name} onChangeText={setName} />
          <TextInput style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]} placeholder="Tutar (₺)" placeholderTextColor={theme.colors.textTertiary} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <TextInput style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]} placeholder="Açıklama" placeholderTextColor={theme.colors.textTertiary} value={description} onChangeText={setDescription} />
          <TextInput style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]} placeholder="Vade Tarihi (YYYY-MM-DD)" placeholderTextColor={theme.colors.textTertiary} value={dueDate} onChangeText={setDueDate} />

          <View style={styles.modalActions}>
            <Pressable style={[styles.modalBtn, { backgroundColor: theme.colors.card }]} onPress={onClose}><Text style={{ color: theme.colors.textPrimary }}>İptal</Text></Pressable>
            <Pressable style={[styles.modalBtn, { backgroundColor: theme.colors.accent }]} onPress={handleSave} disabled={isCreating}>
              {isCreating ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff' }}>Kaydet</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ─── Payment Modal ──────────────────────────────────────────────────────────

const PaymentModal: React.FC<{ visible: boolean; debt: Debt | null; onClose: () => void }> = ({ visible, debt, onClose }) => {
  const [input, setInput] = useState('');
  const { makePayment, isPaying } = useDebtStore();
  const refreshLedger = useLedgerStore((s) => s.refreshLedger);
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  const handlePay = async (full = false) => {
    if (!debt) return;
    const val = full ? debt.remainingAmount / 100 : parseFloat(input.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert('Geçersiz Tutar'); return; }
    const cents = full ? debt.remainingAmount : Math.round(val * 100);
    
    try {
      await makePayment(debt._id, cents);
      await refreshLedger();
      Alert.alert('Başarılı', 'Ödeme kaydedildi.');
      onClose();
    } catch { Alert.alert('Hata', 'Ödeme başarısız.'); }
  };

  if (!debt) return null;
  const isGiven = debt.type === 'GIVEN';
  const accent = isGiven ? theme.colors.success : theme.colors.danger;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={[styles.modalOverlay, { backgroundColor: theme.colors.overlay }]}>
        <View style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>{isGiven ? 'Tahsilat Yap' : 'Ödeme Yap'}</Text>
          <Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginBottom: 20 }}>{debt.entityName} - Kalan: {formatCurrency(debt.remainingAmount)}</Text>
          
          <TextInput style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]} placeholder="Tutar" keyboardType="decimal-pad" value={input} onChangeText={setInput} autoFocus />
          
          <View style={styles.modalActions}>
            <Pressable style={[styles.modalBtn, { backgroundColor: theme.colors.card }]} onPress={onClose}><Text style={{ color: theme.colors.textPrimary }}>Vazgeç</Text></Pressable>
            <Pressable style={[styles.modalBtn, { backgroundColor: accent }]} onPress={() => handlePay(false)} disabled={isPaying}>
              {isPaying ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff' }}>Öde</Text>}
            </Pressable>
          </View>
          <Pressable style={{ marginTop: 12, alignItems: 'center' }} onPress={() => handlePay(true)}>
            <Text style={{ color: theme.colors.accent }}>Tamamını Kapat</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

const DebtsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [payTarget, setPayTarget] = useState<Debt | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const { debts, activeFilter, isLoading, setFilter, fetchDebts, summary } = useDebtStore();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  useEffect(() => { fetchDebts(1).catch(() => { }); }, [fetchDebts]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={[styles.header, { paddingHorizontal: 24, paddingVertical: 16 }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Borçlar & Alacaklar</Text>
        <Pressable hitSlop={12} onPress={() => setShowAdd(true)}>
          <Icon name="plus-circle" size={24} color={theme.colors.accent} />
        </Pressable>
      </View>

      <View style={styles.summaryContainer}>
        <View style={[styles.summaryBox, { backgroundColor: theme.colors.surface }]}>
          <Text style={styles.summaryLabel}>ALACAKLAR</Text>
          <Text style={[styles.summaryVal, { color: theme.colors.success }]}>{formatCurrency(summary?.given.remaining || 0)}</Text>
        </View>
        <View style={[styles.summaryBox, { backgroundColor: theme.colors.surface }]}>
          <Text style={styles.summaryLabel}>BORÇLAR</Text>
          <Text style={[styles.summaryVal, { color: theme.colors.danger }]}>{formatCurrency(summary?.taken.remaining || 0)}</Text>
        </View>
      </View>

      <FlatList
        data={debts}
        renderItem={({ item, index }) => <DebtRow item={item} index={index} onPress={(d) => navigation.navigate('ContactDetail' as any, { contactName: d.entityName })} onPay={setPayTarget} />}
        keyExtractor={(item) => item._id}
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshing={isLoading}
        onRefresh={() => fetchDebts(1)}
        ListEmptyComponent={!isLoading ? <Text style={{ textAlign: 'center', marginTop: 40, opacity: 0.5 }}>Kayıt bulunamadı</Text> : null}
      />

      <AddDebtModal visible={showAdd} onClose={() => setShowAdd(false)} />
      <PaymentModal visible={!!payTarget} debt={payTarget} onClose={() => setPayTarget(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  summaryContainer: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginBottom: 12 },
  summaryBox: { flex: 1, padding: 16, borderRadius: 16, alignItems: 'center', elevation: 2 },
  summaryLabel: { fontSize: 10, fontWeight: '700', opacity: 0.5, marginBottom: 4 },
  summaryVal: { fontSize: 18, fontWeight: '700' },
  rowWrap: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 12, elevation: 1 },
  rowIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMid: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowDue: { fontSize: 12, marginTop: 2, marginBottom: 8 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  rowRight: { alignItems: 'flex-end', gap: 8 },
  rowRemaining: { fontSize: 16, fontWeight: '700' },
  payBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalSheet: { borderRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  typeSelector: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  typeBtn: { flex: 1, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  typeBtnText: { fontSize: 12, fontWeight: '700' },
  input: { height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, marginBottom: 12, fontSize: 15 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalBtn: { flex: 1, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }
});

export default DebtsScreen;