import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  StatusBar,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
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

interface TransactionRowProps {
  item: Transaction;
  index: number;
}

const TransactionRow: React.FC<TransactionRowProps> = React.memo(({ item, index }) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.98, { damping: 15, stiffness: 200 });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 200 });
  }, [scale]);

  const isIncome = item.type === 'INCOME';
  const iconName = isIncome ? 'arrow-down-outline' : 'arrow-up-outline';
  const amountColor = isIncome ? theme.colors.success : theme.colors.danger;
  const displayAmount = isIncome ? item.amount : -item.amount;

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View
        entering={FadeInDown.delay(index * 40).duration(300).springify().damping(20)}
        layout={Layout.springify()}
        style={[styles.rowContainer, animatedStyle]}
      >
        <View style={styles.rowIconCircle}>
          <SafeIcon name={iconName} size={18} color={amountColor} fallbackText={isIncome ? 'G' : 'H'} />
        </View>

        <View style={styles.rowMiddle}>
          <Text style={styles.rowCategory} numberOfLines={1}>
            {item.category || item.type}
          </Text>
          <Text style={styles.rowDate}>{formatDate(item.transactionDate)}</Text>
        </View>

        <Text style={[styles.rowAmount, { color: amountColor }]}>
          {formatCurrency(displayAmount, true)}
        </Text>
      </Animated.View>
    </Pressable>
  );
});

interface SummaryProps {
  balance: number;
  totalIn: number;
  totalOut: number;
}

const SummaryBar: React.FC<SummaryProps> = ({ balance, totalIn, totalOut }) => (
  <Animated.View entering={FadeInDown.duration(400).springify()} style={styles.summaryContainer}>
    <Text style={styles.summaryLabel}>TOPLAM BAKİYE</Text>
    <Text style={styles.summaryBalance} adjustsFontSizeToFit numberOfLines={1}>{formatCurrency(balance)}</Text>

    <View style={styles.statsContainer}>
      <View style={styles.statBox}>
        <Text style={styles.statLabel}>GELİR</Text>
        <Text style={[styles.statValue, { color: theme.colors.success }]}>
          {formatCurrency(totalIn, true)}
        </Text>
      </View>
      <View style={styles.statBox}>
        <Text style={[styles.statLabel, { textAlign: 'right' }]}>GİDER</Text>
        <Text style={[styles.statValue, { color: theme.colors.danger, textAlign: 'right' }]}>
          {formatCurrency(-totalOut, true)}
        </Text>
      </View>
    </View>
  </Animated.View>
);

const EmptyState: React.FC = () => (
  <View style={styles.emptyContainer}>
    <SafeIcon name="document-outline" size={48} color={theme.colors.border} fallbackText="BOŞ" />
    <Text style={styles.emptyTitle}>Haraket Bulunamadı</Text>
    <Text style={styles.emptySubtitle}>İlk fişinizi okutmak için kamerayı kullanın.</Text>
  </View>
);

