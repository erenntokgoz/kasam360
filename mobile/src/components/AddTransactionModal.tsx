import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, TextInput,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { useDebtStore } from '../store/useDebtStore';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { useContactStore } from '../store/useContactStore';
import { useStaffStore } from '../store/useStaffStore';

interface AddTransactionModalProps {
  visible: boolean;
  onClose: () => void;
  initialType?: MainType;
  initialSubType?: string;
}

type Step = 'TYPE' | 'AMOUNT' | 'SUBTYPE' | 'WHO' | 'DATE' | 'DESC';
export type MainType = 'BORÇ' | 'ALACAK' | 'GELİR' | 'GİDER';

const AddTransactionModal: React.FC<AddTransactionModalProps> = ({ visible, onClose, initialType, initialSubType }) => {
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { addTransaction, isCreating } = useLedgerStore();
  const { addDebt } = useDebtStore();
  const { contacts, addContact } = useContactStore();
  const { staffList, addStaff, addPaymentToStaff } = useStaffStore();

  const [step, setStep] = useState<Step>('TYPE');
  const [mainType, setMainType] = useState<MainType | null>(null);
  const [amount, setAmount] = useState('');
  const [subType, setSubType] = useState(''); // POS, CASH, IBAN or Business, Personnel, Personal
  const [who, setWho] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (visible) {
      setMainType(initialType || null);
      setSubType(initialSubType || '');
      setStep(initialType ? 'AMOUNT' : 'TYPE');
      setAmount('');
      setWho('');
      setDate('');
      setDescription('');
    }
  }, [visible, initialType, initialSubType]);

  const handleNext = () => {
    if (step === 'TYPE') {
      if (!mainType) return;
      setStep('AMOUNT');
    } else if (step === 'AMOUNT') {
      if (!amount) return;
      if (mainType === 'GELİR' || mainType === 'GİDER') setStep('SUBTYPE');
      else setStep('WHO');
    } else if (step === 'SUBTYPE') {
      if (!subType) return;
      if (subType === 'Personel Gideri') setStep('WHO');
      else setStep('DESC');
    } else if (step === 'WHO') {
      if (!who) return;
      if (subType === 'Personel Gideri') {
        if (!staffList.find(s => s.name.toLowerCase() === who.trim().toLowerCase())) {
          addStaff(who.trim());
        }
      } else {
        if (!contacts.find(c => c.name.toLowerCase() === who.trim().toLowerCase())) {
          addContact(who.trim());
        }
      }
      setStep(mainType === 'GELİR' || mainType === 'GİDER' ? 'DESC' : 'DATE');
    } else if (step === 'DATE') {
      setStep('DESC');
    } else if (step === 'DESC') {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (step === 'AMOUNT') {
      if (initialType) onClose(); else setStep('TYPE');
    }
    else if (step === 'SUBTYPE') setStep('AMOUNT');
    else if (step === 'WHO') {
      if (mainType === 'GELİR' || mainType === 'GİDER') {
        if (initialSubType) setStep('AMOUNT'); else setStep('SUBTYPE');
      }
      else setStep('AMOUNT');
    }
    else if (step === 'DATE') setStep('WHO');
    else if (step === 'DESC') {
      if (subType === 'Personel Gideri') setStep('WHO');
      else if (mainType === 'GELİR' || mainType === 'GİDER') {
        if (initialSubType) setStep('AMOUNT'); else setStep('SUBTYPE');
      }
      else setStep('DATE');
    }
  };

  const handleSubmit = async () => {
    const numericAmount = parseFloat(amount.replace(',', '.'));
    const cents = Math.round(numericAmount * 100);

    try {
      if (mainType === 'GELİR') {
        await addTransaction({
          type: 'INCOME',
          amount: cents,
          method: subType as any,
          category: 'Gelir',
          description: description.trim() || undefined,
        });
      } else if (mainType === 'GİDER') {
        const finalDesc = subType === 'Personel Gideri' && who 
          ? `${who} kişisine personel ödemesi${description ? ' - ' + description : ''}`
          : description.trim() || undefined;

        await addTransaction({
          type: 'EXPENSE',
          amount: cents,
          method: 'CASH', // Default for expense, subtype used as category
          category: subType,
          description: finalDesc,
        });

        if (subType === 'Personel Gideri' && who) {
          const staff = useStaffStore.getState().staffList.find(s => s.name.toLowerCase() === who.toLowerCase());
          if (staff) {
            useStaffStore.getState().addPaymentToStaff(staff.id, cents);
          }
        }
      } else if (mainType === 'BORÇ') {
        await addDebt({
          entityName: who,
          type: 'TAKEN',
          totalAmount: cents,
          dueDate: date || undefined,
        });
      } else if (mainType === 'ALACAK') {
        await addDebt({
          entityName: who,
          type: 'GIVEN',
          totalAmount: cents,
          dueDate: date || undefined,
        });
      }
      onClose();
    } catch (err) {
      Alert.alert('Hata', 'İşlem kaydedilemedi.');
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
          <View style={styles.header}>
            <Pressable onPress={step === 'TYPE' ? onClose : handleBack} hitSlop={12}>
              <Icon name={step === 'TYPE' ? 'x' : 'arrow-left'} size={24} color={theme.colors.textPrimary} />
            </Pressable>
            <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Yeni İşlem</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.stepContainer}>
            {step === 'TYPE' && (
              <Animated.View entering={FadeInRight} exiting={FadeOutLeft} style={styles.stepContent}>
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>İşlem tipi seçiniz:</Text>
                <View style={styles.grid}>
                  <TypeBox icon="arrow-up-right" label="BORÇ" subLabel="Para Aldım" color={theme.colors.success} active={mainType === 'BORÇ'} onSelect={() => { setMainType('BORÇ'); setStep('AMOUNT'); }} theme={theme} />
                  <TypeBox icon="arrow-down-left" label="ALACAK" subLabel="Para Verdim" color={theme.colors.danger} active={mainType === 'ALACAK'} onSelect={() => { setMainType('ALACAK'); setStep('AMOUNT'); }} theme={theme} />
                  <TypeBox icon="plus-circle" label="GELİR" subLabel="Kasa Girişi" color={theme.colors.success} active={mainType === 'GELİR'} onSelect={() => { setMainType('GELİR'); setStep('AMOUNT'); }} theme={theme} />
                  <TypeBox icon="minus-circle" label="GİDER" subLabel="Kasa Çıkışı" color={theme.colors.danger} active={mainType === 'GİDER'} onSelect={() => { setMainType('GİDER'); setStep('AMOUNT'); }} theme={theme} />
                </View>
              </Animated.View>
            )}

            {step === 'AMOUNT' && (
              <Animated.View entering={FadeInRight} exiting={FadeOutLeft} style={styles.stepContent}>
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>Tutar giriniz:</Text>
                <TextInput
                  style={[styles.bigInput, { color: theme.colors.textPrimary }]}
                  placeholder="0.00 ₺"
                  placeholderTextColor={theme.colors.textTertiary}
                  keyboardType="decimal-pad"
                  autoFocus
                  value={amount}
                  onChangeText={setAmount}
                />
                <NextBtn onPress={handleNext} theme={theme} />
              </Animated.View>
            )}

            {step === 'SUBTYPE' && (
              <Animated.View entering={FadeInRight} exiting={FadeOutLeft} style={styles.stepContent}>
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>{mainType === 'GELİR' ? 'Ödeme yöntemi seçiniz:' : 'Gider tipi seçiniz:'}</Text>
                <View style={styles.subtypeList}>
                  {mainType === 'GELİR' ? (
                    <>
                      <SubtypeItem label="POS" icon="credit-card" active={subType === 'POS'} onSelect={() => { setSubType('POS'); setStep('DESC'); }} theme={theme} />
                      <SubtypeItem label="Nakit" icon="dollar-sign" active={subType === 'CASH'} onSelect={() => { setSubType('CASH'); setStep('DESC'); }} theme={theme} />
                      <SubtypeItem label="Havale" icon="send" active={subType === 'IBAN'} onSelect={() => { setSubType('IBAN'); setStep('DESC'); }} theme={theme} />
                    </>
                  ) : (
                    <>
                      <SubtypeItem label="İşletme Gideri" icon="briefcase" active={subType === 'İşletme Gideri'} onSelect={() => { setSubType('İşletme Gideri'); setStep('DESC'); }} theme={theme} />
                      <SubtypeItem label="Personel Gideri" icon="users" active={subType === 'Personel Gideri'} onSelect={() => { setSubType('Personel Gideri'); setStep('DESC'); }} theme={theme} />
                      <SubtypeItem label="Kişisel Gider" icon="user" active={subType === 'Kişisel Gider'} onSelect={() => { setSubType('Kişisel Gider'); setStep('DESC'); }} theme={theme} />
                    </>
                  )}
                </View>
              </Animated.View>
            )}

            {step === 'WHO' && (
              <Animated.View entering={FadeInRight} exiting={FadeOutLeft} style={styles.stepContent}>
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>{mainType === 'BORÇ' ? 'Kimden aldınız?' : (mainType === 'ALACAK' ? 'Kime verdiniz?' : 'Kime ödeme yapıldı?')}</Text>
                <View style={[styles.searchBar, { backgroundColor: theme.colors.card, marginBottom: 12 }]}>
                  <Icon name="search" size={16} color={theme.colors.textTertiary} />
                  <TextInput
                    style={{ flex: 1, color: theme.colors.textPrimary, marginLeft: 8 }}
                    placeholder="Kişi Ara veya Yeni Ekle..."
                    placeholderTextColor={theme.colors.textTertiary}
                    value={who}
                    onChangeText={setWho}
                  />
                </View>
                <ScrollView style={{ maxHeight: 200, marginBottom: 12 }}>
                  {subType === 'Personel Gideri' ? (
                    <>
                      {staffList.filter(s => s.name.toLowerCase().includes(who.toLowerCase())).map(s => (
                        <Pressable
                          key={s.name}
                          style={[styles.contactItem, { backgroundColor: theme.colors.card }]}
                          onPress={() => { setWho(s.name); setStep(mainType === 'GELİR' || mainType === 'GİDER' ? 'DESC' : 'DATE'); }}
                        >
                          <Icon name="user" size={16} color={theme.colors.textSecondary} />
                          <Text style={{ color: theme.colors.textPrimary, fontWeight: '500' }}>{s.name}</Text>
                        </Pressable>
                      ))}
                      {who.length > 0 && !staffList.find(s => s.name.toLowerCase() === who.toLowerCase()) && (
                        <Pressable
                          style={[styles.contactItem, { backgroundColor: theme.colors.accentTransparent }]}
                          onPress={() => { 
                            addStaff(who);
                            setStep(mainType === 'GELİR' || mainType === 'GİDER' ? 'DESC' : 'DATE');
                          }}
                        >
                          <Icon name="user-plus" size={16} color={theme.colors.accent} />
                          <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>Yeni Personel Ekle ("{who}")</Text>
                        </Pressable>
                      )}
                    </>
                  ) : (
                    <>
                      {contacts.filter(c => c.name.toLowerCase().includes(who.toLowerCase())).map(c => (
                        <Pressable
                          key={c.name}
                          style={[styles.contactItem, { backgroundColor: theme.colors.card }]}
                          onPress={() => { setWho(c.name); setStep(mainType === 'GELİR' || mainType === 'GİDER' ? 'DESC' : 'DATE'); }}
                        >
                          <Icon name="user" size={16} color={theme.colors.textSecondary} />
                          <Text style={{ color: theme.colors.textPrimary, fontWeight: '500' }}>{c.name}</Text>
                        </Pressable>
                      ))}
                      {who.length > 0 && !contacts.find(c => c.name.toLowerCase() === who.toLowerCase()) && (
                        <Pressable
                          style={[styles.contactItem, { backgroundColor: theme.colors.accentTransparent }]}
                          onPress={() => { 
                            addContact(who);
                            setStep(mainType === 'GELİR' || mainType === 'GİDER' ? 'DESC' : 'DATE');
                          }}
                        >
                          <Icon name="user-plus" size={16} color={theme.colors.accent} />
                          <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>Yeni Kişi Ekle ("{who}")</Text>
                        </Pressable>
                      )}
                    </>
                  )}
                </ScrollView>
                <NextBtn onPress={handleNext} theme={theme} />
              </Animated.View>
            )}

            {step === 'DATE' && (
              <Animated.View entering={FadeInRight} exiting={FadeOutLeft} style={styles.stepContent}>
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>Geri ödeme tarihi (isteğe bağlı):</Text>
                <TextInput
                  style={[styles.input, { color: theme.colors.textPrimary, borderBottomColor: theme.colors.border }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.colors.textTertiary}
                  keyboardType="numeric"
                  autoFocus
                  value={date}
                  onChangeText={setDate}
                />
                <NextBtn onPress={handleNext} theme={theme} />
              </Animated.View>
            )}

            {step === 'DESC' && (
              <Animated.View entering={FadeInRight} exiting={FadeOutLeft} style={styles.stepContent}>
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>Açıklama (isteğe bağlı):</Text>
                <TextInput
                  style={[styles.input, { color: theme.colors.textPrimary, borderBottomColor: theme.colors.border }]}
                  placeholder="Bir şeyler yazın..."
                  placeholderTextColor={theme.colors.textTertiary}
                  autoFocus
                  value={description}
                  onChangeText={setDescription}
                />
                <Pressable
                  style={[styles.finishBtn, { backgroundColor: theme.colors.accent }]}
                  onPress={handleSubmit}
                  disabled={isCreating}
                >
                  {isCreating ? <ActivityIndicator color="#fff" /> : <Text style={styles.finishBtnText}>İŞLEMİ TAMAMLA</Text>}
                </Pressable>
              </Animated.View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const TypeBox = ({ icon, label, subLabel, color, active, onSelect, theme }: any) => (
  <Pressable
    style={[styles.typeBox, { backgroundColor: theme.colors.card, borderColor: active ? color : 'transparent' }]}
    onPress={onSelect}
  >
    <View style={[styles.iconCircle, { backgroundColor: color + '20' }]}>
      <Icon name={icon} size={24} color={color} />
    </View>
    <Text style={[styles.typeLabel, { color: theme.colors.textPrimary }]}>{label}</Text>
    <Text style={[styles.typeSubLabel, { color: theme.colors.textTertiary }]}>{subLabel}</Text>
  </Pressable>
);

const SubtypeItem = ({ label, icon, active, onSelect, theme }: any) => (
  <Pressable
    style={[styles.subtypeItem, { backgroundColor: theme.colors.card, borderColor: active ? theme.colors.accent : 'transparent' }]}
    onPress={onSelect}
  >
    <Icon name={icon} size={20} color={active ? theme.colors.accent : theme.colors.textSecondary} />
    <Text style={[styles.subtypeLabel, { color: active ? theme.colors.accent : theme.colors.textPrimary }]}>{label}</Text>
  </Pressable>
);

const NextBtn = ({ onPress, theme }: any) => (
  <Pressable style={[styles.nextBtn, { backgroundColor: theme.colors.accent }]} onPress={onPress}>
    <Text style={styles.nextBtnText}>DEVAM ET</Text>
    <Icon name="chevron-right" size={20} color="#fff" />
  </Pressable>
);

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  content: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, minHeight: 450 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 18, fontWeight: '700' },
  stepContainer: { flex: 1 },
  stepContent: { flex: 1 },
  stepLabel: { fontSize: 16, fontWeight: '600', marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  typeBox: { width: '48%', padding: 20, borderRadius: 20, borderWidth: 2, alignItems: 'center' },
  iconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  typeLabel: { fontSize: 16, fontWeight: '700' },
  typeSubLabel: { fontSize: 11, fontWeight: '500', marginTop: 4 },
  bigInput: { fontSize: 48, fontWeight: '700', textAlign: 'center', marginVertical: 40 },
  input: { fontSize: 24, fontWeight: '600', borderBottomWidth: 2, paddingVertical: 12, marginBottom: 40 },
  subtypeList: { gap: 12 },
  subtypeItem: { flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 16, borderWidth: 2, gap: 16 },
  subtypeLabel: { fontSize: 16, fontWeight: '600' },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 16, gap: 8 },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  finishBtn: { paddingVertical: 18, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  finishBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 44, borderRadius: 12 },
  contactItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, marginBottom: 8, gap: 12 },
});

export default AddTransactionModal;
