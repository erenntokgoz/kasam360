import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import type { Debt } from '../api/debtService';
import { formatCurrency, formatDate } from '../utils/format';

interface DebtDetailModalProps {
  visible: boolean;
  debt: Debt;
  onClose: () => void;
  onPay?: (debt: Debt) => void;
}

const DebtDetailModal: React.FC<DebtDetailModalProps> = ({ visible, debt, onClose, onPay }) => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);

  const isGiven = debt.type === 'GIVEN';
  const color = isGiven ? theme.colors.success : theme.colors.danger;
  const progress = debt.totalAmount > 0 ? 1 - debt.remainingAmount / debt.totalAmount : 0;
  const isPaid = debt.status === 'PAID';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.content, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Borç / Alacak Detayı</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Icon name="x" size={24} color={theme.colors.textTertiary} />
            </Pressable>
          </View>

          <View style={styles.amountSection}>
            <View style={[styles.iconCircle, { backgroundColor: color + '15' }]}>
              <Icon name={isGiven ? 'arrow-up-right' : 'arrow-down-left'} size={32} color={color} />
            </View>
            <Text style={[styles.amountText, { color }]}>{formatCurrency(debt.remainingAmount, true)}</Text>
            <Text style={[styles.typeText, { color: theme.colors.textTertiary }]}>
              {isGiven ? 'ALACAK (Kalan)' : 'BORÇ (Kalan)'}
            </Text>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.progressHeader}>
              <Text style={[styles.progressLabel, { color: theme.colors.textSecondary }]}>Ödeme Durumu</Text>
              <Text style={[styles.progressPercent, { color: theme.colors.textPrimary }]}>{Math.round(progress * 100)}%</Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
              <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: color }]} />
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

          <View style={styles.infoGrid}>
            <InfoItem label="Kişi / Kurum" value={debt.entityName} theme={theme} />
            <InfoItem label="Toplam Tutar" value={formatCurrency(debt.totalAmount)} theme={theme} />
            <InfoItem label="Oluşturma" value={formatDate(debt.createdAt)} theme={theme} />
            <InfoItem label="Vade Tarihi" value={debt.dueDate ? formatDate(debt.dueDate) : 'Belirtilmemiş'} theme={theme} />
            <InfoItem label="Durum" value={debt.status === 'PAID' ? 'Ödendi' : (debt.status === 'OVERDUE' ? 'Gecikmiş' : 'Bekliyor')} theme={theme} color={debt.status === 'PAID' ? theme.colors.success : (debt.status === 'OVERDUE' ? theme.colors.danger : theme.colors.warning)} />
          </View>

          <View style={styles.actions}>
            {!isPaid && onPay && (
              <Pressable 
                style={[styles.payBtn, { backgroundColor: color }]} 
                onPress={() => { onClose(); onPay(debt); }}
              >
                <Text style={styles.payBtnText}>{isGiven ? 'Tahsilat Yap' : 'Ödeme Yap'}</Text>
              </Pressable>
            )}
            <Pressable style={[styles.closeBtn, { backgroundColor: theme.colors.card }]} onPress={onClose}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Kapat</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const InfoItem = ({ label, value, theme, color }: { label: string; value: string; theme: any; color?: string }) => (
  <View style={styles.infoItem}>
    <Text style={[styles.label, { color: theme.colors.textTertiary }]}>{label}</Text>
    <Text style={[styles.value, { color: color || theme.colors.textPrimary }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { width: '100%', borderRadius: 24, padding: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 18, fontWeight: '700' },
  amountSection: { alignItems: 'center', marginBottom: 24 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  amountText: { fontSize: 32, fontWeight: '700' },
  typeText: { fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 4 },
  progressContainer: { marginBottom: 8 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel: { fontSize: 12, fontWeight: '600' },
  progressPercent: { fontSize: 12, fontWeight: '700' },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  divider: { height: 1, marginVertical: 24 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  infoItem: { width: '45%' },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  value: { fontSize: 15, fontWeight: '500' },
  actions: { marginTop: 32, gap: 12 },
  payBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  payBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  closeBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' }
});

export default DebtDetailModal;
