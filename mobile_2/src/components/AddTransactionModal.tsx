import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, TextInput,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Switch
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { useRecurringStore } from '../store/useRecurringStore';
import { useTranslation } from 'react-i18next';

import type { Transaction } from '../api/transactionService';
import { DEFAULT_CATEGORIES } from '../constants/categories';

interface AddTransactionModalProps {
  visible: boolean;
  onClose: () => void;
  initialData?: Transaction | null;
  defaultRecurring?: boolean;
  mode?: 'transaction' | 'recurring';
}


const AddTransactionModal: React.FC<AddTransactionModalProps> = ({ visible, onClose, initialData, defaultRecurring = false, mode = 'transaction' }) => {
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { addTransaction, updateTransaction, isCreating, isLoading } = useLedgerStore();

  const [type, setType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'POS' | 'IBAN'>('CASH');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');

  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [newCategory, setNewCategory] = useState('');

  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'>('MONTHLY');

  // Form temizleme
  React.useEffect(() => {
    if (visible) {
      if (initialData) {
        setType(initialData.type);
        setAmount((initialData.amount / 100).toString());
        setMethod(initialData.method);
        setCategory(initialData.category || '');
        setDescription(initialData.description || '');
        setNewCategory('');
        setIsRecurring(defaultRecurring);
        setFrequency('MONTHLY');
      } else {
        setType('EXPENSE');
        setAmount('');
        setMethod('CASH');
        setCategory('');
        setDescription('');
        setNewCategory('');
        setIsRecurring(mode === 'recurring' ? true : defaultRecurring);
        setFrequency('MONTHLY');
      }
    }
  }, [visible, initialData, mode, defaultRecurring]);

  const handleAddCategory = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      setCategories([...categories, newCategory.trim()]);
      setCategory(newCategory.trim());
      setNewCategory('');
    }
  };

  const handleSubmit = async () => {
    if (!amount.trim() || !category.trim() || !method) {
      Alert.alert(t('addTransactionModal.errorMissingTitle'), t('addTransactionModal.errorMissingMsg'));
      return;
    }

    const numericAmount = parseFloat(amount.replace(',', '.'));
    if (isNaN(numericAmount) || numericAmount <= 0) {
      Alert.alert(t('addTransactionModal.errorInvalidTitle'), t('addTransactionModal.errorInvalidMsg'));
      return;
    }

    try {
      if (initialData) {
        if (mode === 'transaction') {
          await updateTransaction(initialData._id, {
            type,
            amount: Math.round(numericAmount * 100),
            method,
            category,
            description: description.trim() || undefined,
          });
        }
      } else {
        if (mode === 'transaction') {
          await addTransaction({
            type,
            amount: Math.round(numericAmount * 100),
            method,
            category,
            description: description.trim() || undefined,
          });
        }

        if ((isRecurring && mode === 'transaction') || mode === 'recurring') {
          useRecurringStore.getState().addRecurring({
            type,
            amount: Math.round(numericAmount * 100),
            method,
            category,
            description: description.trim() || undefined,
            frequency,
          });
        }
      }

      onClose();
    } catch (err) {
      Alert.alert(t('addTransactionModal.errorSaveTitle'), t('addTransactionModal.errorSaveMsg'));
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalOverlay, { padding: theme.spacing.lg }]}>
        <Pressable style={[styles.modalOverlay, { padding: theme.spacing.lg }]} onPress={onClose}>
          <Pressable style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.xl, padding: theme.spacing.xl, ...theme.shadows.card, maxHeight: '90%' }} onPress={(e) => e.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={[styles.header, { marginBottom: theme.spacing.xl }]}>
                <Text style={{ fontFamily: theme.fonts.bold, fontSize: theme.fontSizes.xl, color: theme.colors.textPrimary }}>
                  {initialData ? 'İşlemi Güncelle' : mode === 'recurring' ? 'Hatırlatıcı Ekle' : t('addTransactionModal.title')}
                </Text>
                <Pressable onPress={onClose} hitSlop={8}>
                  <Icon name="x" size={24} color={theme.colors.textTertiary} />
                </Pressable>
              </View>

              {/* Type Selection */}
              <View style={[styles.typeSelector, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, marginBottom: theme.spacing.md }]}>
                <Pressable
                  style={[styles.typeBtn, { paddingVertical: theme.spacing.sm, borderRadius: theme.radii.sm }, type === 'INCOME' && styles.typeBtnIncome]}
                  onPress={() => setType('INCOME')}
                >
                  <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.sm, color: type === 'INCOME' ? theme.colors.successLight : theme.colors.textTertiary }}>{t('addTransactionModal.typeIncome')}</Text>
                </Pressable>
                <Pressable
                  style={[styles.typeBtn, { paddingVertical: theme.spacing.sm, borderRadius: theme.radii.sm }, type === 'EXPENSE' && styles.typeBtnExpense]}
                  onPress={() => setType('EXPENSE')}
                >
                  <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.sm, color: type === 'EXPENSE' ? theme.colors.dangerLight : theme.colors.textTertiary }}>{t('addTransactionModal.typeExpense')}</Text>
                </Pressable>
              </View>

              {/* Amount */}
              <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, marginBottom: theme.spacing.md }]}>
                <Icon name="dollar-sign" size={16} color={theme.colors.textTertiary} />
                <TextInput
                  style={{ flex: 1, fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }}
                  placeholder={t('addTransactionModal.amount')}
                  placeholderTextColor={theme.colors.textTertiary}
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={setAmount}
                />
              </View>

              {/* Category Options */}
              <View style={{ marginBottom: theme.spacing.md }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.sm }}>
                  {categories.map((cat) => (
                    <Pressable
                      key={cat}
                      style={[{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.radii.full, backgroundColor: theme.colors.card }, category === cat && { backgroundColor: theme.colors.accent }]}
                      onPress={() => setCategory(cat)}
                    >
                      <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: category === cat ? theme.colors.textPrimary : theme.colors.textSecondary }}>{cat}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, marginBottom: 0 }]}>
                  <Icon name="list" size={16} color={theme.colors.textTertiary} />
                  <TextInput
                    style={{ flex: 1, fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }}
                    placeholder={t('addTransactionModal.newCategory')}
                    placeholderTextColor={theme.colors.textTertiary}
                    value={newCategory}
                    onChangeText={setNewCategory}
                  />
                  <Pressable onPress={handleAddCategory} hitSlop={8}>
                    <Icon name="plus" size={20} color={theme.colors.accent} />
                  </Pressable>
                </View>
              </View>

              {/* Method */}
              <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, marginBottom: theme.spacing.md }]}>
                <Icon name="credit-card" size={16} color={theme.colors.textTertiary} />
                <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', marginLeft: theme.spacing.sm, gap: theme.spacing.xs }}>
                  {(['CASH', 'POS', 'IBAN'] as const).map((m) => (
                    <Pressable
                      key={m}
                      style={[{ flex: 1, alignItems: 'center', paddingVertical: theme.spacing.xs, borderRadius: theme.radii.sm }, method === m && { backgroundColor: theme.colors.accentTransparent }]}
                      onPress={() => setMethod(m)}
                    >
                      <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.xs, color: method === m ? theme.colors.accent : theme.colors.textTertiary }}>
                        {m === 'CASH' ? t('addTransactionModal.cash') : m === 'POS' ? t('addTransactionModal.pos') : t('addTransactionModal.transfer')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Description */}
              <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, marginBottom: theme.spacing.md }]}>
                <Icon name="file-text" size={16} color={theme.colors.textTertiary} />
                <TextInput
                  style={{ flex: 1, fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }}
                  placeholder={t('addTransactionModal.description')}
                  placeholderTextColor={theme.colors.textTertiary}
                  value={description}
                  onChangeText={setDescription}
                />
              </View>

              {/* Recurring Toggle */}
              {mode !== 'recurring' && (
                <View style={{ backgroundColor: theme.colors.card, borderRadius: theme.radii.base, padding: theme.spacing.base, marginBottom: theme.spacing.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="repeat" size={16} color={theme.colors.textTertiary} />
                    <Text style={{ flex: 1, fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }}>Hatırlatıcı Ekle</Text>
                    <Switch
                      value={isRecurring}
                      onValueChange={setIsRecurring}
                      trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                      thumbColor={theme.colors.primary}
                      style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                    />
                  </View>
                  {isRecurring && (
                    <View style={{ flexDirection: 'row', marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
                      {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((f) => (
                        <Pressable
                          key={f}
                          style={[{ flex: 1, alignItems: 'center', paddingVertical: theme.spacing.xs, borderRadius: theme.radii.sm, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }, frequency === f && { backgroundColor: 'rgba(37, 99, 235, 0.1)' }]}
                          onPress={() => setFrequency(f)}
                        >
                          <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.xs, color: frequency === f ? theme.colors.accent : theme.colors.textTertiary }}>
                            {f === 'DAILY' ? 'Günlük' : f === 'WEEKLY' ? 'Hft.' : f === 'MONTHLY' ? 'Aylık' : 'Yıllık'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {mode === 'recurring' && (
                <View style={{ backgroundColor: theme.colors.card, borderRadius: theme.radii.base, padding: theme.spacing.base, marginBottom: theme.spacing.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.md }}>
                    <Icon name="clock" size={16} color={theme.colors.textTertiary} />
                    <Text style={{ flex: 1, fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }}>Tekrarlanma Sıklığı</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
                    {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((f) => (
                      <Pressable
                        key={f}
                        style={[{ flex: 1, alignItems: 'center', paddingVertical: theme.spacing.xs, borderRadius: theme.radii.sm, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }, frequency === f && { backgroundColor: 'rgba(37, 99, 235, 0.1)' }]}
                        onPress={() => setFrequency(f)}
                      >
                        <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.xs, color: frequency === f ? theme.colors.accent : theme.colors.textTertiary }}>
                          {f === 'DAILY' ? 'Günlük' : f === 'WEEKLY' ? 'Hft.' : f === 'MONTHLY' ? 'Aylık' : 'Yıllık'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {/* Submit Button */}
              <Pressable
                style={({ pressed }) => [{ backgroundColor: theme.colors.accent, borderRadius: theme.radii.base, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.sm, ...theme.shadows.button }, pressed && { opacity: 0.9 }]}
                onPress={handleSubmit}
                disabled={isCreating || isLoading}
              >
                {isCreating || isLoading ? (
                  <ActivityIndicator size="small" color={theme.colors.surface} />
                ) : (
                  <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: theme.colors.surface, letterSpacing: 0.3 }}>{initialData ? 'Güncelle' : t('addTransactionModal.save')}</Text>
                )}
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.60)', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeSelector: { flexDirection: 'row', padding: 4 },
  typeBtn: { flex: 1, alignItems: 'center' },
  typeBtnIncome: { backgroundColor: 'rgba(16,185,129,0.15)' },
  typeBtnExpense: { backgroundColor: 'rgba(248,113,113,0.15)' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', paddingVertical: Platform.select({ ios: 14, android: 8 }) },
});

export default AddTransactionModal;
