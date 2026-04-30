/**
 * DrawerNavigator — Glassmorphism Sidebar + Main Screens
 * ──────────────────────────────────────────────────────────────────────────────
 * Mounted when the user is authenticated (token exists in useAuthStore).
 * Uses GlassSidebar as custom drawer content.
 */

import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import GlassSidebar from '../components/GlassSidebar';
import HomeScreen from '../screens/HomeScreen';
import DebtsScreen from '../screens/DebtsScreen';
import {
  AnalyticsScreen,
  SettingsScreen,
} from '../screens/PlaceholderScreen';
import { theme } from '../theme';

export type DrawerParamList = {
  Home: undefined;
  Analytics: undefined;
  Debts: undefined;
  Settings: undefined;
};

const Drawer = createDrawerNavigator<DrawerParamList>();

const DRAWER_WIDTH = 280;

const DrawerNavigator: React.FC = () => (
  <Drawer.Navigator
    initialRouteName="Home"
    drawerContent={(props) => <GlassSidebar {...props} />}
    screenOptions={{
      headerShown: false,
      drawerType: 'front',
      drawerStyle: {
        width: DRAWER_WIDTH,
        backgroundColor: 'transparent', // allow blur to show through
      },
      overlayColor: 'rgba(0, 0, 0, 0.55)',
      sceneStyle: { backgroundColor: theme.colors.primary },
    }}
  >
    <Drawer.Screen name="Home" component={HomeScreen} />
    <Drawer.Screen name="Analytics" component={AnalyticsScreen} />
    <Drawer.Screen name="Debts" component={DebtsScreen} />
    <Drawer.Screen name="Settings" component={SettingsScreen} />
  </Drawer.Navigator>
);

export default DrawerNavigator;
