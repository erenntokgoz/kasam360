import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DrawerNavigator from './DrawerNavigator';
import AddTransactionScreen from '../screens/AddTransactionScreen';
import AddDebtScreen from '../screens/AddDebtScreen';
import ProfileSettingsScreen from '../screens/ProfileSettingsScreen';
import ThemeSettingsScreen from '../screens/ThemeSettingsScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import { theme } from '../theme';

export type MainStackParamList = {
  Drawer: undefined;
  AddTransaction: { type: 'INCOME' | 'EXPENSE' };
  AddDebt: { type: 'GIVEN' | 'TAKEN' };
  ProfileSettings: undefined;
  ThemeSettings: undefined;
  NotificationSettings: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

const MainStack: React.FC = () => (
  <Stack.Navigator
    initialRouteName="Drawer"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: theme.colors.primary },
      animation: 'slide_from_right',
    }}
  >
    <Stack.Screen name="Drawer" component={DrawerNavigator} />
    <Stack.Screen 
      name="AddTransaction" 
      component={AddTransactionScreen} 
      options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} 
    />
    <Stack.Screen 
      name="AddDebt" 
      component={AddDebtScreen} 
      options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} 
    />
    <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} />
    <Stack.Screen name="ThemeSettings" component={ThemeSettingsScreen} />
    <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
  </Stack.Navigator>
);

export default MainStack;
