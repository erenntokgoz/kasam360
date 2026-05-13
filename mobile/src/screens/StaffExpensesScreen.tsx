import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Alert, TextInput, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { useStaffStore, Staff } from '../store/useStaffStore';
import type { Transaction } from '../api/transactionService';
import TransactionDetailModal from '../components/TransactionDetailModal';
import AddTransactionModal from '../components/AddTransactionModal';
import FilterBar from '../components/FilterBar';
import AddCard from '../components/AddCard';
import { useContactStore } from '../store/useContactStore';
import { formatCurrency, formatDate } from '../utils/format';
import { useTranslation } from 'react-i18next';

const PersonnelExpensesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { transactions: globalTransactions, deleteTransaction } = useLedgerStore();
  const { staffList, removeStaff, addStaff, fetchStaff } = useStaffStore();
  const { contacts } = useContactStore();
  
  const [localStaffExpenses, setLocalStaffExpenses] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  // Fetch transactions for Personel Gideri category
  const fetchStaffExpenses = useCallback(async () => {
    setIsLoading(true);
    try {
      const { getTransactions } = require('../api/transactionService');
      const result = await getTransactions(null, 100, { categories: ['Personel Gideri'] });
      if (!result || !Array.isArray(result.transactions)) {
        console.warn('[StaffExpensesScreen] fetchStaffExpenses: unexpected result shape', result);
        setLocalStaffExpenses([]);
        return;
      }
      setLocalStaffExpenses(result.transactions);
    } catch (e: any) {
      console.error('[StaffExpensesScreen] fetchStaffExpenses error:\n', e?.stack || e);
      setLocalStaffExpenses([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch staff directory with graceful error handling (DIRECTORYISNOTFOUND fix)
  const fetchStaffSafe = useCallback(async () => {
    try {
      setDirectoryError(null);
      await fetchStaff();
    } catch (e: any) {
      console.error('[StaffExpensesScreen] fetchStaff error:\n', e?.stack || e);
      setDirectoryError('Rehber Henüz Oluşturulmadı');
    }
  }, [fetchStaff]);

  React.useEffect(() => {
    fetchStaffSafe();
    fetchStaffExpenses();
  }, [fetchStaffSafe, fetchStaffExpenses]);

  // Refetch if global transactions add/update
  React.useEffect(() => {
    fetchStaffExpenses();
  }, [globalTransactions.length, fetchStaffExpenses]);
  
  const [activeTab, setActiveTab] = useState<'HISTORY' | 'DIRECTORY'>('HISTORY');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  
  const [dateFilter, setDateFilter] = useState<{start: Date | null, end: Date | null}>({ start: null, end: null });
  const [contactFilter, setContactFilter] = useState<string | null>(null);
  const [newStaffName, setNewStaffName] = useState('');

  // Filter local state
  const filteredPersonnelExpenses = useMemo(() => localStaffExpenses.filter(t => {
    if (contactFilter && !t.description?.toLowerCase().includes(contactFilter.toLowerCase())) return false;
    if (dateFilter.start) {
      const d = new Date(t.transactionDate || t.createdAt);
      if (d < dateFilter.start) return false;
    }
    if (dateFilter.end) {
      const d = new Date(t.transactionDate || t.createdAt);
      if (d > dateFilter.end) return false;
    }
    return true;
  }), [localStaffExpenses, contactFilter, dateFilter]);

  const totalSpent = useMemo(() => filteredPersonnelExpenses.reduce((sum, t) => sum + t.amount, 0), [filteredPersonnelExpenses]);

  const handleLongPressTx = (id: string) => {
    Alert.alert('İşlemi Sil', 'Bu personel giderini silmek istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => deleteTransaction(id) },
    ]);
  };

  const handleAddStaff = async () => {
    if (!newStaffName.trim()) return;
    try {
      await addStaff(newStaffName.trim());
      setNewStaffName('');
      Alert.alert('Başarılı', 'Personel rehbere eklendi.');
    } catch (e: any) {
      Alert.alert('Hata', e?.message || 'Personel eklenemedi.');
    }
  };

  const handleRemoveStaff = (id: string) => {
    Alert.alert('Personeli Sil', 'Bu personeli rehberden silmek istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeStaff(id) },
    ]);
  };

  const renderTxItem = ({ item }: { item: Transaction }) => (
    <View style={[styles.rowContainer, { backgroundColor: theme.colors.surface }]}>
      <Pressable
        style={styles.rowContent}
        onPress={() => setSelectedTx(item)}
        onLongPress={() => handleLongPressTx(item._id)}
      >
        <View style={[styles.rowIconCircle, { backgroundColor: theme.colors.dangerTransparent }]}>
          <Icon name="user" size={16} color={theme.colors.dangerLight} />
        </View>
        <View style={styles.rowMiddle}>
          <Text style={[styles.rowCategory, { color: theme.colors.textPrimary }]} numberOfLines={1}>
            {item.description || 'Personel Ödemesi'}
          </Text>
          <Text style={[styles.rowFreq, { color: theme.colors.textTertiary }]}>{formatDate(item.transactionDate || item.createdAt)}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.rowAmount, { color: theme.colors.dangerLight }]}>{formatCurrency(item.amount, true)}</Text>
        </View>
      </Pressable>
    </View>
  );

  const renderStaffItem = ({ item }: { item: Staff }) => (
    <Pressable 
      style={[styles.staffCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
      onPress={() => navigation.navigate('ContactDetail', { contactName: item.name, contactId: item.id })}
    >
      <View style={styles.staffHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[styles.staffIcon, { backgroundColor: theme.colors.accentTransparent }]}>
            <Icon name="user" size={20} color={theme.colors.accent} />
          </View>
          <View>
            <Text style={[styles.staffName, { color: theme.colors.textPrimary }]}>{item.name}</Text>
            {item.role && <Text style={[styles.staffRole, { color: theme.colors.textSecondary }]}>{item.role}</Text>}
          </View>
        </View>
        {/* MODÜL 4: onStartShouldSetResponder stops touch from propagating to parent card */}
        <View
          style={{ flexDirection: 'row', gap: 12 }}
          onStartShouldSetResponder={() => true}
        >
          <Pressable
            hitSlop={16}
            onPress={(e) => {
              e.stopPropagation?.();
              Alert.alert('Personeli Düzenle', `"${item.name}" için düzenleme yakında eklenecek.`);
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="edit-2" size={18} color={theme.colors.textSecondary} />
          </Pressable>
          <Pressable
            hitSlop={16}
            onPress={(e) => {
              e.stopPropagation?.();
              handleRemoveStaff(item.id);
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="trash-2" size={18} color={theme.colors.dangerLight} />
          </Pressable>
        </View>
      </View>
      <View style={[styles.staffFooter, { borderTopColor: theme.colors.border }]}>
        <Text style={{ fontSize: 12, color: theme.colors.textTertiary, fontWeight: '500' }}>TOPLAM ÖDENEN</Text>
        <Text style={{ fontSize: 14, color: theme.colors.success, fontWeight: '700' }}>{formatCurrency(item.totalPaid)}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.primary }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Personel Yönetimi</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.tabs, { backgroundColor: theme.colors.surface }]}>
        <Pressable style={[styles.tab, activeTab === 'HISTORY' && { backgroundColor: theme.colors.accent }]} onPress={() => setActiveTab('HISTORY')}>
          <Text style={[styles.tabText, { color: activeTab === 'HISTORY' ? '#fff' : theme.colors.textSecondary }]}>Gider Geçmişi</Text>
        </Pressable>
        <Pressable style={[styles.tab, activeTab === 'DIRECTORY' && { backgroundColor: theme.colors.accent }]} onPress={() => setActiveTab('DIRECTORY')}>
          <Text style={[styles.tabText, { color: activeTab === 'DIRECTORY' ? '#fff' : theme.colors.textSecondary }]}>Personel Rehberi</Text>
        </Pressable>
      </View>
      
      {activeTab === 'HISTORY' ? (
        <FlatList
          data={filteredPersonnelExpenses}
          renderItem={renderTxItem}
          keyExtractor={(item) => item._id}
          ListHeaderComponent={(
            <View style={{ marginBottom: 20 }}>
              <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card, marginBottom: 16 }]}>
                <Text style={{ fontSize: 12, color: theme.colors.textTertiary, fontWeight: '600', marginBottom: 4 }}>TOPLAM PERSONEL GİDERİ</Text>
                <Text style={{ fontSize: 24, color: theme.colors.danger, fontWeight: '700' }}>{formatCurrency(totalSpent)}</Text>
              </View>

              <FilterBar 
                onDateChange={(start, end) => setDateFilter({ start, end })}
                onContactChange={setContactFilter}
              />

              <View style={{ marginTop: 16 }}>
                <AddCard 
                  title="Yeni Personel Gideri Ekle" 
                  subtitle="Personel maaş veya avans ödemesi yapın" 
                  icon="plus-circle" 
                  onPress={() => setShowAddModal(true)} 
                />
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing.xl }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing['3xl'], gap: theme.spacing.sm }}>
              <Icon name="list" size={48} color={theme.colors.textTertiary} />
              <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.lg, color: theme.colors.textSecondary, marginTop: theme.spacing.base }}>Kayıt Bulunamadı</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={staffList}
          renderItem={renderStaffItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={(
            <View style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 8 }}>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.colors.surface, color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
                  placeholder="Personel Adı Soyadı"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={newStaffName}
                  onChangeText={setNewStaffName}
                />
                <Pressable style={[styles.addStaffBtn, { backgroundColor: theme.colors.accent }]} onPress={handleAddStaff}>
                  <Icon name="plus" size={20} color="#fff" />
                </Pressable>
              </View>

              {/* Contact Suggestions */}
              {newStaffName.length > 1 && (
                <View style={[styles.suggestionBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  {contacts
                    .filter(c => c.name.toLowerCase().includes(newStaffName.toLowerCase()) && !staffList.find(s => s.name === c.name))
                    .slice(0, 3)
                    .map(contact => (
                      <Pressable 
                        key={contact.id} 
                        style={styles.suggestionItem}
                        onPress={() => {
                          addStaff(contact.name);
                          setNewStaffName('');
                        }}
                      >
                        <Icon name="user-plus" size={14} color={theme.colors.accent} />
                        <Text style={{ color: theme.colors.textPrimary, marginLeft: 8 }}>{contact.name} (Rehberden Ekle)</Text>
                      </Pressable>
                    ))
                  }
                </View>
              )}
            </View>
          )}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.xl }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            directoryError ? (
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIconCircle, { backgroundColor: theme.colors.warningTransparent }]}>
                  <Icon name="alert-circle" size={40} color={theme.colors.warning} />
                </View>
                <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>{directoryError}</Text>
                <Text style={[styles.emptySubtitle, { color: theme.colors.textTertiary }]}>
                  Yukarıdan personel adı yazarak rehberi oluşturmaya başlayabilirsiniz.
                </Text>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIconCircle, { backgroundColor: theme.colors.accentTransparent }]}>
                  <Icon name="users" size={40} color={theme.colors.accent} />
                </View>
                <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>Personel Rehberi Boş</Text>
                <Text style={[styles.emptySubtitle, { color: theme.colors.textTertiary }]}>
                  Henüz personel kaydı yapmadınız. Yukarıdan isim yazarak veya rehberden seçerek ekleyebilirsiniz.
                </Text>
              </View>
            )
          }
        />
      )}

      <AddTransactionModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        initialType="GİDER"
        initialSubType="Personel Gideri"
      />

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
  headerTitle: { fontSize: 18, fontWeight: '700' },
  tabs: { flexDirection: 'row', padding: 4, marginHorizontal: 20, marginTop: 16, borderRadius: 12, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabText: { fontSize: 14, fontWeight: '600' },
  rowContainer: { borderRadius: 10, marginBottom: 12 },
  rowContent: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  rowIconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1, marginRight: 8 },
  rowCategory: { fontSize: 15, marginBottom: 4, fontWeight: '500' },
  rowFreq: { fontSize: 12 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 15, letterSpacing: -0.3, fontWeight: '600' },
  summaryCard: { borderRadius: 20, padding: 24, marginBottom: 24 },
  staffCard: { borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  staffHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  staffIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  staffName: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  staffRole: { fontSize: 13 },
  staffFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
  input: { flex: 1, height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 15 },
  addStaffBtn: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  suggestionBox: { borderWidth: 1, borderRadius: 12, overflow: 'hidden', marginTop: 4 },
  suggestionItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.05)' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 40 },
  emptyIconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});

export default PersonnelExpensesScreen;
