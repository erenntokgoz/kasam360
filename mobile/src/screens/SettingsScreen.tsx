import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { SafeIcon } from '../components/SafeIcon';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const handleLogout = () => {
    Alert.alert(
      'ÇIKIŞ',
      'Sistemden çıkış yapmak istediğinize emin misiniz?',
      [
        { text: 'İPTAL', style: 'cancel' },
        { text: 'ÇIKIŞ YAP', style: 'destructive' }
      ]
    );
  };

  const SettingItem = ({ icon, label, onPress, rightElement, isLast, color }: any) => (
    <View>
      <TouchableOpacity 
        style={styles.item} 
        activeOpacity={0.7} 
        onPress={onPress}
      >
        <View style={styles.itemLeft}>
          <SafeIcon name={icon} size={22} color={color || theme.colors.textPrimary} fallbackText="•" />
          <Text style={[styles.itemLabel, color ? { color } : {}]}>{label}</Text>
        </View>
        {rightElement || <SafeIcon name="chevron-forward" size={18} color={theme.colors.textTertiary} fallbackText=">" />}
      </TouchableOpacity>
      {!isLast && <View style={styles.divider} />}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AYARLAR</Text>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <SafeIcon name="menu-outline" size={24} color={theme.colors.textPrimary} fallbackText="=" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHeader}>HESAP</Text>
        <View style={styles.section}>
          <SettingItem 
            icon="person-outline" 
            label="Profili Düzenle" 
            onPress={() => (navigation.navigate as any)('ProfileSettings')} 
          />
          <SettingItem 
            icon="notifications-outline" 
            label="Bildirimler" 
            onPress={() => (navigation.navigate as any)('NotificationSettings')} 
            isLast
          />
        </View>

        <Text style={styles.sectionHeader}>GÖRÜNÜM</Text>
        <View style={styles.section}>
          <SettingItem 
            icon="color-palette-outline" 
            label="Tema" 
            onPress={() => (navigation.navigate as any)('ThemeSettings')} 
            isLast
          />
        </View>

        <Text style={styles.sectionHeader}>SİSTEM</Text>
        <View style={styles.section}>
          <SettingItem 
            icon="log-out-outline" 
            label="Sistemden Çıkış Yap" 
            onPress={handleLogout}
            color="#EF4444"
            rightElement={<View />}
            isLast
          />
        </View>
        
        <Text style={styles.versionText}>KASAM360 v1.0.0</Text>
      </ScrollView>
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
  item: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemLabel: {
    fontFamily: theme.fonts.light,
    fontSize: 16,
    color: theme.colors.textPrimary,
    marginLeft: 16,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 56,
  },
  versionText: {
    fontFamily: theme.fonts.light,
    fontSize: 12,
    color: theme.colors.textTertiary,
    textAlign: 'center',
    marginTop: 48,
    letterSpacing: 1,
  },
});
