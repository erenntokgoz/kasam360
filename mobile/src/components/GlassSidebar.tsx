import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import {
  DrawerContentScrollView,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeIcon } from './SafeIcon';
import { useAuthStore } from '../store/useAuthStore';

interface MenuItem {
  label: string;
  icon: string;
  route: string;
}

const MENU_ITEMS: MenuItem[] = [
  { label: 'Ana Sayfa', icon: 'home-outline', route: 'Home' },
  { label: 'Gelir', icon: 'trending-up-outline', route: 'Gelir' },
  { label: 'Gider', icon: 'trending-down-outline', route: 'Gider' },
  { label: 'Borçlar', icon: 'arrow-down-circle-outline', route: 'Borc' },
  { label: 'Alacaklar', icon: 'arrow-up-circle-outline', route: 'Alacak' },
  { label: 'Sistem Kayıtları', icon: 'document-text-outline', route: 'Logs' },
  { label: 'Ayarlar', icon: 'settings-outline', route: 'Settings' },
];

const GlassSidebar: React.FC<DrawerContentComponentProps> = (props) => {
  const insets = useSafeAreaInsets();
  const logout = useAuthStore((s) => s.logout);
  const activeRoute = props.state.routes[props.state.index]?.name ?? 'Home';

  return (
    <View style={styles.root}>
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 40 },
        ]}
      >
        <View style={styles.brandSection}>
          <Text style={styles.brandName}>KASAM360</Text>
        </View>

        <View style={styles.menuSection}>
          {MENU_ITEMS.map((item) => {
            const isActive = item.route === activeRoute;
            return (
              <TouchableOpacity
                key={item.route}
                activeOpacity={0.7}
                style={[styles.menuItem, isActive && styles.menuItemActive]}
                onPress={() => props.navigation.navigate(item.route)}
              >
                <SafeIcon
                  name={item.icon}
                  size={24}
                  color={isActive ? '#000000' : '#8E8E93'}
                  fallbackText="-"
                />
                <Text
                  style={[
                    styles.menuLabel,
                    isActive && styles.menuLabelActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </DrawerContentScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 40 }]}>
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.logoutButton}
          onPress={logout}
        >
          <SafeIcon name="log-out-outline" size={24} color="#FF3B30" fallbackText="X" />
          <Text style={styles.logoutLabel}>ÇIKIŞ YAP</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: 48,
  },
  brandName: {
    fontWeight: 'bold',
    fontSize: 28,
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  menuSection: {
    gap: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  menuItemActive: {
    backgroundColor: '#FFFFFF',
  },
  menuLabel: {
    fontWeight: '600',
    fontSize: 16,
    color: '#8E8E93',
    marginLeft: 16,
  },
  menuLabelActive: {
    color: '#000000',
    fontWeight: 'bold',
  },
  footer: {
    paddingHorizontal: 20,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  logoutLabel: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#FF3B30',
    marginLeft: 16,
  },
});

export default GlassSidebar;
