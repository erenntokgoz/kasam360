import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeIcon } from '../components/SafeIcon';

const THEMES = [
  { id: 'dark', label: 'KARANLIK TEMA' },
  { id: 'light', label: 'AYDINLIK TEMA' },
  { id: 'system', label: 'SİSTEM VARSAYILANI' },
];

export default function ThemeSettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [activeTheme, setActiveTheme] = useState('dark');

  const handleSelectTheme = (id: string) => {
    if (id !== 'dark') {
      Alert.alert('Brutalist Tema', 'Kasam360 her zaman kapkaranlık ve çizgili bir dünyada yaşar. Aydınlık tema kullanılamaz.');
      return;
    }
    setActiveTheme(id);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()}>
          <SafeIcon name="arrow-back-outline" size={28} color="#FFFFFF" fallbackText="GERİ" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>TEMA AYARLARI</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.list}>
        {THEMES.map((theme) => {
          const isActive = theme.id === activeTheme;
          return (
            <TouchableOpacity 
              key={theme.id}
              style={[styles.row, isActive && styles.rowActive]}
              activeOpacity={0.8}
              onPress={() => handleSelectTheme(theme.id)}
            >
              <Text style={[styles.rowText, isActive && styles.rowTextActive]}>
                {theme.label}
              </Text>
              {isActive && (
                <SafeIcon name="checkmark-outline" size={24} color="#000000" fallbackText="✓" />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
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
  list: {
    paddingTop: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  rowActive: {
    backgroundColor: '#FFFFFF',
  },
  rowText: {
    color: '#8E8E93',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  rowTextActive: {
    color: '#000000',
    fontWeight: '900',
  },
});
