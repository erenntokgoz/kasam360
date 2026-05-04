import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';

const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user, logout } = useAuthStore();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Settings</Text>
        <View style={{ width: 22 }} />
      </View>
      <View style={styles.emptyContainer}>
        <Icon name="settings" size={32} color={theme.colors.textTertiary} />
        <Text style={[styles.emptyTitle, { marginTop: 16, color: theme.colors.textPrimary }]}>Settings</Text>
        <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>Coming soon</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12 },
  headerTitle: { fontFamily: 'System', fontSize: 18, letterSpacing: 0.4 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontFamily: 'System', fontSize: 18, marginBottom: 4 },
  emptySubtitle: { fontFamily: 'System', fontSize: 13, textAlign: 'center' },
  settingsContent: { padding: 24 },
  settingsCard: { backgroundColor: '#141C2B', borderRadius: 10, padding: 24 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  settingsIconContainer: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(37, 99, 235, 0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  settingsInfo: { flex: 1 },
  settingsLabel: { fontFamily: 'System', fontSize: 13, marginBottom: 2 },
  settingsValue: { fontFamily: 'System', fontSize: 15 },
  goldSeparator: { height: 1, backgroundColor: '#FCD34D', marginVertical: 16, opacity: 0.5 },
  logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: 24, borderRadius: 10, marginTop: 8 },
  logoutText: { fontFamily: 'System', fontSize: 15, marginLeft: 8 },
});

export default SettingsScreen;
