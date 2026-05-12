import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, TextInput,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Switch
} from 'react-native';
import DatePicker from 'react-native-date-picker';
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
  initialWho?: string;
}

type Step = 'TYPE' | 'AMOUNT' | 'SUBTYPE' | 'METHOD' | 'WHO' | 'DATE' | 'DESC';
export type MainType = 'BORÇ' | 'ALACAK' | 'GELİR' | 'GİDER';

const AddTransactionModal: React.FC<AddTransactionModalProps> = ({ visible, onClose, initialType, initialSubType, initialWho }) => {
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { addTransaction, isCreating } = useLedgerStore();
  const { addDebt } = useDebtStore();
  const { contacts, addContact } = useContactStore();
  const { staffList, addStaff } = useStaffStore();

  const [step, setStep] = useState<Step>('TYPE');
  const [mainType, setMainType] = useState<MainType | null>(null);
  const [amount, setAmount] = useState('');
  const [subType, setSubType] = useState(''); // POS, CASH, IBAN or Business, Personnel, Personal
  const [who, setWho] = useState('');
  const [date, setDate] = useState(new Date());
  const [method, setMethod] = useState<'CASH' | 'POS' | 'IBAN'>('CASH');
  const [description, setDescription] = useState('');
  const [isCash, setIsCash] = useState(false); // Default to Veresiye (false)
  const [isProcessing, setIsProcessing] = useState(false);


  useEffect(() => {
    if (visible) {
      setMainType(initialType || null);
      setSubType(initialSubType || '');
      setStep(initialType ? 'AMOUNT' : 'TYPE');
      setAmount('');
      setWho(initialWho || '');
      setDate(new Date());
      setMethod('CASH');
      setDescription('');
      setIsCash(false);
    }
  }, [visible, initialType, initialSubType, initialWho]);

  const handleNext = async () => {
    if (step === 'TYPE') {
      if (!mainType) return;
      setStep('AMOUNT');
    } else if (step === 'AMOUNT') {
      if (!amount) return;
      if (mainType === 'GELİR') {
        setStep('METHOD');
      } else if (mainType === 'GİDER') {
        if (initialSubType) {
          setSubType(initialSubType);
          if (initialSubType === 'Kişisel Gider') setStep('DESC');
          else setStep('WHO');
        } else {
          setStep('SUBTYPE');
        }
      } else {
        // BORÇ or ALACAK → kime/kimden sorusu
        setStep('WHO');
      }
    } else if (step === 'SUBTYPE') {
      if (!subType) return;
      if (subType === 'Kişisel Gider') setStep('DESC');
      else setStep('WHO');
    } else if (step === 'WHO') {
      if (!who && mainType !== 'GELİR') return;
      
      if (who) {
        if (mainType === 'GİDER' && subType === 'Personel Gideri') {
          if (!staffList.find(s => s.name.toLowerCase() === who.trim().toLowerCase())) {
            try { await addStaff(who.trim()); } catch (e) {}
          }
        } else {
          if (!contacts.find(c => c.name.toLowerCase() === who.trim().toLowerCase())) {
            try { await addContact(who.trim()); } catch (e) {}
          }
        }
      }
      
      // BORÇ/ALACAK → vade tarihi seç, diğerleri → devam
      if (mainType === 'BORÇ' || mainType === 'ALACAK') {
        setStep('DATE');
      } else {
        setStep('DESC');
      }
    } else if (step === 'METHOD') {
      setStep('DESC');
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
    else if (step === 'METHOD') {
      setStep('AMOUNT');
    }
    else if (step === 'SUBTYPE') {
      setStep('AMOUNT');
    }
    else if (step === 'WHO') {
      if (mainType === 'GİDER') {
        if (initialSubType) setStep('AMOUNT');
        else setStep('SUBTYPE');
      } else {
        setStep('AMOUNT');
      }
    }
    else if (step === 'DATE') {
      setStep('WHO');
    }
    else if (step === 'DESC') {
      if (mainType === 'GELİR') setStep('METHOD');
      else if (mainType === 'GİDER') {
        if (subType === 'Kişisel Gider') {
          if (initialSubType) setStep('AMOUNT');
          else setStep('SUBTYPE');
        } else {
          setStep('WHO');
        }
      } else {
        // BORÇ/ALACAK → DATE'e geri dön
        setStep('DATE');
      }
    }
  };

  const handleSubmit = async () => {
    const numericAmount = parseFloat(amount.replace(',', '.'));
    const cents = Math.round(numericAmount * 100);

    try {
      const syncId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (mainType === 'GELİR') {
        const methodLabels: Record<string, string> = { 'CASH': 'Nakit', 'POS': 'POS', 'IBAN': 'Havale' };
        const methodLabel = methodLabels[method] || method;
        const finalDesc = `${methodLabel} Gelir${description ? ' - ' + description.trim() : ''}`;

        await addTransaction({
          type: 'INCOME',
          amount: cents,
          method: method,
          category: 'Gelir',
          description: finalDesc,
          transactionDate: date.toISOString(),
          syncId,
        });
      } else if (mainType === 'GİDER') {
        let finalRelatedId = undefined;
        let finalRelatedType = undefined;
        const trimmedWho = who.trim();

        if (trimmedWho && subType !== 'Kişisel Gider') {
          if (subType === 'Personel Gideri') {
            const staff = useStaffStore.getState().staffList.find(s => s.name.toLowerCase() === trimmedWho.toLowerCase());
            if (staff) {
              finalRelatedId = staff.id;
              finalRelatedType = 'STAFF';
            }
          } else {
            const contact = useContactStore.getState().contacts.find(c => c.name.toLowerCase() === trimmedWho.toLowerCase());
            if (contact) {
              finalRelatedId = contact.id;
              finalRelatedType = 'CONTACT';
            }
          }
        }

        const methodLabels: Record<string, string> = { 'CASH': 'Nakit', 'POS': 'POS', 'IBAN': 'Havale' };
        const methodLabel = methodLabels[method] || method;
        
        let formattedDesc = '';
        if (subType === 'Kişisel Gider') {
          formattedDesc = `Kişisel Gider${description ? ' - ' + description.trim() : ''}`;
        } else if (subType === 'Personel Gideri') {
          formattedDesc = `${trimmedWho} - ${subType} (${methodLabel})${description ? ' - ' + description.trim() : ''}`;
        } else if (trimmedWho) {
          formattedDesc = `${trimmedWho} - ${subType} (${methodLabel})${description ? ' - ' + description.trim() : ''}`;
        } else {
          formattedDesc = `${subType} (${methodLabel})${description ? ' - ' + description.trim() : ''}`;
        }

        await addTransaction({
          type: 'EXPENSE',
          amount: cents,
          method: method,
          category: subType,
          description: formattedDesc,
          transactionDate: date.toISOString(),
          syncId,
          relatedId: finalRelatedId,
          relatedType: finalRelatedType as any,
          directoryId: finalRelatedId,
          directoryType: finalRelatedType as any
        });

      } else if (mainType === 'BORÇ' || mainType === 'ALACAK') {
        const trimmedWho = who.trim();
        let finalRelatedId = undefined;
        let finalRelatedType: 'CONTACT' | 'STAFF' = 'CONTACT';

        if (trimmedWho) {
          const contact = useContactStore.getState().contacts.find(c => c.name.toLowerCase() === trimmedWho.toLowerCase());
          if (contact) {
            finalRelatedId = contact.id;
            finalRelatedType = 'CONTACT';
          } else {
            const staff = useStaffStore.getState().staffList.find(s => s.name.toLowerCase() === trimmedWho.toLowerCase());
            if (staff) {
              finalRelatedId = staff.id;
              finalRelatedType = 'STAFF';
            }
          }
        }

        const desc = mainType === 'BORÇ' 
          ? `${who} kişisinden borç alındı${description ? ' - ' + description.trim() : ''}`
          : `${who} kişisine alacak kaydedildi${description ? ' - ' + description.trim() : ''}`;

        await addDebt({
          entityName: who,
          type: mainType === 'BORÇ' ? 'TAKEN' : 'GIVEN',
          totalAmount: cents,
          dueDate: date.toISOString().split('T')[0],
          description: desc,
          isCash,
          syncId,
          relatedId: finalRelatedId,
          relatedType: finalRelatedType
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
                {(mainType === 'BORÇ' || mainType === 'ALACAK') && (
                  <View style={[styles.switchContainer, { backgroundColor: theme.colors.card }]}>
                    <View style={{ flex: 1, marginRight: 16 }}>
                      <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.textPrimary, marginBottom: 4 }}>
                        Nakit İşlem mi?
                      </Text>
                      <Text style={{ fontSize: 12, color: theme.colors.textTertiary, lineHeight: 16 }}>
                        Açık ise kasanız etkilenir (Örn: Nakit para borç verdim). Kapalı ise sadece deftere yazılır (Örn: Veresiye mal sattım).
                      </Text>
                    </View>
                    <Switch
                      value={isCash}
                      onValueChange={setIsCash}
                      trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                      thumbColor="#fff"
                    />
                  </View>
                )}
                <NextBtn onPress={handleNext} theme={theme} />
              </Animated.View>
            )}

            {step === 'SUBTYPE' && (
              <Animated.View entering={FadeInRight} exiting={FadeOutLeft} style={styles.stepContent}>
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>Gider tipi seçiniz:</Text>
                <View style={styles.subtypeList}>
                  <SubtypeItem label="İşletme Gideri" icon="briefcase" active={subType === 'İşletme Gideri'} onSelect={() => { setSubType('İşletme Gideri'); handleNext(); }} theme={theme} />
                  <SubtypeItem label="Personel Gideri" icon="users" active={subType === 'Personel Gideri'} onSelect={() => { setSubType('Personel Gideri'); handleNext(); }} theme={theme} />
                  <SubtypeItem label="Kişisel Gider" icon="user" active={subType === 'Kişisel Gider'} onSelect={() => { setSubType('Kişisel Gider'); handleNext(); }} theme={theme} />
                </View>
              </Animated.View>
            )}

            {step === 'METHOD' && (
              <Animated.View entering={FadeInRight} exiting={FadeOutLeft} style={styles.stepContent}>
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>Ödeme yöntemi seçiniz:</Text>
                <View style={styles.subtypeList}>
                  <SubtypeItem label="Nakit" icon="dollar-sign" active={method === 'CASH'} onSelect={() => { setMethod('CASH'); handleNext(); }} theme={theme} />
                  <SubtypeItem label="POS" icon="credit-card" active={method === 'POS'} onSelect={() => { setMethod('POS'); handleNext(); }} theme={theme} />
                  <SubtypeItem label="Havale" icon="send" active={method === 'IBAN'} onSelect={() => { setMethod('IBAN'); handleNext(); }} theme={theme} />
                </View>
              </Animated.View>
            )}

            {step === 'WHO' && (
              <Animated.View entering={FadeInRight} exiting={FadeOutLeft} style={styles.stepContent}>
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>
                  {mainType === 'BORÇ' ? 'Kimden aldınız?' : (mainType === 'ALACAK' ? 'Kime verdiniz?' : (mainType === 'GELİR' ? 'Kimden? (İsteğe bağlı)' : 'Kime?'))}
                </Text>
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
                  {mainType === 'GİDER' && subType === 'Personel Gideri' ? (
                    <>
                      {staffList.filter(s => s.name.toLowerCase().includes(who.toLowerCase())).map(s => (
                        <Pressable
                          key={s.id}
                          style={[styles.contactItem, { backgroundColor: theme.colors.card }]}
                          onPress={() => { setWho(s.name); handleNext(); }}
                        >
                          <Icon name="user" size={16} color={theme.colors.textSecondary} />
                          <Text style={{ color: theme.colors.textPrimary, fontWeight: '500' }}>{s.name}</Text>
                        </Pressable>
                      ))}
                      {who.length > 0 && !staffList.find(s => s.name.toLowerCase() === who.toLowerCase()) && (
                        <Pressable
                          style={[styles.contactItem, { backgroundColor: theme.colors.accentTransparent }]}
                          onPress={async () => { 
                            try {
                              setIsProcessing(true);
                              await useStaffStore.getState().addStaff(who);
                              await useStaffStore.getState().fetchStaff();
                              setIsProcessing(false);
                              handleNext(); 
                            } catch (e) {
                              setIsProcessing(false);
                              Alert.alert('Hata', 'Personel eklenemedi.');
                            }
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
                          key={c.id}
                          style={[styles.contactItem, { backgroundColor: theme.colors.card }]}
                          onPress={() => { setWho(c.name); handleNext(); }}
                        >
                          <Icon name="user" size={16} color={theme.colors.textSecondary} />
                          <Text style={{ color: theme.colors.textPrimary, fontWeight: '500' }}>{c.name}</Text>
                        </Pressable>
                      ))}
                      {who.length > 0 && !contacts.find(c => c.name.toLowerCase() === who.toLowerCase()) && (
                        <Pressable
                          style={[styles.contactItem, { backgroundColor: theme.colors.accentTransparent }]}
                          onPress={async () => { 
                            try {
                              setIsProcessing(true);
                              await useContactStore.getState().addContact(who);
                              await useContactStore.getState().fetchContacts();
                              setIsProcessing(false);
                              handleNext(); 
                            } catch (e) {
                              setIsProcessing(false);
                              Alert.alert('Hata', 'Kişi eklenemedi.');
                            }
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
                <Text style={[styles.stepLabel, { color: theme.colors.textSecondary }]}>Vade/İşlem Tarihi Seçiniz:</Text>
                <View style={{ alignItems: 'center', marginVertical: 20 }}>
                  <DatePicker
                    date={date}
                    onDateChange={setDate}
                    mode="date"
                    locale="tr"
                    theme={isDarkMode ? 'dark' : 'light'}
                  />
                </View>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', zIndex: 1000, elevation: 10 },
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
  bigInput: { fontSize: 48, fontWeight: '700', textAlign: 'center', marginVertical: 20 },
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
  switchContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)', marginBottom: 24 },
});

export default AddTransactionModal;
