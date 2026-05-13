import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, ActivityIndicator, Modal, TextInput, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useDebtStore, type Debt } from '../store/useDebtStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { formatCurrency, formatDate } from '../utils/format';
import AddTransactionModal from '../components/AddTransactionModal';
import DebtDetailModal from '../components/DebtDetailModal';
import FilterBar from '../components/FilterBar';
import AddCard from '../components/AddCard';

// --- Payment Modal (Repayment logic) ---
export const PaymentModal: React.FC<{ visible: boolean; debt: any | null; onClose: () => void }> = ({ visible, debt, onClose }) => {
  const [input, setInput] = useState('');
  const [method, setMethod] = useState<'CASH' | 'POS' | 'IBAN'>('CASH');
  const { makePayment, isPaying } = useDebtStore();
  const fetchTransactions = useLedgerStore((s) => s.fetchTransactions);
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  const handlePay = async (full = false) => {
    if (!debt) return;
    const val = full ? debt.remainingAmount / 100 : parseFloat(input.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert('Geçersiz Tutar'); return; }
    const cents = full ? debt.remainingAmount : Math.round(val * 100);
    
    try {
      await makePayment(debt._id, cents, method);
      await fetchTransactions(null);
      Alert.alert('Başarılı', 'Ödeme kaydedildi.');
      onClose();
    } catch { Alert.alert('Hata', 'Ödeme başarısız.'); }
  };

  if (!debt) return null;
  const isGiven = debt.type === 'GIVEN';
  const accent = isGiven ? theme.colors.success : theme.colors.danger;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 20, color: theme.colors.textPrimary }}>{isGiven ? 'Tahsilat Yap' : 'Ödeme Yap'}</Text>
          <Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginBottom: 12 }}>{debt.entityName} - Kalan: {formatCurrency(debt.remainingAmount)}</Text>
          
          <TextInput 
            style={{ height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, fontSize: 15, color: theme.colors.textPrimary, borderColor: theme.colors.border }} 
            placeholder="Tutar" 
            keyboardType="decimal-pad" 
            value={input} 
            onChangeText={setInput} 
            autoFocus 
          />

          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary, marginBottom: 8 }}>Ödeme Yöntemi</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
            {[
              { id: 'CASH', label: 'Nakit', icon: 'dollar-sign' },
              { id: 'POS', label: 'POS', icon: 'credit-card' },
              { id: 'IBAN', label: 'Havale', icon: 'send' },
            ].map((m) => (
              <Pressable 
                key={m.id}
                onPress={() => setMethod(m.id as any)}
                style={{ 
                  flex: 1, 
                  height: 40, 
                  borderRadius: 10, 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: 6,
                  borderWidth: 1,
                  borderColor: method === m.id ? accent : theme.colors.border,
                  backgroundColor: method === m.id ? accent + '10' : 'transparent'
                }}
              >
                <Icon name={m.icon} size={14} color={method === m.id ? accent : theme.colors.textTertiary} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: method === m.id ? accent : theme.colors.textSecondary }}>{m.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable style={{ flex: 1, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.card }} onPress={onClose}><Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Vazgeç</Text></Pressable>
              <Pressable style={{ flex: 1, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: accent }} onPress={() => handlePay(false)} disabled={isPaying}>
                {isPaying ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>Kısmi Öde</Text>}
              </Pressable>
            </View>
            <Pressable style={{ height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.accentTransparent, borderWidth: 1, borderColor: theme.colors.accent }} onPress={() => handlePay(true)} disabled={isPaying}>
              {isPaying ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>Tamamını Kapat</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const DebtRow: React.FC<{ item: Debt; onPay: (d: Debt) => void; onPress: (d: Debt) => void }> = ({ item, onPay, onPress }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const isGiven = item.type === 'GIVEN';
  const color = isGiven ? theme.colors.success : theme.colors.danger;
  const progress = item.totalAmount > 0 ? 1 - item.remainingAmount / item.totalAmount : 0;
  
  return (
    <Pressable style={[styles.rowContainer, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]} onPress={() => onPress(item)}>
      <View style={styles.rowTop}>
        <View style={[styles.rowIconCircle, { backgroundColor: color + '15' }]}>
          <Icon name={isGiven ? 'arrow-up-right' : 'arrow-down-left'} size={18} color={color} />
        </View>
        <View style={styles.rowMiddle}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.rowName, { color: theme.colors.textPrimary }]}>{item.entityName}</Text>
            {item.status === 'OVERDUE' && (
              <View style={{ backgroundColor: theme.colors.dangerTransparent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: theme.colors.danger }}>GECİKMİŞ</Text>
              </View>
            )}
          </View>
          <Text style={[styles.rowDate, { color: theme.colors.textTertiary }]}>Vade: {item.dueDate ? formatDate(item.dueDate) : 'Yok'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.rowAmount, { color }]}>{formatCurrency(item.remainingAmount, true)}</Text>
          <Text style={[styles.rowStatus, { color: theme.colors.textTertiary }]}>{isGiven ? 'ALACAK' : 'BORÇ'}</Text>
        </View>
      </View>
      
      <View style={styles.progressSection}>
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: color }]} />
        </View>
        <Pressable 
          style={[styles.payActionBtn, { borderColor: color }]} 
          onPress={() => onPay(item)}
        >
          <Text style={[styles.payActionText, { color }]}>{isGiven ? 'Tahsil Et' : 'Ödeme Yap'}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
};

import { useTranslation } from 'react-i18next';

const DebtsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const { t } = useTranslation();
  const { debts, isLoading, fetchDebts, summary } = useDebtStore();
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'PAST'>('ACTIVE');
  const [showAddModal, setShowAddModal] = useState(false);
  const [payTarget, setPayTarget] = useState<Debt | null>(null);
  const [selectedDebt, setSelectedDebt] = useState<Debt | null>(null);
  
  const [dateFilter, setDateFilter] = useState<{start: Date | null, end: Date | null}>({ start: null, end: null });
  const [contactFilter, setContactFilter] = useState<string | null>(null);

  useEffect(() => { fetchDebts(1).catch(() => {}); }, [fetchDebts]);

  const filteredDebts = debts.filter(d => {
    if (activeTab === 'ACTIVE' && d.status === 'PAID') return false;
    if (activeTab === 'PAST' && d.status !== 'PAID') return false;
    
    if (contactFilter && d.entityName !== contactFilter) return false;
    if (dateFilter.start) {
      const dDate = new Date(d.createdAt);
      if (dDate < dateFilter.start) return false;
    }
    if (dateFilter.end) {
      const dDate = new Date(d.createdAt);
      if (dDate > dateFilter.end) return false;
    }
    return true;
  });

  const totalGiven = summary?.given.remaining || 0;
  const totalTaken = summary?.taken.remaining || 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.primary }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Alacak & Borçlar</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.tabs, { backgroundColor: theme.colors.surface }]}>
        <Pressable style={[styles.tab, activeTab === 'ACTIVE' && { backgroundColor: theme.colors.accent }]} onPress={() => setActiveTab('ACTIVE')}>
          <Text style={[styles.tabText, { color: activeTab === 'ACTIVE' ? '#fff' : theme.colors.textSecondary }]}>Aktif Kayıtlar</Text>
        </Pressable>
        <Pressable style={[styles.tab, activeTab === 'PAST' && { backgroundColor: theme.colors.accent }]} onPress={() => setActiveTab('PAST')}>
          <Text style={[styles.tabText, { color: activeTab === 'PAST' ? '#fff' : theme.colors.textSecondary }]}>Geçmiş Kayıtlar</Text>
        </Pressable>
      </View>

      <FlatList
        data={filteredDebts}
        renderItem={({ item }) => <DebtRow item={item} onPay={setPayTarget} onPress={setSelectedDebt} />}
        keyExtractor={(item) => item._id}
        ListHeaderComponent={(
          <View style={{ marginBottom: 24 }}>
            {activeTab === 'ACTIVE' && (
              <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card, marginBottom: 16 }]}>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryMetric}>
                    <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Toplam Alacak</Text>
                    <Text style={[styles.summaryMetricValue, { color: theme.colors.success }]}>{formatCurrency(totalGiven)}</Text>
                  </View>
                  <View style={[styles.summaryDivider, { backgroundColor: theme.colors.border }]} />
                  <View style={styles.summaryMetric}>
                    <Text style={[styles.summaryMetricLabel, { color: theme.colors.textTertiary }]}>Toplam Borç</Text>
                    <Text style={[styles.summaryMetricValue, { color: theme.colors.danger }]}>{formatCurrency(totalTaken)}</Text>
                  </View>
                </View>
              </View>
            )}
            
            <FilterBar 
              onDateChange={(start, end) => setDateFilter({ start, end })}
              onContactChange={setContactFilter}
            />

            <View style={{ marginTop: 16 }}>
              <AddCard 
                title="Yeni Borç/Alacak Ekle" 
                subtitle="Bir kişiye borç verin veya borç alın" 
                icon="plus-circle" 
                onPress={() => setShowAddModal(true)} 
              />
            </View>
          </View>
        )}
        ListEmptyComponent={!isLoading ? <Text style={styles.emptyText}>Sonuç bulunamadı</Text> : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        onRefresh={() => fetchDebts(1)}
        refreshing={isLoading}
      />

      <AddTransactionModal 
        visible={showAddModal} 
        onClose={() => { setShowAddModal(false); fetchDebts(1); }} 
        initialType="BORÇ"
      />
      {selectedDebt && (
        <DebtDetailModal
          visible={!!selectedDebt}
          debt={selectedDebt}
          onClose={() => setSelectedDebt(null)}
          onPay={setPayTarget}
        />
      )}
      {payTarget && (
        <PaymentModal 
          visible={!!payTarget} 
          debt={payTarget} 
          onClose={() => { setPayTarget(null); fetchDebts(1); }} 
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  tabs: { flexDirection: 'row', padding: 4, marginHorizontal: 20, marginTop: 16, borderRadius: 12, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabText: { fontSize: 14, fontWeight: '600' },
  listContent: { paddingHorizontal: 20, paddingTop: 16 },
  summaryCard: { borderRadius: 24, padding: 20 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryMetric: { flex: 1, alignItems: 'center' },
  summaryMetricLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  summaryMetricValue: { fontSize: 18, fontWeight: '700' },
  summaryDivider: { width: 1, height: 30, marginHorizontal: 10 },
  rowContainer: { padding: 16, borderRadius: 20, marginBottom: 16 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  rowIconCircle: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowDate: { fontSize: 12, marginTop: 2 },
  rowAmount: { fontSize: 16, fontWeight: '700' },
  rowStatus: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  progressSection: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  payActionBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  payActionText: { fontSize: 11, fontWeight: '700' },
  emptyText: { textAlign: 'center', marginTop: 40, opacity: 0.5 }
});

export default DebtsScreen;
