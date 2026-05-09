/**
 * DrawerNavigator — Glassmorphism Sidebar + Main Screens
 * ──────────────────────────────────────────────────────────────────────────────
 * Mounted when the user is authenticated (token exists in useAuthStore).
 * Uses GlassSidebar as custom drawer content.
 */

import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import GlassSidebar from '../components/GlassSidebar';
import HomeScreen from '../screens/HomeScreen';
import DebtsScreen from '../screens/DebtsScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import RecurringsScreen from '../screens/RecurringsScreen';
import ContactDetailScreen from '../screens/ContactDetailScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';

export type DrawerParamList = {
  Home: undefined;
  Analytics: undefined;
  Debts: undefined;
  Settings: undefined;
  Recurrings: undefined;
  Notifications: undefined;
  ContactDetail: { contactName: string };
};

const Drawer = createDrawerNavigator<DrawerParamList>();

const DRAWER_WIDTH = 280;

const DrawerNavigator: React.FC = () => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  return (
    <Drawer.Navigator
      initialRouteName="Home"
      drawerContent={(props) => <GlassSidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: {
          width: DRAWER_WIDTH,
          backgroundColor: 'transparent',
        },
        overlayColor: 'rgba(0, 0, 0, 0.55)',
        sceneStyle: { backgroundColor: theme.colors.primary },
      }}
    >
      <Drawer.Screen name="Home" component={HomeScreen} />
      <Drawer.Screen name="Analytics" component={AnalyticsScreen} />
      <Drawer.Screen name="Debts" component={DebtsScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
      <Drawer.Screen name="Recurrings" component={RecurringsScreen} />
      <Drawer.Screen name="Notifications" component={NotificationsScreen} />
      <Drawer.Screen name="ContactDetail" component={ContactDetailScreen} options={{ drawerItemStyle: { display: 'none' } }} />
    </Drawer.Navigator>
  );
};

export default DrawerNavigator;
