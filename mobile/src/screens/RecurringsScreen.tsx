import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import type { Transaction } from '../api/transactionService';
import TransactionDetailModal from '../components/TransactionDetailModal';
import AddTransactionModal from '../components/AddTransactionModal';
import { formatCurrency, formatDate } from '../utils/format';

const PersonnelExpensesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { transactions, removeTransaction } = useLedgerStore();
  
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [selectedTx, setSelectedTx] = React.useState<Transaction | null>(null);

  // Filter only personnel expenses
  const personnelExpenses = transactions.filter(t => t.category === 'Personel Gideri');

  const handleLongPress = (id: string) => {
    Alert.alert('İşlemi Sil', 'Bu personel giderini silmek istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeTransaction(id) },
    ]);
  };

  const renderItem = ({ item }: { item: Transaction }) => {
    return (
      <View style={[styles.rowContainer, { backgroundColor: theme.colors.surface }]}>
        <Pressable
          style={styles.rowContent}
          onPress={() => setSelectedTx(item)}
          onLongPress={() => handleLongPress(item.id)}
        >
          <View style={[styles.rowIconCircle, { backgroundColor: theme.colors.dangerTransparent }]}>
            <Icon name="users" size={16} color={theme.colors.dangerLight} />
          </View>
          <View style={styles.rowMiddle}>
            <Text style={[styles.rowCategory, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              {item.description || 'Personel Ödemesi'}
            </Text>
            <Text style={[styles.rowFreq, { color: theme.colors.textTertiary }]}>{formatDate(item.createdAt)}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowAmount, { color: theme.colors.dangerLight }]}>{formatCurrency(item.amount, true)}</Text>
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.colors.primary} />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Personel Giderleri</Text>
        <Pressable hitSlop={12} onPress={() => setShowAddModal(true)}>
          <Icon name="plus-circle" size={22} color={theme.colors.accent} />
        </Pressable>
      </View>
      
      <FlatList
        data={personnelExpenses}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing.xl }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing['4xl'], gap: theme.spacing.sm }}>
            <Icon name="users" size={48} color={theme.colors.textTertiary} />
            <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.lg, color: theme.colors.textSecondary, marginTop: theme.spacing.base }}>Kayıt Yok</Text>
            <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary, textAlign: 'center', maxWidth: 260 }}>Henüz bir personel gideri eklenmemiş.</Text>
          </View>
        }
      />

      <AddTransactionModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 18, letterSpacing: 0.4, fontWeight: '600' },
  rowContainer: { borderRadius: 10, marginBottom: 12 },
  rowContent: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  rowIconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1, marginRight: 8 },
  rowCategory: { fontSize: 15, marginBottom: 4, fontWeight: '500' },
  rowFreq: { fontSize: 12 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 15, letterSpacing: -0.3, fontWeight: '600' },
});

export default PersonnelExpensesScreen;