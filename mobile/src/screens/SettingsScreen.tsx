import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';

const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
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
});

export default SettingsScreen;
