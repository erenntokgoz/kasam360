import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Alert, ActivityIndicator } from 'react-native';
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withSpring, Layout } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { launchCamera } from 'react-native-image-picker';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { scanReceipt } from '../api/ocrService';
import type { Transaction } from '../api/transactionService';
import AddTransactionModal from '../components/AddTransactionModal';
import { useTranslation } from 'react-i18next';
import { useRecurringStore } from '../store/useRecurringStore';
import { useBudgetStore } from '../store/useBudgetStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { useDebtStore } from '../store/useDebtStore';
import '../i18n';

const formatCurrency = (cents: number, signed = false): string => {
  const value = cents / 100;
  const abs = Math.abs(value);
  const prefix = signed && cents < 0 ? '−' : '';
  return `${prefix}₺${abs.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface TransactionRowProps { item: Transaction; index: number; onLongPress: (t: Transaction) => void; }

const TransactionRow: React.FC<TransactionRowProps> = React.memo(({ item, index, onLongPress }) => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const handlePressIn = useCallback(() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 200 }); }, [scale]);
  const handlePressOut = useCallback(() => { scale.value = withSpring(1, { damping: 15, stiffness: 200 }); }, [scale]);

  const isIncome = item.type === 'INCOME';
  const iconName = isIncome ? 'arrow-down-left' : 'arrow-up-right';
  const amountColor = isIncome ? theme.colors.successLight : theme.colors.dangerLight;
  const displayAmount = isIncome ? item.amount : -item.amount;

  return (
    <AnimatedPressable
      entering={FadeInDown.delay(index * 60).duration(400).springify().damping(18)}
      layout={Layout.springify()}
      style={[
        {
          flexDirection: 'row', alignItems: 'center',
          paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.xs,
        },
        animatedStyle,
      ]}
      onPressIn={handlePressIn} onPressOut={handlePressOut}
      onLongPress={() => onLongPress(item)}
    >
      <View style={{
        width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        marginRight: theme.spacing.md,
        backgroundColor: isIncome ? 'rgba(16, 185, 129, 0.10)' : 'rgba(248, 113, 113, 0.10)',
      }}>
        <Icon name={iconName} size={16} color={amountColor} />
      </View>
      <View style={{ flex: 1, marginRight: theme.spacing.sm }}>
        <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginBottom: 2 }} numberOfLines={1}>
          {item.category || item.type}
        </Text>
        <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary }}>
          {formatDate(item.transactionDate)}
        </Text>
      </View>
      <Text style={{ fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.base, letterSpacing: -0.3, color: amountColor }}>
        {formatCurrency(displayAmount, true)}
      </Text>
    </AnimatedPressable>
  );
});

interface SummaryProps { balance: number; totalIn: number; totalOut: number; monthlyLimit: number; warningThreshold: number; }

const SummaryBar: React.FC<SummaryProps> = ({ balance, totalIn, totalOut, monthlyLimit, warningThreshold }) => {
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);

  const spentLira = totalOut / 100;
  const spentPercentage = monthlyLimit > 0 ? (spentLira / monthlyLimit) * 100 : 0;
  const progressWidth = Math.min(spentPercentage, 100);

  let progressColor = theme.colors.successLight;
  if (spentPercentage >= 100) {
    progressColor = theme.colors.dangerLight;
  } else if (spentPercentage >= warningThreshold) {
    progressColor = '#F59E0B';
  }

  return (
    <Animated.View entering={FadeInDown.duration(500).springify()} style={{
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.base,
      padding: theme.spacing.xl,
      marginBottom: theme.spacing.xl,
      ...theme.shadows.card,
    }}>
      <View style={{ alignItems: 'center', marginBottom: theme.spacing.lg }}>
        <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: theme.spacing.xs }}>
          {t('home.balance')}
        </Text>
        <Text style={{ fontFamily: theme.fonts.bold, fontSize: theme.fontSizes['3xl'], color: theme.colors.textPrimary, letterSpacing: -0.5 }}>
          {formatCurrency(balance)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.successLight }} />
          </View>
          <View>
            <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginBottom: 1 }}>{t('home.income')}</Text>
            <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: theme.colors.successLight }}>{formatCurrency(totalIn)}</Text>
          </View>
        </View>
        <View style={{ width: 1, height: 32, backgroundColor: theme.colors.border }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.dangerLight }} />
          </View>
          <View>
            <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginBottom: 1 }}>{t('home.expense')}</Text>
            <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: theme.colors.dangerLight }}>{formatCurrency(totalOut)}</Text>
          </View>
        </View>
      </View>
      {monthlyLimit > 0 && (
        <View style={{ marginTop: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.xs, color: theme.colors.textSecondary }}>
              Bütçe Hedefi: ₺{monthlyLimit.toLocaleString('tr-TR')}
            </Text>
            <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.xs, color: progressColor }}>
              %{spentPercentage.toFixed(0)} harcandı
            </Text>
          </View>
          <View style={{ height: 6, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)', borderRadius: 3, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${progressWidth}%` as any, backgroundColor: progressColor, borderRadius: 3 }} />
          </View>
        </View>
      )}
    </Animated.View>
  );
};

