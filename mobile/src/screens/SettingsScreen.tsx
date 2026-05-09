import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Switch, ScrollView, Platform, Alert, TextInput, Modal, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/useAuthStore';
import { useBudgetStore } from '../store/useBudgetStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';

const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  
  const { user, logout, updateProfile, isLoading: isAuthLoading } = useAuthStore();
  const { monthlyLimit, setMonthlyLimit, warningThreshold, setWarningThreshold } = useBudgetStore();
  const { isDarkMode, toggleTheme } = useThemeStore();
  
  const theme = getTheme(isDarkMode);

  const [showEdit, setShowEdit] = useState(false);
  const [editBusName, setEditBusName] = useState(user?.businessName || '');
  const [editPass, setEditPass] = useState('');

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

  const handleLogout = () => {
    Alert.alert('Çıkış Yap', 'Hesabınızdan çıkış yapmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Çıkış', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.primary }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: theme.colors.surface }]}>
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
              <Icon name={isDarkMode ? 'moon' : 'sun'} size={18} color={theme.colors.accent} />
              <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>Karanlık Mod</Text>
            </View>
            <Switch value={isDarkMode} onValueChange={toggleTheme} trackColor={{ false: theme.colors.border, true: theme.colors.accent }} />
          </View>
        </View>

        <Pressable style={[styles.logoutBtn, { backgroundColor: theme.colors.surface }]} onPress={handleLogout}>
          <Icon name="log-out" size={20} color={theme.colors.danger} />
          <Text style={[styles.logoutText, { color: theme.colors.danger }]}>Çıkış Yap</Text>
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
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 12 },
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
