/**
 * HomeScreen — Executive Ledger
 * ──────────────────────────────────────────────────────────────────────────────
 * • Minimalist Summary Bar (Balance / In / Out) with high-contrast numerals
 * • Animated FlatList — staggered slide-up entry via react-native-reanimated
 * • Pressable scale micro-interaction (0.98 on press)
 * • Feather icons throughout — no bulk
 * • FAB — opens camera via react-native-image-picker → sends to OCR
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  Layout,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { launchCamera } from 'react-native-image-picker';
import { theme } from '../theme';
import { useLedgerStore } from '../store/useLedgerStore';
import { scanReceipt } from '../api/ocrService';
import type { Transaction } from '../api/transactionService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats an integer amount (cents/kuruş) to a display string.
 * Negative values use the proper minus sign (−).
 */
const formatCurrency = (cents: number, signed = false): string => {
  const value = cents / 100;
  const abs = Math.abs(value);
  const prefix = signed && cents < 0 ? '−' : '';
  return `${prefix}₺${abs.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

// ─── Animated Row ────────────────────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface TransactionRowProps {
  item: Transaction;
  index: number;
}

const TransactionRow: React.FC<TransactionRowProps> = React.memo(
  ({ item, index }) => {
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
    const iconName = isIncome ? 'arrow-down-left' : 'arrow-up-right';
    const amountColor = isIncome
      ? theme.colors.successLight
      : theme.colors.dangerLight;

    const displayAmount = isIncome ? item.amount : -item.amount;

    return (
      <AnimatedPressable
        entering={FadeInDown.delay(index * 60)
          .duration(400)
          .springify()
          .damping(18)}
        layout={Layout.springify()}
        style={[styles.rowContainer, animatedStyle]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {/* Icon circle */}
        <View
          style={[
            styles.rowIconCircle,
            {
              backgroundColor: isIncome
                ? 'rgba(16, 185, 129, 0.10)'
                : 'rgba(248, 113, 113, 0.10)',
            },
          ]}
        >
          <Icon name={iconName} size={16} color={amountColor} />
        </View>

        {/* Middle — category + date */}
        <View style={styles.rowMiddle}>
          <Text style={styles.rowCategory} numberOfLines={1}>
            {item.category || item.type}
          </Text>
          <Text style={styles.rowDate}>{formatDate(item.transactionDate)}</Text>
        </View>

        {/* Amount */}
        <Text style={[styles.rowAmount, { color: amountColor }]}>
          {formatCurrency(displayAmount, true)}
        </Text>
      </AnimatedPressable>
    );
  },
);

// ─── Summary Card ────────────────────────────────────────────────────────────

interface SummaryProps {
  balance: number;
  totalIn: number;
  totalOut: number;
}

const SummaryBar: React.FC<SummaryProps> = ({ balance, totalIn, totalOut }) => (
  <Animated.View
    entering={FadeInDown.duration(500).springify()}
    style={styles.summaryCard}
  >
    {/* Balance */}
    <View style={styles.summaryBalanceSection}>
      <Text style={styles.summaryLabel}>Balance</Text>
      <Text style={styles.summaryBalance}>{formatCurrency(balance)}</Text>
    </View>

    {/* In / Out */}
    <View style={styles.summaryRow}>
      <View style={styles.summaryMetric}>
        <View style={styles.summaryDot}>
          <View style={[styles.dot, { backgroundColor: theme.colors.successLight }]} />
        </View>
        <View>
          <Text style={styles.summaryMetricLabel}>Income</Text>
          <Text style={[styles.summaryMetricValue, { color: theme.colors.successLight }]}>
            {formatCurrency(totalIn)}
          </Text>
        </View>
      </View>

      <View style={styles.summaryDivider} />

      <View style={styles.summaryMetric}>
        <View style={styles.summaryDot}>
          <View style={[styles.dot, { backgroundColor: theme.colors.dangerLight }]} />
        </View>
        <View>
          <Text style={styles.summaryMetricLabel}>Expense</Text>
          <Text style={[styles.summaryMetricValue, { color: theme.colors.dangerLight }]}>
            {formatCurrency(totalOut)}
          </Text>
        </View>
      </View>
    </View>
  </Animated.View>
);

// ─── Empty State ─────────────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <View style={styles.emptyContainer}>
    <Icon name="inbox" size={48} color={theme.colors.textTertiary} />
    <Text style={styles.emptyTitle}>No transactions yet</Text>
    <Text style={styles.emptySubtitle}>
      Tap the camera button below to scan your first receipt
    </Text>
  </View>
);

// ─── Main Screen ─────────────────────────────────────────────────────────────

const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [isScanning, setIsScanning] = useState(false);

  // ── Ledger Store ─────────────────────────────────────────────────────────
  const {
    transactions,
    totalIncome,
    totalExpense,
    balance,
    isLoading,
    fetchTransactions,
    addTransaction,
  } = useLedgerStore();

  // Fetch on mount
  useEffect(() => {
    fetchTransactions(1).catch(() => {
      // Error is set in store — silent here
    });
  }, [fetchTransactions]);

  // ── Camera / OCR Handler ─────────────────────────────────────────────────
  const handleScanReceipt = useCallback(async () => {
    try {
      const result = await launchCamera({
        mediaType: 'photo',
        includeBase64: true,
        quality: 0.8,
        maxWidth: 1920,
        maxHeight: 1920,
      });

      if (result.didCancel || !result.assets?.[0]?.base64) {
        return; // User cancelled — no-op
      }

      setIsScanning(true);
      const base64 = result.assets[0].base64;

      // Send to OCR
      const ocrResult = await scanReceipt(base64);

      if (!ocrResult.amount || ocrResult.amount === 0) {
        Alert.alert(
          'No Amount Found',
          'Could not detect a monetary value on this receipt. Please try again or enter manually.',
        );
        setIsScanning(false);
        return;
      }

      // Show confirmation before creating transaction
      Alert.alert(
        'Receipt Scanned',
        `Amount: ₺${ocrResult.amountDisplay.toFixed(2)}${ocrResult.date ? `\nDate: ${new Date(ocrResult.date).toLocaleDateString('tr-TR')}` : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add as Expense',
            onPress: async () => {
              try {
                await addTransaction({
                  type: 'EXPENSE',
                  amount: ocrResult.amount,
                  method: 'CASH',
                  category: 'Receipt Scan',
                  description: 'Scanned via camera',
                  transactionDate: ocrResult.date || undefined,
                });
              } catch {
                Alert.alert('Error', 'Failed to save transaction.');
              }
            },
          },
          {
            text: 'Add as Income',
            onPress: async () => {
              try {
                await addTransaction({
                  type: 'INCOME',
                  amount: ocrResult.amount,
                  method: 'CASH',
                  category: 'Receipt Scan',
                  description: 'Scanned via camera',
                  transactionDate: ocrResult.date || undefined,
                });
              } catch {
                Alert.alert('Error', 'Failed to save transaction.');
              }
            },
          },
        ],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to scan receipt.';
      Alert.alert('Scan Error', message);
    } finally {
      setIsScanning(false);
    }
  }, [addTransaction]);

  // ── Renderers ────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: Transaction; index: number }) => (
      <TransactionRow item={item} index={index} />
    ),
    [],
  );

  const keyExtractor = useCallback((item: Transaction) => item._id, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primary} />

      {/* ── Header ──────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable
          hitSlop={12}
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Ledger</Text>
        <Pressable hitSlop={12}>
          <Icon name="plus-circle" size={22} color={theme.colors.successLight} />
        </Pressable>
      </View>

      {/* ── Content ─────────────────────────────────────────────── */}
      <FlatList
        data={transactions}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={
          <SummaryBar
            balance={balance}
            totalIn={totalIncome}
            totalOut={totalExpense}
          />
        }
        ListEmptyComponent={!isLoading ? <EmptyState /> : null}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + theme.spacing['2xl'] + 80 },
        ]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={isLoading}
        onRefresh={() => fetchTransactions(1)}
      />

      {/* ── FAB — Camera / OCR Trigger ──────────────────────────── */}
      <Pressable
        style={[
          styles.fab,
          { bottom: insets.bottom + theme.spacing.xl },
          isScanning && styles.fabDisabled,
        ]}
        onPress={handleScanReceipt}
        disabled={isScanning}
      >
        {isScanning ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Icon name="camera" size={24} color={theme.colors.primary} />
        )}
      </Pressable>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.primary,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.base,
  },
  headerTitle: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.lg,
    color: theme.colors.textPrimary,
    letterSpacing: 0.4,
  },

  // ── List ────────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 56,
  },

  // ── Summary Card ────────────────────────────────────────────────────────
  summaryCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radii.base,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    ...theme.shadows.card,
  },
  summaryBalanceSection: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  summaryLabel: {
    fontFamily: theme.fonts.medium,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: theme.spacing.xs,
  },
  summaryBalance: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSizes['3xl'],
    color: theme.colors.textPrimary,
    letterSpacing: -0.5,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  summaryMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  summaryDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryMetricLabel: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.xs,
    color: theme.colors.textTertiary,
    marginBottom: 1,
  },
  summaryMetricValue: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.base,
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: theme.colors.border,
  },

  // ── Transaction Row ─────────────────────────────────────────────────────
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xs,
  },
  rowIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  rowMiddle: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  rowCategory: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.base,
    color: theme.colors.textPrimary,
    marginBottom: 2,
  },
  rowDate: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.xs,
    color: theme.colors.textTertiary,
  },
  rowAmount: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSizes.base,
    letterSpacing: -0.3,
  },

  // ── FAB ─────────────────────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    right: theme.spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.card,
  },
  fabDisabled: {
    opacity: 0.6,
  },

  // ── Empty State ─────────────────────────────────────────────────────────
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing['4xl'],
    gap: theme.spacing.sm,
  },
  emptyTitle: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.lg,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.base,
  },
  emptySubtitle: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textTertiary,
    textAlign: 'center',
    maxWidth: 260,
  },
});

export default HomeScreen;
