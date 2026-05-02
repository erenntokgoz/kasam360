import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
      Alert.alert('Hata', 'İşletme adı boş bırakılamaz.');
      return;
    }

    setLoading(true);
    try {
      await updateProfile({
        businessName,
        password: password || undefined,
      });
      Alert.alert('Başarılı', 'Profil bilgileriniz güncellendi.');
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Hata', error.message || 'Profil güncellenemedi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()}>
          <SafeIcon name="arrow-back-outline" size={28} color="#FFFFFF" fallbackText="GERİ" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>PROFİLİ DÜZENLE</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>İŞLETME ADI / AD SOYAD</Text>
        <TextInput
          style={styles.input}
          placeholder="İşletme veya Adınız"
          placeholderTextColor="#8E8E93"
          value={businessName}
          onChangeText={setBusinessName}
        />

        <Text style={styles.label}>TELEFON</Text>
        <TextInput
          style={styles.input}
          placeholder="05XX XXX XX XX"
          placeholderTextColor="#8E8E93"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />

        <Text style={styles.label}>YENİ ŞİFRE (Opsiyonel)</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor="#8E8E93"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
      </View>

      <TouchableOpacity 
        style={styles.saveButton} 
        activeOpacity={0.8}
        onPress={handleSave}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#000000" />
        ) : (
          <Text style={styles.saveButtonText}>GÜNCELLE</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#FFFFFF',
  },
  form: {
    padding: 20,
    flex: 1,
  },
  label: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    padding: 16,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  saveButton: {
    marginHorizontal: 20,
    marginBottom: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  saveButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
