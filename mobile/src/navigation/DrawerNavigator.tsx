import React from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';
import Icon from 'react-native-vector-icons/Feather';
import HomeScreen from '../screens/HomeScreen';
import DebtsScreen from '../screens/DebtsScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import RecurringsScreen from '../screens/RecurringsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';

const Drawer = createDrawerNavigator();

const CustomDrawerContent = (props: any) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const user = useAuthStore((s) => s.user);

  return (
    <DrawerContentScrollView {...props} style={{ backgroundColor: theme.colors.surface }}>
      <View style={[styles.drawerHeader, { borderBottomColor: theme.colors.border }]}>
        <View style={[styles.logoContainer, { backgroundColor: theme.colors.accentTransparent }]}>
          <Image source={require('../assets/logo-text.png')} style={styles.drawerLogo} resizeMode="contain" />
        </View>
        <Text style={[styles.businessName, { color: theme.colors.textPrimary }]}>{user?.businessName || 'Kasam360'}</Text>
        <Text style={[styles.userPhone, { color: theme.colors.textTertiary }]}>{user?.phone}</Text>
      </View>
      <DrawerItemList {...props} />
    </DrawerContentScrollView>
  );
};

const DrawerNavigator = () => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerActiveBackgroundColor: theme.colors.accentTransparent,
        drawerActiveTintColor: theme.colors.accent,
        drawerInactiveTintColor: theme.colors.textSecondary,
        drawerLabelStyle: { marginLeft: -16, fontSize: 15, fontWeight: '500' },
        drawerStyle: { width: 280 },
      }}
    >
      <Drawer.Screen
        name="Home"
        component={HomeScreen}
        options={{
          drawerLabel: 'Ana Sayfa',
          drawerIcon: ({ color }) => <Icon name="home" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="Debts"
        component={DebtsScreen}
        options={{
          drawerLabel: 'Borçlar & Alacaklar',
          drawerIcon: ({ color }) => <Icon name="book" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{
          drawerLabel: 'Analizler',
          drawerIcon: ({ color }) => <Icon name="pie-chart" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="Recurrings"
        component={RecurringsScreen}
        options={{
          drawerLabel: 'Tekrarlayan Ödemeler',
          drawerIcon: ({ color }) => <Icon name="repeat" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          drawerLabel: 'Bildirimler',
          drawerIcon: ({ color }) => <Icon name="bell" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          drawerLabel: 'Ayarlar',
          drawerIcon: ({ color }) => <Icon name="settings" size={20} color={color} />,
        }}
      />
    </Drawer.Navigator>
  );
};

const styles = StyleSheet.create({
  drawerHeader: { padding: 24, paddingBottom: 32, marginBottom: 8, borderBottomWidth: 1 },
  logoContainer: { width: 140, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 16, padding: 8 },
  drawerLogo: { width: '100%', height: '100%' },
  businessName: { fontSize: 18, fontWeight: '700' },
  userPhone: { fontSize: 13, marginTop: 4 },
});

export default DrawerNavigator;
