import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Image } from 'react-native';
import { DrawerContentScrollView, DrawerContentComponentProps } from '@react-navigation/drawer';
import { BlurView } from '@react-native-community/blur';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useNotificationStore } from '../store/useNotificationStore';

interface MenuItem {
  label: string;
  icon: string;
  route: string;
  badge?: number;
}



const GlassSidebar: React.FC<DrawerContentComponentProps> = (props) => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const activeRoute = props.state.routes[props.state.index]?.name ?? 'Home';
  const unreadCount = useNotificationStore((s) => s.getUnreadCount());

  const MENU_ITEMS: MenuItem[] = [
    { label: t('sidebar.home'), icon: 'home', route: 'Home' },
    { label: t('sidebar.transactions'), icon: 'list', route: 'Transactions' },
    { label: t('sidebar.debts'), icon: 'credit-card', route: 'Debts' },
    { label: t('sidebar.personalExpenses'), icon: 'user', route: 'PersonalExpenses' },
    { label: t('sidebar.recurrings'), icon: 'briefcase', route: 'StaffExpenses' },
    { label: t('sidebar.notifications'), icon: 'bell', route: 'Notifications', badge: unreadCount },
    { label: t('sidebar.contacts'), icon: 'users', route: 'DirectorySelection' },
    { label: t('sidebar.settings'), icon: 'settings', route: 'Settings' },
  ];

  return (
    <View style={styles.root}>
      {Platform.OS !== 'web' && (
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType={isDarkMode ? 'dark' : 'light'}
          blurAmount={20}
          reducedTransparencyFallbackColor={theme.colors.primary}
        />
      )}
      <View style={[styles.overlay, { backgroundColor: theme.colors.overlay, opacity: isDarkMode ? 0.75 : 0.05 }]} />

      <DrawerContentScrollView
        {...props}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.md, paddingTop: insets.top + theme.spacing.lg }}
      >
        <View style={{ alignItems: 'center', marginBottom: theme.spacing.xl }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.accentTransparent, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.sm }}>
            <Icon name="layers" size={22} color={theme.colors.accent} />
          </View>
          <Image source={require('../assets/logo-text.png')} style={{ width: 160, height: 40, resizeMode: 'contain' }} />
          {user?.businessName && (
            <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.xs, color: theme.colors.textTertiary, marginTop: 2 }} numberOfLines={1}>{user.businessName}</Text>
          )}
        </View>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginVertical: theme.spacing.md }} />

        <View style={styles.menuSection}>
          {MENU_ITEMS.map((item) => {
            const isActive = item.route === activeRoute;
            return (
              <TouchableOpacity
                key={item.route}
                activeOpacity={0.7}
                style={[
                  { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.base, borderRadius: theme.radii.base },
                  isActive && { backgroundColor: theme.colors.accentTransparent },
                ]}
                onPress={() => props.navigation.navigate(item.route)}
              >
                <Icon
                  name={item.icon}
                  size={18}
                  color={isActive ? theme.colors.accent : theme.colors.textSecondary}
                />
                <Text style={[
                  { fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.base, color: theme.colors.textSecondary, marginLeft: theme.spacing.md, flex: 1 },
                  isActive && { color: theme.colors.textPrimary, fontFamily: theme.fonts.semiBold },
                ]}>
                  {item.label}
                </Text>
                {item.badge !== undefined && item.badge > 0 && (
                  <View style={{ backgroundColor: theme.colors.accent, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, marginRight: 8, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>{item.badge}</Text>
                  </View>
                )}
                {isActive && <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.colors.accent }} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </DrawerContentScrollView>

      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.base }}>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginVertical: theme.spacing.md }} />
        <TouchableOpacity activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.base, borderRadius: theme.radii.base }} onPress={logout}>
          <Icon name="log-out" size={18} color={theme.colors.dangerLight} />
          <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.base, color: theme.colors.dangerLight, marginLeft: theme.spacing.md }}>{t('sidebar.logout')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, zIndex: 0 },
  overlay: { ...StyleSheet.absoluteFill },
  menuSection: { gap: 4 },
});

export default GlassSidebar;