const EmptyState: React.FC = () => {
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing['4xl'], gap: theme.spacing.sm }}>
      <Icon name="inbox" size={48} color={theme.colors.textTertiary} />
      <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.lg, color: theme.colors.textSecondary, marginTop: theme.spacing.base }}>
        {t('home.noTransactionsTitle')}
      </Text>
      <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary, textAlign: 'center', maxWidth: 260 }}>
        {t('home.noTransactionsSub')}
      </Text>
    </View>
  );
};

const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const [isScanning, setIsScanning] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const { transactions, totalIncome, totalExpense, balance, isLoading, fetchTransactions, addTransaction, deleteTransaction } = useLedgerStore();
  const checkAndNotify = useRecurringStore(s => s.checkAndNotify);
  const { monthlyLimit, warningThreshold } = useBudgetStore();
  const addNotification = useNotificationStore(s => s.addNotification);
  const { debts, fetchDebts } = useDebtStore();
  const [budgetAlertShown, setBudgetAlertShown] = useState(false);

  useEffect(() => { 
    fetchTransactions(1).catch(() => { }); 
    fetchDebts(1).catch(() => { });
  }, [fetchTransactions, fetchDebts]);

  useEffect(() => {
    if (monthlyLimit > 0 && totalExpense > 0) {
      const spentLira = totalExpense / 100;
      const spentPercentage = (spentLira / monthlyLimit) * 100;

      if (spentPercentage >= warningThreshold && !budgetAlertShown) {
        Alert.alert(
          'Bütçe Uyarısı',
          `Aylık bütçenizin %${spentPercentage.toFixed(0)}'ini harcadınız!`,
          [{ text: 'Tamam', onPress: () => setBudgetAlertShown(true) }]
        );
        addNotification({
          title: 'Bütçe Uyarısı',
          body: `Aylık bütçenizin %${spentPercentage.toFixed(0)}'ini harcadınız!`,
          type: 'BUDGET'
        });
      }
    }
  }, [totalExpense, monthlyLimit, warningThreshold, budgetAlertShown, addNotification]);

  useEffect(() => {
    const dueItems = checkAndNotify();
    if (dueItems && dueItems.length > 0) {
      dueItems.forEach(item => {
        Alert.alert(
          'İşlem Hatırlatıcısı',
          `Bugün ${(item.amount / 100).toLocaleString('tr-TR')}₺ tutarında ${item.category} kategorisinde işlem zamanı!`,
          [{ text: 'Tamam', style: 'default' }]
        );
        addNotification({
          title: 'İşlem Hatırlatıcısı',
          body: `Bugün ${(item.amount / 100).toLocaleString('tr-TR')}₺ tutarında ${item.category} kategorisinde işlem zamanı!`,
          type: 'RECURRING'
        });
      });
    }
  }, [checkAndNotify, addNotification]);

  useEffect(() => {
    const today = new Date();
    debts.forEach(debt => {
      if (debt.status !== 'PAID' && debt.dueDate) {
        const dueDate = new Date(debt.dueDate);
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays >= 0 && diffDays <= 3) {
          addNotification({
            title: 'Borç Hatırlatıcı',
            body: `${debt.entityName} için ${(debt.remainingAmount / 100).toLocaleString('tr-TR')}₺ ödemenizin tarihi yaklaştı (${diffDays === 0 ? 'Bugün' : diffDays + ' gün kaldı'}).`,
            type: 'DEBT'
          });
        }
      }
    });
  }, [debts, addNotification]);

  const handleScanReceipt = useCallback(async () => {
    try {
      const result = await launchCamera({ mediaType: 'photo', includeBase64: true, quality: 0.8, maxWidth: 1920, maxHeight: 1920 });
      if (result.didCancel || !result.assets?.[0]?.base64) return;
      setIsScanning(true);
      const base64 = result.assets[0].base64;
      const ocrResult = await scanReceipt(base64);
      if (!ocrResult.amount || ocrResult.amount === 0) {
        Alert.alert(t('home.noAmountTitle'), t('home.noAmountMsg'));
        setIsScanning(false);
        return;
      }
      Alert.alert(t('home.receiptScannedTitle'), `${t('home.amount')}: ₺${ocrResult.amountDisplay.toFixed(2)}${ocrResult.date ? `\n${t('home.date')}: ${new Date(ocrResult.date).toLocaleDateString('tr-TR')}` : ''}`, [
        { text: t('home.cancel'), style: 'cancel' },
        { text: t('home.addExpense'), onPress: async () => { await addTransaction({ type: 'EXPENSE', amount: ocrResult.amount, method: 'CASH', category: 'Receipt Scan', description: t('home.receiptDesc'), transactionDate: ocrResult.date || undefined }); } },
        { text: t('home.addIncome'), onPress: async () => { await addTransaction({ type: 'INCOME', amount: ocrResult.amount, method: 'CASH', category: 'Receipt Scan', description: t('home.receiptDesc'), transactionDate: ocrResult.date || undefined }); } },
      ]);
    } catch (err) { Alert.alert(t('home.scanError'), err instanceof Error ? err.message : t('home.scanErrorMsg')); }
    finally { setIsScanning(false); }
  }, [addTransaction]);

  const handleDelete = async (t: Transaction) => {
    Alert.alert(
      'Emin misiniz?',
      'Bu işlemi silmek istediğinize emin misiniz?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Sil', style: 'destructive', onPress: async () => {
          try {
            await deleteTransaction(t._id);
          } catch (e) {
            Alert.alert('Hata', 'İşlem silinemedi');
          }
        }},
      ]
    );
  };

  const handleRowLongPress = useCallback((t: Transaction) => {
    Alert.alert(
      'İşlem Seçin',
      `${t.category || t.type} işlemi için ne yapmak istersiniz?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Düzenle', onPress: () => { setEditTarget(t); setShowAddModal(true); } },
        { text: 'Sil', style: 'destructive', onPress: () => handleDelete(t) },
      ]
    );
  }, []);

  const renderItem = useCallback(({ item, index }: { item: Transaction; index: number }) => <TransactionRow item={item} index={index} onLongPress={handleRowLongPress} />, [handleRowLongPress]);
  const keyExtractor = useCallback((item: Transaction) => item._id, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.primary, paddingTop: insets.top }}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.colors.primary} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.lg, color: theme.colors.textPrimary, letterSpacing: 0.4 }}>{t('home.title')}</Text>
        <Pressable hitSlop={12} onPress={() => setShowAddModal(true)}>
          <Icon name="plus-circle" size={22} color={theme.colors.accent} />
        </Pressable>
      </View>
      <FlatList
        data={transactions}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={<SummaryBar balance={balance} totalIn={totalIncome} totalOut={totalExpense} monthlyLimit={monthlyLimit} warningThreshold={warningThreshold} />}
        ListEmptyComponent={!isLoading ? <EmptyState /> : null}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing['2xl'] + 80 }}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.colors.border, marginLeft: 56 }} />}
        refreshing={isLoading}
        onRefresh={() => fetchTransactions(1)}
      />
      <Pressable
        style={[
          {
            position: 'absolute', right: theme.spacing.xl, bottom: insets.bottom + theme.spacing.xl,
            width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.accent,
            alignItems: 'center', justifyContent: 'center', ...theme.shadows.button,
          },
          isScanning && { opacity: 0.6 },
        ]}
        onPress={handleScanReceipt}
        disabled={isScanning}
      >
        {isScanning ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Icon name="camera" size={24} color="#FFFFFF" />}
      </Pressable>
      <AddTransactionModal
        visible={showAddModal}
        initialData={editTarget}
        onClose={() => {
          setShowAddModal(false);
          setEditTarget(null);
          fetchTransactions(1).catch(() => {});
        }}
      />
    </View>
  );
};

export default HomeScreen;