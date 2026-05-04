import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme, theme as defaultTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { SafeIcon } from '../components/SafeIcon';

const THEMES = [
  { id: 'dark', label: 'Karanlık Tema', icon: 'moon-outline' },
  { id: 'light', label: 'Aydınlık Tema', icon: 'sunny-outline' },
  { id: 'system', label: 'Sistem Varsayılanı', icon: 'settings-outline' },
];

export default function ThemeSettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [activeTheme, setActiveTheme] = useState('dark');
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);

  const handleSelectTheme = (id: string) => {
    if (id !== 'dark') {
      Alert.alert(
        'BRUTALIST TEMA', 
        'Kasam360 her zaman kapkaranlık ve çizgili bir dünyada yaşar. Aydınlık tema şu an desteklenmemektedir.'
      );
      return;
    }
    setActiveTheme(id);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()} style={styles.backButton}>
          <SafeIcon name="arrow-back-outline" size={24} color={theme.colors.textPrimary} fallbackText="<" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>GÖRÜNÜM</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionHeader}>TEMA SEÇİMİ</Text>
        <View style={styles.section}>
          {THEMES.map((item, index) => {
            const isActive = item.id === activeTheme;
            return (
              <View key={item.id}>
                <TouchableOpacity 
                  style={styles.item}
                  activeOpacity={0.7}
                  onPress={() => handleSelectTheme(item.id)}
                >
                  <View style={styles.itemLeft}>
                    <SafeIcon name={item.icon} size={22} color={isActive ? theme.colors.accent : theme.colors.textPrimary} fallbackText="•" />
                    <Text style={[styles.itemLabel, isActive && styles.itemLabelActive]}>
                      {item.label}
                    </Text>
                  </View>
                  {isActive && (
                    <SafeIcon name="checkmark" size={20} color={theme.colors.accent} fallbackText="✓" />
                  )}
                </TouchableOpacity>
                {index < THEMES.length - 1 && <View style={styles.divider} />}
              </View>
            );
          })}
        </View>
        
        <Text style={styles.infoText}>
          Arayüz, OLED ekranlar için optimize edilmiş saf siyah tema üzerine kuruludur.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'System',
    fontSize: 18,
    letterSpacing: 2,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  sectionHeader: {
    fontFamily: defaultTheme.fonts.bold,
    fontSize: 11,
    color: defaultTheme.colors.textTertiary,
    letterSpacing: 1.5,
    marginTop: 32,
    marginBottom: 8,
    paddingHorizontal: defaultTheme.spacing.lg,
    textTransform: 'uppercase',
  },
  section: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: defaultTheme.colors.border,
    backgroundColor: defaultTheme.colors.card,
  },
  item: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: defaultTheme.spacing.lg,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemLabel: {
    fontFamily: defaultTheme.fonts.regular,
    fontSize: 16,
    color: defaultTheme.colors.textPrimary,
    marginLeft: 16,
  },
  itemLabelActive: {
    color: defaultTheme.colors.accent,
    fontFamily: defaultTheme.fonts.bold,
  },
  divider: {
    height: 1,
    backgroundColor: defaultTheme.colors.border,
    marginLeft: 56,
  },
  infoText: {
    fontFamily: defaultTheme.fonts.regular,
    fontSize: 13,
    color: defaultTheme.colors.textSecondary,
    paddingHorizontal: defaultTheme.spacing.lg,
    marginTop: 16,
    lineHeight: 20,
  },
});
