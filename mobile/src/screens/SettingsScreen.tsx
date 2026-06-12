import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Switch, ScrollView, Alert, TextInput, Modal, ActivityIndicator, Share } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useAuthStore } from '../store/useAuthStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';
import { changeLanguage } from '../i18n';
import { useTranslation } from 'react-i18next';
import { useLedgerStore } from '../store/useLedgerStore';
import { useHaptics } from '../hooks/useHaptics';
import { useSecurityStore } from '../store/useSecurityStore';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';

const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  
  const { user, logout, updateProfile, deleteAccount, clearData, isLoading: isAuthLoading } = useAuthStore();
  const { toggleTheme, isDarkMode } = useThemeStore();
  const { transactions } = useLedgerStore();
  const { trigger } = useHaptics();
  const { i18n } = useTranslation();
  const theme = getTheme(isDarkMode);
  const currentLang = i18n.language === 'en' ? 'EN' : 'TR';

  const [showEdit, setShowEdit] = useState(false);
  const [editBusName, setEditBusName] = useState(user?.businessName || '');
  const [editPass, setEditPass] = useState('');

  const { isPinEnabled, pinLength, isBiometricsEnabled, lockTimeout, setPinEnabled, setPinLength, setLockTimeout, setBiometrics, setPin, pin } = useSecurityStore();
  const [showPinModal, setShowPinModal] = useState(false);
  const [tempPin, setTempPin] = useState('');
  const [tempPinConfirm, setTempPinConfirm] = useState('');
  const [pinStep, setPinStep] = useState<1 | 2>(1);
  const [pendingPinLength, setPendingPinLength] = useState<4 | 6 | 8>(pinLength);
  const [hasBiometrics, setHasBiometrics] = useState<boolean>(false);

  const timeoutOptions = [
    { label: 'Hemen', value: 0 },
    { label: '30 saniye', value: 30000 },
    { label: '1 dakika', value: 60000 },
    { label: '2 dakika', value: 120000 },
    { label: '5 dakika', value: 300000 },
  ];
  const currentTimeoutIndex = timeoutOptions.findIndex(t => t.value === lockTimeout);
  const safeCurrentIndex = currentTimeoutIndex >= 0 ? currentTimeoutIndex : 0;
  const nextTimeout = timeoutOptions[(safeCurrentIndex + 1) % timeoutOptions.length];

  React.useEffect(() => {
    const checkBiometrics = async () => {
      try {
        const rnBiometrics = new ReactNativeBiometrics();
        const { available } = await rnBiometrics.isSensorAvailable();
        setHasBiometrics(available);
      } catch (e) {}
    };
    checkBiometrics();
  }, []);

  const handleUpdateProfile = async () => {
    try {
      await updateProfile({ businessName: editBusName, password: editPass || undefined });
      Alert.alert('Başarılı', 'Profil güncellendi.');
      setShowEdit(false);
      setEditPass('');
    } catch {
      Alert.alert('Hata', 'Profil güncellenemedi.');
    }
  };

  const handleExportCSV = async () => {
    try {
      if (transactions.length === 0) {
        Alert.alert('Uyarı', 'Dışa aktarılacak işlem bulunamadı.');
        return;
      }
      const header = "Tarih,Tip,Kategori,Tutar,Yontem,Aciklama\n";
      const rows = transactions.map(t => {
        const date = new Date(t.transactionDate || t.createdAt).toLocaleDateString('tr-TR');
        const type = t.type === 'INCOME' ? 'GELIR' : 'GIDER';
        const amount = (t.amount / 100).toFixed(2);
        const desc = (t.description || '').replace(/,/g, ' '); // Remove commas to not break CSV
        return `${date},${type},${t.category || ''},${amount},${t.method},${desc}`;
      }).join("\n");
      
      const csv = header + rows;
      await Share.share({
        message: csv,
        title: 'Kasam360 İşlem Kayıtları'
      });
    } catch (error) {
      Alert.alert('Hata', 'Dışa aktarma başarısız oldu.');
    }
  };

  const handleLogout = () => {
    Alert.alert('Çıkış Yap', 'Hesabınızdan çıkış yapmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Çıkış', style: 'destructive', onPress: logout },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'DİKKAT: Hesabı Sil',
      'Hesabınızı ve tüm kayıtlarınızı (borçlar, işlemler, personeller vb.) kalıcı olarak silmek istediğinize emin misiniz? Bu işlem GERİ ALINAMAZ.',
      [
        { text: 'İptal', style: 'cancel' },
        { text: 'Kalıcı Olarak Sil', style: 'destructive', onPress: deleteAccount },
      ]
    );
  };

  const handleClearData = () => {
    Alert.alert(
      'DİKKAT: Verileri Temizle',
      'İşletmenize ait tüm işlemleri, borçları ve rehberi silmek istediğinize emin misiniz? Hesabınız silinmez ama veriler GERİ ALINAMAZ.',
      [
        { text: 'İptal', style: 'cancel' },
        { text: 'Tüm Verileri Sil', style: 'destructive', onPress: clearData },
      ]
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.primary }]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base, paddingTop: insets.top + theme.spacing.base, borderBottomColor: theme.colors.border }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Ayarlar</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textTertiary }]}>PROFİL BİLGİLERİ</Text>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Icon name="briefcase" size={18} color={theme.colors.accent} />
              <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>İşletme Adı</Text>
            </View>
            <Text style={[styles.rowValue, { color: theme.colors.textSecondary }]}>{user?.businessName}</Text>
          </View>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Icon name="phone" size={18} color={theme.colors.accent} />
              <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>Telefon</Text>
            </View>
            <Text style={[styles.rowValue, { color: theme.colors.textSecondary }]}>{user?.phone}</Text>
          </View>
          <Pressable style={styles.editBtn} onPress={() => setShowEdit(true)}>
            <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>Profili Düzenle / Şifre Değiştir</Text>
          </Pressable>
        </View>

        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textTertiary }]}>UYGULAMA TERCİHLERİ</Text>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Icon name="globe" size={18} color={theme.colors.accent} />
              <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>Dil / Language</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['TR', 'EN'] as const).map((lang) => (
                <Pressable
                  key={lang}
                  onPress={() => changeLanguage(lang.toLowerCase() as 'tr' | 'en')}
                  style={[{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5 }, currentLang === lang ? { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent } : { borderColor: theme.colors.border }]}
                >
                  <Text style={{ color: currentLang === lang ? '#fff' : theme.colors.textSecondary, fontWeight: '700', fontSize: 13 }}>{lang}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textTertiary }]}>GÜVENLİK & KİLİT</Text>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Icon name="lock" size={18} color={theme.colors.accent} />
              <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>Uygulama Kilidi (PIN)</Text>
            </View>
            <Switch
              value={isPinEnabled}
              onValueChange={(val) => {
                if (val) {
                  setPendingPinLength(pinLength);
                  setTempPin('');
                  setTempPinConfirm('');
                  setPinStep(1);
                  setShowPinModal(true);
                } else {
                  setPinEnabled(false);
                  setPin(null);
                }
              }}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
            />
          </View>
          {isPinEnabled && (
            <>
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <Icon name="hash" size={18} color={theme.colors.accent} />
                  <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>PIN Uzunluğu</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([4, 6, 8] as const).map((len) => (
                    <Pressable
                      key={len}
                      onPress={() => {
                        setPendingPinLength(len);
                        setTempPin('');
                        setTempPinConfirm('');
                        setPinStep(1);
                        setShowPinModal(true);
                      }}
                      style={[{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, borderWidth: 1.5 }, (pendingPinLength === len && showPinModal) || (!showPinModal && pinLength === len) ? { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent } : { borderColor: theme.colors.border }]}
                    >
                      <Text style={{ color: ((pendingPinLength === len && showPinModal) || (!showPinModal && pinLength === len)) ? '#fff' : theme.colors.textSecondary, fontWeight: '700', fontSize: 13 }}>{len}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Pressable style={styles.row} onPress={() => setLockTimeout(nextTimeout.value)}>
                <View style={styles.rowLeft}>
                  <Icon name="clock" size={18} color={theme.colors.accent} />
                  <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>Otomatik Kilit Süresi</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: theme.colors.textSecondary, fontWeight: '500' }}>{timeoutOptions[currentTimeoutIndex >= 0 ? currentTimeoutIndex : 0].label}</Text>
                  <Icon name="refresh-cw" size={14} color={theme.colors.textTertiary} />
                </View>
              </Pressable>
              <Pressable style={styles.row} onPress={() => { setTempPin(''); setTempPinConfirm(''); setPinStep(1); setShowPinModal(true); }}>
                <View style={styles.rowLeft}>
                  <Icon name="key" size={18} color={theme.colors.accent} />
                  <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>PIN Değiştir</Text>
                </View>
                <Icon name="chevron-right" size={16} color={theme.colors.textTertiary} />
              </Pressable>
              {hasBiometrics && (
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <Icon name="target" size={18} color={theme.colors.accent} />
                    <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>Biyometrik Giriş</Text>
                  </View>
                  <Switch
                    value={isBiometricsEnabled}
                    onValueChange={(val) => setBiometrics(val)}
                    trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                  />
                </View>
              )}
            </>
          )}
        </View>

        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textTertiary }]}>VERİ YÖNETİMİ</Text>

          <Pressable style={styles.row} onPress={handleExportCSV}>
            <View style={styles.rowLeft}>
              <Icon name="download" size={18} color={theme.colors.accent} />
              <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>Excel (CSV) Olarak Aktar</Text>
            </View>
            <Icon name="chevron-right" size={16} color={theme.colors.textTertiary} />
          </Pressable>
          <Pressable style={styles.row} onPress={handleClearData}>
            <View style={styles.rowLeft}>
              <Icon name="refresh-ccw" size={18} color={theme.colors.danger} />
              <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>Tüm Verileri Temizle</Text>
            </View>
            <Icon name="chevron-right" size={16} color={theme.colors.textTertiary} />
          </Pressable>
        </View>

        <Pressable style={[styles.logoutBtn, { backgroundColor: theme.colors.surface }]} onPress={handleLogout}>
          <Icon name="log-out" size={20} color={theme.colors.danger} />
          <Text style={[styles.logoutText, { color: theme.colors.danger }]}>Çıkış Yap</Text>
        </Pressable>

        <Pressable style={[styles.logoutBtn, { backgroundColor: theme.colors.dangerTransparent, marginTop: 16, marginBottom: 40 }]} onPress={handleDeleteAccount}>
          <Icon name="trash-2" size={20} color={theme.colors.danger} />
          <Text style={[styles.logoutText, { color: theme.colors.danger }]}>Hesabımı Kalıcı Olarak Sil</Text>
        </Pressable>
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={showEdit} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>Profili Düzenle</Text>
            <Text style={styles.inputLabel}>İşletme Adı</Text>
            <TextInput style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]} value={editBusName} onChangeText={setEditBusName} />
            <Text style={styles.inputLabel}>Yeni Şifre (Boş bırakılabilir)</Text>
            <TextInput style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]} secureTextEntry value={editPass} onChangeText={setEditPass} placeholder="••••••••" />
            
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, { backgroundColor: theme.colors.card }]} onPress={() => setShowEdit(false)}><Text style={{ color: theme.colors.textPrimary }}>İptal</Text></Pressable>
              <Pressable style={[styles.modalBtn, { backgroundColor: theme.colors.accent }]} onPress={handleUpdateProfile} disabled={isAuthLoading}>
                {isAuthLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff' }}>Güncelle</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* PIN Modal */}
      <Modal visible={showPinModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: theme.colors.surface, alignItems: 'center' }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>{pinStep === 1 ? 'Yeni PIN Girin' : 'PIN Tekrar'}</Text>
            <Text style={{ marginBottom: 24, fontSize: 32, letterSpacing: 8, color: theme.colors.textPrimary }}>
              {(pinStep === 1 ? tempPin : tempPinConfirm).padEnd(pendingPinLength, '○').replace(/./g, '●').slice(0, (pinStep === 1 ? tempPin : tempPinConfirm).length).padEnd(pendingPinLength, '○')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: 280, justifyContent: 'center' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '<'].map((key, i) => (
                <Pressable key={i} style={{ width: 70, height: 70, justifyContent: 'center', alignItems: 'center', margin: 8, borderRadius: 35, backgroundColor: key !== '' ? theme.colors.card : 'transparent' }} onPress={() => {
                  if (key === '<') {
                    if (pinStep === 1) setTempPin(prev => prev.slice(0, -1));
                    else setTempPinConfirm(prev => prev.slice(0, -1));
                  } else if (key !== '') {
                    const current = (pinStep === 1 ? tempPin : tempPinConfirm) + key;
                    if (pinStep === 1) {
                      setTempPin(current);
                      if (current.length === pendingPinLength) setPinStep(2);
                    } else {
                      setTempPinConfirm(current);
                      if (current.length === pendingPinLength) {
                        if (current === tempPin) {
                          setPinLength(pendingPinLength);
                          setPin(current);
                          setPinEnabled(true);
                          setShowPinModal(false);
                          Alert.alert('Başarılı', 'PIN başarıyla ayarlandı.');
                        } else {
                          Alert.alert('Hata', 'PIN kodları eşleşmedi. Lütfen tekrar deneyin.');
                          setTempPinConfirm('');
                          setTempPin('');
                          setPinStep(1);
                        }
                      }
                    }
                  }
                }}>
                  <Text style={{ fontSize: 24, color: theme.colors.textPrimary }}>{key}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={{ marginTop: 24, padding: 12 }} onPress={() => { setShowPinModal(false); setPendingPinLength(pinLength); if (!pin) setPinEnabled(false); }}>
              <Text style={{ color: theme.colors.textTertiary, fontWeight: '600' }}>İptal</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { flex: 1, padding: 16 },
  section: { borderRadius: 20, padding: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', marginBottom: 16, letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowValue: { fontSize: 14 },
  editBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 8 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 16, marginTop: 8 },
  logoutText: { marginLeft: 8, fontSize: 16, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalSheet: { borderRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 24 },
  inputLabel: { fontSize: 13, marginBottom: 8, opacity: 0.6 },
  input: { height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }
});

export default SettingsScreen;
