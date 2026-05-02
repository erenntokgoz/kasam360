import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import Animated, {
  FadeInDown,
  Layout,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { launchCamera } from 'react-native-image-picker';
import { useLedgerStore } from '../store/useLedgerStore';
import { scanReceipt } from '../api/ocrService';
import type { Transaction } from '../api/transactionService';
import { theme } from '../theme';
import { SafeIcon } from '../components/SafeIcon';

const formatCurrency = (cents: number, signed = false): string => {
  const value = cents / 100;
  const abs = Math.abs(value);
  const prefix = signed && cents < 0 ? '−' : signed && cents > 0 ? '+' : '';
  return `${prefix}₺${abs.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
};

const TransactionRow: React.FC<{ item: Transaction; index: number }> = React.memo(({ item, index }) => {
  const isIncome = item.type === 'INCOME';
  const amountColor = isIncome ? theme.colors.success : '#FF3B30';
  const displayAmount = isIncome ? item.amount : -item.amount;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 30).duration(400).springify()}
      style={styles.rowCard}
    >
      <View style={[styles.rowIndicator, { backgroundColor: amountColor }]} />
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowCategory} numberOfLines={1}>{item.category || item.type}</Text>
          <Text style={[styles.rowAmount, { color: amountColor }]}>
            {formatCurrency(displayAmount, true)}
          </Text>
        </View>
        <Text style={styles.rowDate}>{formatDate(item.transactionDate)} • {item.method}</Text>
      </View>
    </Animated.View>
  );
});

const SummaryBox: React.FC = () => {
  const { balance, totalIncome, totalExpense, totalDebt, totalReceivable } = useLedgerStore();

  return (
    <View style={styles.premiumSummary}>
      <View style={styles.vaultSection}>
        <Text style={styles.vaultLabel}>TOPLAM VARLIK</Text>
        <Text style={styles.vaultValue}>{formatCurrency(balance)}</Text>
        <View style={styles.vaultUnderline} />
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>GELİR</Text>
            <Text style={[styles.statValue, { color: theme.colors.success }]}>{formatCurrency(totalIncome)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>GİDER</Text>
            <Text style={[styles.statValue, { color: '#FF3B30' }]}>{formatCurrency(-totalExpense)}</Text>
          </View>
        </View>
        
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>BORÇLAR</Text>
            <Text style={[styles.statValue, { color: '#FF9500' }]}>{formatCurrency(totalDebt)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>ALACAKLAR</Text>
            <Text style={[styles.statValue, { color: '#007AFF' }]}>{formatCurrency(totalReceivable)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [isScanning, setIsScanning] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const {
    transactions,
    isLoading,
    fetchTransactions,
    addTransaction,
  } = useLedgerStore();

  useEffect(() => {
    fetchTransactions(1, 20).catch(() => { });
  }, [fetchTransactions]);

  const displayedTransactions = useMemo(() => {
    return showMore ? transactions.slice(0, 20) : transactions.slice(0, 5);
  }, [transactions, showMore]);

  const handleRefresh = async () => {
    try {
      await fetchTransactions(1, 20);
    } catch (err) {
      // Error handled by store
    }
  };

  const handleScanReceipt = useCallback(async () => {
    try {
      const result = await launchCamera({ mediaType: 'photo', includeBase64: true, quality: 0.8 });
      if (result.didCancel || !result.assets?.[0]?.base64) return;
      setIsScanning(true);
      const ocrResult = await scanReceipt(result.assets[0].base64);
      if (!ocrResult.amount) {
        Alert.alert('Hata', 'Tutar okunamadı.');
        return;
      }
      Alert.alert('Fiş Okundu', `Tutar: ₺${ocrResult.amountDisplay.toFixed(2)}`, [
        { text: 'İptal', style: 'cancel' },
        { text: 'Gider Ekle', onPress: () => addTransaction({ type: 'EXPENSE', amount: ocrResult.amount, method: 'CASH', category: 'Fiş' }) },
        { text: 'Gelir Ekle', onPress: () => addTransaction({ type: 'INCOME', amount: ocrResult.amount, method: 'CASH', category: 'Fiş' }) },
      ]);
    } catch (err) {
      Alert.alert('Hata', 'Tarama başarısız.');
    } finally {
      setIsScanning(false);
    }
  }, [addTransaction]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Pressable onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <SafeIcon name="menu-outline" size={28} color="#FFF" fallbackText="M" />
        </Pressable>
        <Text style={styles.headerTitle}>KASAM360</Text>
        <Pressable onPress={() => (navigation.navigate as any)('ProfileSettings')}>
          <SafeIcon name="person-outline" size={24} color="#FFF" fallbackText="P" />
        </Pressable>
      </View>

      <ScrollView 
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={handleRefresh}
            tintColor={theme.colors.success}
            colors={[theme.colors.success]}
          />
        }
      >
        <SummaryBox />

        <Animated.View layout={Layout.springify()} style={styles.listSection}>
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>SON İŞLEMLER</Text>
            <View style={styles.titleLine} />
          </View>
          
          {displayedTransactions.map((item, index) => (
            <TransactionRow key={item._id} item={item} index={index} />
          ))}

          {transactions.length > 5 && !showMore && (
            <TouchableOpacity 
              style={styles.expandButton} 
              activeOpacity={0.7}
              onPress={() => setShowMore(true)}
            >
              <Text style={styles.expandButtonText}>DAHA FAZLA GÖSTER (+{Math.min(transactions.length, 20) - 5})</Text>
            </TouchableOpacity>
          )}

          {transactions.length > 0 && (
            <TouchableOpacity 
              style={styles.historyButton} 
              onPress={() => (navigation.navigate as any)('Logs')}
            >
              <Text style={styles.historyButtonText}>DAHA ESKİ KAYITLARI GÖRÜNTÜLE</Text>
            </TouchableOpacity>
          )}

          {transactions.length === 0 && !isLoading && (
            <View style={styles.emptyWrap}>
              <SafeIcon name="receipt-outline" size={40} color="rgba(255,255,255,0.1)" fallbackText="" />
              <Text style={styles.emptyText}>HENÜZ HİÇBİR İŞLEM KAYDEDİLMEDİ</Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 30 }]}
        onPress={handleScanReceipt}
        disabled={isScanning}
        activeOpacity={0.9}
      >
        {isScanning ? (
          <ActivityIndicator color="#000" />
        ) : (
          <SafeIcon name="camera-outline" size={32} color="#000" fallbackText="C" />
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Black',
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 3,
  },
  scrollContent: { paddingHorizontal: 20 },
  
  // Premium Summary Box
  premiumSummary: {
    backgroundColor: '#0A0A0F',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 32,
    marginTop: 10,
  },
  vaultSection: { alignItems: 'center', marginBottom: 32 },
  vaultLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 8 },
  vaultValue: { color: '#FFF', fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  vaultUnderline: { width: 40, height: 3, backgroundColor: theme.colors.success, marginTop: 12, borderRadius: 2 },
  
  statsGrid: { gap: 12 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  statLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: '900', marginBottom: 6, letterSpacing: 1 },
  statValue: { fontSize: 15, fontWeight: '900' },

  // List Styling
  listSection: { marginTop: 8 },
  listHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 12 },
  sectionTitle: { color: '#FFF', fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  titleLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  
  rowCard: {
    flexDirection: 'row',
    backgroundColor: '#0A0A0F',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  rowIndicator: { width: 4, height: '100%' },
  rowContent: { flex: 1, padding: 16 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowCategory: { color: '#FFF', fontSize: 15, fontWeight: '900', textTransform: 'uppercase' },
  rowAmount: { fontSize: 16, fontWeight: '900' },
  rowDate: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '500' },

  expandButton: {
    padding: 18,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  expandButtonText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '900' },
  
  historyButton: {
    padding: 18,
    alignItems: 'center',
    marginTop: 16,
  },
  historyButtonText: { color: theme.colors.success, fontSize: 11, fontWeight: '900', letterSpacing: 1 },

  emptyWrap: { alignItems: 'center', padding: 60 },
  emptyText: { color: 'rgba(255,255,255,0.15)', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  
  fab: {
    position: 'absolute',
    right: 24,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: theme.colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: theme.colors.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
});

export default HomeScreen;
