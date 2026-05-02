import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import GlassSidebar from '../components/GlassSidebar';
import HomeScreen from '../screens/HomeScreen';
import GelirScreen from '../screens/GelirScreen';
import GiderScreen from '../screens/GiderScreen';
import BorcScreen from '../screens/BorcScreen';
import AlacakScreen from '../screens/AlacakScreen';
import LogsScreen from '../screens/LogsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { theme } from '../theme';

export type DrawerParamList = {
  Home: undefined;
  Gelir: undefined;
  Gider: undefined;
  Borc: undefined;
  Alacak: undefined;
  Logs: undefined;
  Settings: undefined;
};

const Drawer = createDrawerNavigator<DrawerParamList>();

const DRAWER_WIDTH = 240;

const DrawerNavigator: React.FC = () => (
  <Drawer.Navigator
    initialRouteName="Home"
    drawerContent={(props) => <GlassSidebar {...props} />}
    screenOptions={{
      headerShown: false,
      drawerType: 'front',
      drawerStyle: {
        width: DRAWER_WIDTH,
        backgroundColor: '#000000',
      },
      overlayColor: 'rgba(0, 0, 0, 0.55)',
      sceneStyle: { backgroundColor: theme.colors.primary },
    }}
  >
    <Drawer.Screen name="Home" component={HomeScreen} />
    <Drawer.Screen name="Gelir" component={GelirScreen} />
    <Drawer.Screen name="Gider" component={GiderScreen} />
    <Drawer.Screen name="Borc" component={BorcScreen} />
    <Drawer.Screen name="Alacak" component={AlacakScreen} />
    <Drawer.Screen name="Logs" component={LogsScreen} />
    <Drawer.Screen name="Settings" component={SettingsScreen} />
  </Drawer.Navigator>
);

export default DrawerNavigator;
