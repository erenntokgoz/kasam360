import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Alert, TextInput } from 'react-native';
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
import { EmptyState } from '../components/EmptyState';
import { SwipeRow } from '../components/SwipeRow';
import { formatCurrency, formatDate } from '../utils/format';
import { useTranslation } from 'react-i18next';

const PersonalExpensesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { t } = useTranslation();
  const { transactions, deleteTransaction, fetchTransactions } = useLedgerStore();
  
  React.useEffect(() => {
    fetchTransactions(null, 20, { categories: ['Kişisel Gider'] });
  }, []);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  
  const [dateFilter, setDateFilter] = useState<{start: Date | null, end: Date | null}>({ start: null, end: null });
  const [contactFilter, setContactFilter] = useState<string | null>(null);

  // Filter only personal expenses
  const filteredExpenses = useMemo(() => transactions.filter(t => {
    if (t.category !== 'Kişisel Gider') return false;
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
  }), [transactions, contactFilter, dateFilter]);

  const totalSpent = useMemo(() => filteredExpenses.reduce((sum, t) => sum + t.amount, 0), [filteredExpenses]);

  const monthlySpent = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return filteredExpenses
      .filter(t => new Date(t.transactionDate || t.createdAt) >= startOfMonth)
      .reduce((sum, t) => sum + t.amount, 0);
  }, [filteredExpenses]);

  const handleLongPressTx = (id: string) => {
    Alert.alert('İşlemi Sil', 'Bu kişisel gideri silmek istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => deleteTransaction(id) },
    ]);
  };

  const renderTxItem = ({ item }: { item: Transaction }) => (
    <SwipeRow onDelete={() => handleLongPressTx(item._id)}>
      <View style={[styles.rowContainer, { backgroundColor: theme.colors.surface, marginBottom: 0 }]}>
        <Pressable
          style={styles.rowContent}
          onPress={() => setSelectedTx(item)}
        >
          <View style={[styles.rowIconCircle, { backgroundColor: theme.colors.warningTransparent }]}>
            <Icon name="user" size={16} color={theme.colors.warning} />
          </View>
          <View style={styles.rowMiddle}>
            <Text style={[styles.rowCategory, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              {item.description || 'Kişisel Harcama'}
            </Text>
            <Text style={[styles.rowFreq, { color: theme.colors.textTertiary }]}>{formatDate(item.transactionDate || item.createdAt)}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowAmount, { color: theme.colors.dangerLight }]}>{formatCurrency(item.amount, true)}</Text>
          </View>
        </Pressable>
      </View>
    </SwipeRow>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.primary }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Kişisel Giderler</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={filteredExpenses}
        renderItem={renderTxItem}
        keyExtractor={(item) => item._id}
        ListHeaderComponent={(
          <View style={{ marginBottom: 20 }}>
            <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card, marginBottom: 16 }]}>
              <View>
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary, fontWeight: '700', marginBottom: 2 }}>TOPLAM KİŞİSEL GİDER</Text>
                <Text style={{ fontSize: 24, color: theme.colors.warning, fontWeight: '800' }}>{formatCurrency(totalSpent)}</Text>
              </View>
              <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 12, opacity: 0.5 }} />
              <View>
                <Text style={{ fontSize: 11, color: theme.colors.textTertiary, fontWeight: '700', marginBottom: 2 }}>BU AY</Text>
                <Text style={{ fontSize: 18, color: theme.colors.textSecondary, fontWeight: '700' }}>{formatCurrency(monthlySpent)}</Text>
              </View>
            </View>

            <FilterBar 
              onDateChange={(start, end) => setDateFilter({ start, end })}
              onContactChange={setContactFilter}
            />

            <View style={{ marginTop: 16 }}>
              <AddCard 
                title="Yeni Kişisel Gider Ekle" 
                subtitle="Kişisel harcamalarınızı kaydedin" 
                icon="plus-circle" 
                onPress={() => setShowAddModal(true)} 
              />
            </View>
          </View>
        )}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing.xl }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            title="Kayıt Bulunamadı"
            message="Kişisel giderlerinize ait bir kayıt bulunmuyor."
            icon={<Icon name="list" size={48} color={theme.colors.textTertiary} />}
          />
        }
      />

      <AddTransactionModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        initialType="GİDER"
        initialSubType="Kişisel Gider"
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
  rowContainer: { borderRadius: 10, marginBottom: 12 },
  rowContent: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  rowIconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1, marginRight: 8 },
  rowCategory: { fontSize: 15, marginBottom: 4, fontWeight: '500' },
  rowFreq: { fontSize: 12 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 15, letterSpacing: -0.3, fontWeight: '600' },
  summaryCard: { borderRadius: 20, padding: 24, marginBottom: 24 },
});

export default PersonalExpensesScreen;
