import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import type { Transaction } from '../api/transactionService';
import { formatCurrency } from '../utils/format';

interface TransactionDetailModalProps {
  visible: boolean;
  transaction: Transaction;
  onClose: () => void;
}

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({ visible, transaction, onClose }) => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);

  const date = new Date(transaction.transactionDate);
  const dateStr = date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const isIncome = transaction.type === 'INCOME';
  const color = isIncome ? theme.colors.success : theme.colors.danger;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.content, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.textPrimary }]}>İşlem Detayı</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Icon name="x" size={24} color={theme.colors.textTertiary} />
            </Pressable>
          </View>

          <View style={styles.amountSection}>
            <View style={[styles.iconCircle, { backgroundColor: isIncome ? theme.colors.successTransparent : theme.colors.dangerTransparent }]}>
              <Icon name={isIncome ? 'arrow-down-left' : 'arrow-up-right'} size={32} color={color} />
            </View>
            <Text style={[styles.amountText, { color }]}>{formatCurrency(isIncome ? transaction.amount : -transaction.amount, true)}</Text>
            <Text style={[styles.typeText, { color: theme.colors.textTertiary }]}>{isIncome ? 'GELİR' : 'GİDER'}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

          <View style={styles.infoGrid}>
            <InfoItem label="Kategori" value={transaction.category || 'Belirtilmemiş'} theme={theme} />
            <InfoItem label="Ödeme Yöntemi" value={transaction.method} theme={theme} />
            <InfoItem label="Tarih" value={dateStr} theme={theme} />
            <InfoItem label="Saat" value={timeStr} theme={theme} />
          </View>

          {transaction.description && (
            <View style={styles.descriptionSection}>
              <Text style={[styles.label, { color: theme.colors.textTertiary }]}>Açıklama</Text>
              <Text style={[styles.description, { color: theme.colors.textSecondary }]}>{transaction.description}</Text>
            </View>
          )}

          <Pressable style={[styles.closeBtn, { backgroundColor: theme.colors.card }]} onPress={onClose}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Kapat</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const InfoItem = ({ label, value, theme }: { label: string; value: string; theme: any }) => (
  <View style={styles.infoItem}>
    <Text style={[styles.label, { color: theme.colors.textTertiary }]}>{label}</Text>
    <Text style={[styles.value, { color: theme.colors.textPrimary }]}>{value}</Text>
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
  divider: { height: 1, marginVertical: 24 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  infoItem: { width: '45%' },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  value: { fontSize: 15, fontWeight: '500' },
  descriptionSection: { marginTop: 24 },
  description: { fontSize: 14, lineHeight: 20 },
  closeBtn: { marginTop: 32, paddingVertical: 14, borderRadius: 12, alignItems: 'center' }
});

export default TransactionDetailModal;
