import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { SafeIcon } from '../components/SafeIcon';
import { useAuthStore } from '../store/useAuthStore';

export default function ProfileSettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuthStore();
  const [businessName, setBusinessName] = useState(user?.businessName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!businessName) {
      Alert.alert('HATA', 'İşletme adı boş bırakılamaz.');
      return;
    }

    setLoading(true);
    try {
      await updateProfile({
        businessName,
        password: password || undefined,
      });
      Alert.alert('BAŞARILI', 'Profil bilgileriniz güncellendi.');
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('HATA', error.message || 'Profil güncellenemedi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()} style={styles.backButton}>
          <SafeIcon name="arrow-back-outline" size={24} color={theme.colors.textPrimary} fallbackText="<" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>PROFİL</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionHeader}>İŞLETME BİLGİLERİ</Text>
        <View style={styles.section}>
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>İŞLETME ADI</Text>
            <TextInput
              style={styles.input}
              placeholder="İşletme adınızı girin"
              placeholderTextColor={theme.colors.textTertiary}
              value={businessName}
              onChangeText={setBusinessName}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>TELEFON</Text>
            <TextInput
              style={styles.input}
              placeholder="05XX XXX XX XX"
              placeholderTextColor={theme.colors.textTertiary}
              keyboardType="phone-pad"
              value={phone}
              editable={false} // Phone usually locked or handled separately
            />
          </View>
        </View>

        <Text style={styles.sectionHeader}>GÜVENLİK</Text>
        <View style={styles.section}>
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>YENİ ŞİFRE</Text>
            <TextInput
              style={styles.input}
              placeholder="Değiştirmek istemiyorsanız boş bırakın"
              placeholderTextColor={theme.colors.textTertiary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.primaryButton, { backgroundColor: theme.colors.accent }]} 
          activeOpacity={0.9}
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <Text style={styles.primaryButtonText}>DEĞİŞİKLİKLERİ KAYDET</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primary,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: theme.fonts.black,
    fontSize: theme.fontSizes.lg,
    color: theme.colors.textPrimary,
    letterSpacing: 2,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  sectionHeader: {
    fontFamily: theme.fonts.black,
    fontSize: 11,
    color: theme.colors.textTertiary,
    letterSpacing: 1.5,
    marginTop: 32,
    marginBottom: 8,
    paddingHorizontal: theme.spacing.lg,
    textTransform: 'uppercase',
  },
  section: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  inputWrapper: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 12,
  },
  label: {
    fontFamily: theme.fonts.black,
    fontSize: 10,
    color: theme.colors.accent,
    letterSpacing: 1,
    marginBottom: 4,
  },
  input: {
    fontFamily: theme.fonts.light,
    fontSize: 16,
    color: theme.colors.textPrimary,
    padding: 0,
    height: 32,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing.lg,
  },
  footer: {
    padding: theme.spacing.lg,
  },
  primaryButton: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.none,
  },
  primaryButtonText: {
    fontFamily: theme.fonts.black,
    fontSize: theme.fontSizes.base,
    color: theme.colors.primary,
    letterSpacing: 1,
  },
});