const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [isScanning, setIsScanning] = useState(false);

  const {
    transactions,
    totalIncome,
    totalExpense,
    balance,
    isLoading,
    fetchTransactions,
    addTransaction,
  } = useLedgerStore();

  useEffect(() => {
    fetchTransactions(1).catch(() => { });
  }, [fetchTransactions]);

  const handleScanReceipt = useCallback(async () => {
    try {
      const result = await launchCamera({
        mediaType: 'photo',
        includeBase64: true,
        quality: 0.8,
        maxWidth: 1920,
        maxHeight: 1920,
      });

      if (result.didCancel || !result.assets?.[0]?.base64) return;

      setIsScanning(true);
      const base64 = result.assets[0].base64;
      const ocrResult = await scanReceipt(base64);

      if (!ocrResult.amount || ocrResult.amount === 0) {
        Alert.alert('Tutar Bulunamadı', 'Fiş üzerinde bir tutar okunamadı. Lütfen tekrar deneyin.');
        setIsScanning(false);
        return;
      }

      Alert.alert(
        'Fiş Okundu',
        `Tutar: ₺${ocrResult.amountDisplay.toFixed(2)}${ocrResult.date ? `\nTarih: ${new Date(ocrResult.date).toLocaleDateString('tr-TR')}` : ''}`,
        [
          { text: 'İptal', style: 'cancel' },
          {
            text: 'Gider Ekle',
            onPress: async () => {
              try {
                await addTransaction({
                  type: 'EXPENSE',
                  amount: ocrResult.amount,
                  method: 'CASH',
                  category: 'Fiş Okuma',
                  description: 'Kamera ile tarandı',
                  transactionDate: ocrResult.date || undefined,
                });
              } catch {
                Alert.alert('Hata', 'İşlem kaydedilemedi.');
              }
            },
          },
          {
            text: 'Gelir Ekle',
            onPress: async () => {
              try {
                await addTransaction({
                  type: 'INCOME',
                  amount: ocrResult.amount,
                  method: 'CASH',
                  category: 'Fiş Okuma',
                  description: 'Kamera ile tarandı',
                  transactionDate: ocrResult.date || undefined,
                });
              } catch {
                Alert.alert('Hata', 'İşlem kaydedilemedi.');
              }
            },
          },
        ]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tarama başarısız oldu.';
      Alert.alert('Tarama Hatası', message);
    } finally {
      setIsScanning(false);
    }
  }, [addTransaction]);

  const renderItem = useCallback(
    ({ item, index }: { item: Transaction; index: number }) => (
      <TransactionRow item={item} index={index} />
    ),
    []
  );

  const keyExtractor = useCallback((item: Transaction) => item._id, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primary} />

      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <SafeIcon name="menu-outline" size={32} color={theme.colors.textPrimary} fallbackText="MENÜ" />
        </Pressable>
        <Text style={styles.headerTitle}>DEFTER</Text>
        <Pressable hitSlop={12}>
          <SafeIcon name="person-outline" size={28} color={theme.colors.textPrimary} fallbackText="PROFİL" />
        </Pressable>
      </View>

      <FlatList
        data={transactions}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={<SummaryBar balance={balance} totalIn={totalIncome} totalOut={totalExpense} />}
        ListEmptyComponent={!isLoading ? <EmptyState /> : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        refreshing={isLoading}
        onRefresh={() => fetchTransactions(1)}
      />

      <TouchableOpacity
        style={[styles.fabContainer, { bottom: insets.bottom + 32 }]}
        onPress={handleScanReceipt}
        disabled={isScanning}
        activeOpacity={0.8}
      >
        <View style={styles.fab}>
          {isScanning ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <SafeIcon name="camera-outline" size={28} color={theme.colors.primary} fallbackText="KAMERA" />
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: theme.fontSizes.lg,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    color: theme.colors.textPrimary,
    letterSpacing: 2,
  },
  listContent: {
    paddingTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.md,
  },
  summaryContainer: {
    marginBottom: theme.spacing['2xl'],
    paddingHorizontal: theme.spacing.sm,
  },
  summaryLabel: {
    color: theme.colors.textTertiary,
    fontSize: theme.fontSizes.sm,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    letterSpacing: 2,
  },
  summaryBalance: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSizes['4xl'],
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    letterSpacing: -2,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
  },
  statBox: {
    flex: 1,
  },
  statLabel: {
    color: theme.colors.textTertiary,
    fontSize: theme.fontSizes.xs,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: theme.spacing.xs,
  },
  statValue: {
    fontSize: theme.fontSizes.lg,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.none,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowIconCircle: {
    marginRight: theme.spacing.md,
  },
  rowMiddle: {
    flex: 1,
    marginRight: theme.spacing.md,
  },
  rowCategory: {
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
    fontWeight: '300',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  rowAmount: {
    fontSize: theme.fontSizes.lg,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    letterSpacing: -1,
  },
  fabContainer: {
    position: 'absolute',
    alignSelf: 'center',
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing['3xl'],
  },
  emptyTitle: {
    fontSize: theme.fontSizes.lg,
    fontFamily: theme.fonts.black,
    fontWeight: '900',
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.md,
    textTransform: 'uppercase',
  },
  emptySubtitle: {
    fontSize: theme.fontSizes.sm,
    fontFamily: theme.fonts.light,
    fontWeight: '300',
    color: theme.colors.textTertiary,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
});

export default HomeScreen;
