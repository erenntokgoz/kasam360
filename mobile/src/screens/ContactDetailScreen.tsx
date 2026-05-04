import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useDebtStore } from '../store/useDebtStore';
import type { Debt } from '../api/debtService';
import { PaymentModal } from './DebtsScreen';

type ParamList = {
  ContactDetail: { contactName: string };
};

const fmt = (cents: number): string => {
  const v = Math.abs(cents) / 100;
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const ContactDetailScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<ParamList, 'ContactDetail'>>();
  const insets = useSafeAreaInsets();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  
  const { contactName } = route.params;
  const { debts, fetchDebts } = useDebtStore();
  
  const [payTarget, setPayTarget] = useState<Debt | null>(null);

  useEffect(() => {
    fetchDebts(1).catch(() => {});
  }, [fetchDebts]);

  const contactDebts = useMemo(() => {
    return debts
      .filter(d => d.entityName === contactName)
      .sort((a, b) => {
        const dateA = new Date(a.createdAt || a.dueDate || 0).getTime();
        const dateB = new Date(b.createdAt || b.dueDate || 0).getTime();
        return dateB - dateA;
      });
  }, [debts, contactName]);

  const { totalGiven, totalTaken, netStatus } = useMemo(() => {
    let given = 0;
    let taken = 0;
    contactDebts.forEach(d => {
      if (d.type === 'GIVEN') given += d.remainingAmount;
      if (d.type === 'TAKEN') taken += d.remainingAmount;
    });
    return {
      totalGiven: given,
      totalTaken: taken,
      netStatus: given - taken, // positive means they owe us
    };
  }, [contactDebts]);

  const renderItem = useCallback(({ item, index }: { item: Debt; index: number }) => {
    const isGiven = item.type === 'GIVEN';
    const accent = isGiven ? theme.colors.successLight : theme.colors.dangerLight;
    const iconBg = isGiven ? 'rgba(16,185,129,0.10)' : 'rgba(248,113,113,0.10)';
    const paid = item.status === 'PAID';

    return (
      <Animated.View
        entering={FadeInDown.delay(index * 50).duration(350).springify()}
        layout={Layout.springify()}
        style={styles.rowWrap}
      >
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <Icon name={isGiven ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={accent} />
        </View>
        <View style={styles.rowMid}>
          <Text style={styles.rowDesc} numberOfLines={1}>
            {isGiven ? t('debts.typeGiven') : t('debts.typeTaken')}
          </Text>
          <Text style={styles.rowDate}>{fmtDate(item.createdAt || item.dueDate)}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.rowRemaining, { color: paid ? theme.colors.textTertiary : accent }]}>
            {fmt(item.remainingAmount)}
          </Text>
          <Text style={styles.rowTotal}>/ {fmt(item.totalAmount)}</Text>
          {paid && <View style={styles.paidBadge}><Text style={styles.paidText}>{t('debts.paid')}</Text></View>}
        </View>
        
        {!paid && (
          <Pressable 
            style={[styles.payBtn, { backgroundColor: accent }]}
            onPress={() => setPayTarget(item)}
          >
            <Text style={styles.payBtnText}>{t('paymentModal.payFull')}</Text>
          </Pressable>
        )}
      </Animated.View>
    );
  }, [t]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.colors.primary} />
      
      {/* Header */}
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-left" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>{contactName}</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Summary Card */}
      <View style={styles.cardContainer}>
        <Animated.View entering={FadeInDown.duration(500).springify()} style={[styles.summaryCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card, borderRadius: theme.radii.lg, padding: theme.spacing.xl }]}>
          <View style={styles.cardTop}>
            <Text style={[styles.cardTitle, { color: theme.colors.textTertiary }]}>{t('debts.netStatus')}</Text>
            <Text style={[styles.netAmount, { color: netStatus >= 0 ? theme.colors.successLight : theme.colors.dangerLight }]}>
              {netStatus > 0 ? '+' : ''}{fmt(netStatus)}
            </Text>
          </View>
          
          <View style={[styles.summaryRow, { backgroundColor: theme.colors.card }]}>
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: theme.colors.textTertiary }]}>{t('debts.summaryGiven')}</Text>
              <Text style={[styles.summaryVal, { color: theme.colors.successLight }]}>{fmt(totalGiven)}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: theme.colors.textTertiary }]}>{t('debts.summaryTaken')}</Text>
              <Text style={[styles.summaryVal, { color: theme.colors.dangerLight }]}>{fmt(totalTaken)}</Text>
            </View>
          </View>
        </Animated.View>
      </View>

      {/* Transactions List */}
      <Text style={[styles.listTitle, { color: theme.colors.textPrimary }]}>{t('analytics.recentTransactions')}</Text>
      <FlatList
        data={contactDebts}
        renderItem={renderItem}
        keyExtractor={(item) => item._id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + theme.spacing['2xl'] }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Icon name="inbox" size={48} color={theme.colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: theme.colors.textSecondary }]}>{t('debts.noDebtsTitle')}</Text>
          </View>
        }
      />

      <PaymentModal visible={!!payTarget} debt={payTarget} onClose={() => setPayTarget(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12 },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'System', fontSize: 18, letterSpacing: 0.4 },
  cardContainer: { paddingHorizontal: 24, marginTop: 16, marginBottom: 24 },
  cardTop: { alignItems: 'center', marginBottom: 24 },
  cardTitle: { fontFamily: 'System', fontSize: 13, marginBottom: 4 },
  netAmount: { fontFamily: 'System', fontSize: 36, letterSpacing: -0.5 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, padding: 16 },
  summaryCol: { flex: 1, alignItems: 'center' },
  summaryLabel: { fontFamily: 'System', fontSize: 11, marginBottom: 2 },
  summaryVal: { fontFamily: 'System', fontSize: 15 },
  summaryDivider: { width: 1, height: 24 },
  listTitle: { paddingHorizontal: 24, fontFamily: 'System', fontSize: 18, marginBottom: 16 },
  listContent: { paddingHorizontal: 24 },
  separator: { height: 1, marginLeft: 56, marginVertical: 8 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMid: { flex: 1, marginRight: 8 },
  rowDesc: { fontFamily: 'System', fontSize: 15, marginBottom: 2 },
  rowDate: { fontFamily: 'System', fontSize: 11 },
  rowRight: { alignItems: 'flex-end', marginRight: 16 },
  rowRemaining: { fontFamily: 'System', fontSize: 15, letterSpacing: -0.3 },
  rowTotal: { fontFamily: 'System', fontSize: 11, marginTop: 1 },
  paidBadge: { marginTop: 4, backgroundColor: 'rgba(16,185,129,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  paidText: { fontFamily: 'System', fontSize: 9, color: '#10B981', letterSpacing: 0.8 },
  payBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  payBtnText: { fontFamily: 'System', fontSize: 11 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 8 },
  emptyTitle: { fontFamily: 'System', fontSize: 15, marginTop: 12 },
});

export default ContactDetailScreen;
