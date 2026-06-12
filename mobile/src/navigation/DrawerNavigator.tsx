import React from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';
import Icon from 'react-native-vector-icons/Feather';
import HomeScreen from '../screens/HomeScreen';
import DashboardScreen from '../screens/DashboardScreen';
import DebtsScreen from '../screens/DebtsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import EmployeeListScreen from '../screens/EmployeeListScreen';
import EmployeeDetailScreen from '../screens/EmployeeDetailScreen';
import GlassSidebar from '../components/GlassSidebar';
import TransactionsScreen from '../screens/TransactionsScreen';
import PersonalExpensesScreen from '../screens/PersonalExpensesScreen';
import PersonnelExpensesScreen from '../screens/StaffExpensesScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ContactsScreen from '../screens/ContactsScreen';
import ContactDetailScreen from '../screens/ContactDetailScreen';
import PastTransactionsCategoryScreen from '../screens/PastTransactionsCategoryScreen';
import PastTransactionsMonthScreen from '../screens/PastTransactionsMonthScreen';
import PastTransactionsDetailScreen from '../screens/PastTransactionsDetailScreen';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';

const Drawer = createDrawerNavigator();

const DrawerNavigator = () => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  return (
    <Drawer.Navigator
      drawerContent={(props) => <GlassSidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerActiveBackgroundColor: theme.colors.accentTransparent,
        drawerActiveTintColor: theme.colors.accent,
        drawerInactiveTintColor: theme.colors.textSecondary,
        drawerLabelStyle: { marginLeft: -16, fontSize: 15, fontWeight: '500' },
        drawerStyle: { width: 280, backgroundColor: 'transparent' },
        drawerType: 'front', 
        overlayColor: 'rgba(0,0,0,0.5)',
        swipeEdgeWidth: 30,
        sceneStyle: { backgroundColor: theme.colors.primary },
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
        name="Dashboard"
        component={DashboardScreen}
        options={{
          drawerLabel: 'Dashboard',
          drawerIcon: ({ color }) => <Icon name="bar-chart-2" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{
          drawerLabel: 'Gelir & Giderler',
          drawerIcon: ({ color }) => <Icon name="list" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="Debts"
        component={DebtsScreen}
        options={{
          drawerLabel: 'Borçlar & Alacaklar',
          drawerIcon: ({ color }) => <Icon name="credit-card" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="PersonalExpenses"
        component={PersonalExpensesScreen}
        options={{
          drawerLabel: 'Kişisel Giderler',
          drawerIcon: ({ color }) => <Icon name="user" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="PersonnelExpenses"
        component={PersonnelExpensesScreen}
        options={{
          drawerLabel: 'Personel Giderleri',
          drawerIcon: ({ color }) => <Icon name="briefcase" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="EmployeeList"
        component={EmployeeListScreen}
        options={{
          drawerLabel: 'Personel Listesi',
          drawerIcon: ({ color }) => <Icon name="clipboard" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="PastTransactionsCategory"
        component={PastTransactionsCategoryScreen}
        options={{
          drawerLabel: 'Geçmiş İşlemler',
          drawerIcon: ({ color }) => <Icon name="archive" size={20} color={color} />,
        }}
      />
      <Drawer.Screen
        name="PastTransactionsMonth"
        component={PastTransactionsMonthScreen}
        options={{
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen
        name="PastTransactionsDetail"
        component={PastTransactionsDetailScreen}
        options={{
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen
        name="EmployeeDetail"
        component={EmployeeDetailScreen}
        options={{
          drawerItemStyle: { display: 'none' },
        }}
      />

      <Drawer.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          drawerLabel: 'Rehber',
          drawerIcon: ({ color }) => <Icon name="users" size={20} color={color} />,
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

      <Drawer.Screen
        name="ContactDetail"
        component={ContactDetailScreen}
        options={{
          drawerItemStyle: { display: 'none' },
        }}
      />
    </Drawer.Navigator>
  );
};

export default DrawerNavigator;
