/**
 * RootNavigator — Auth-gate entry point
 * ──────────────────────────────────────────────────────────────────────────────
 * Reads `token` from useAuthStore and `isSetupComplete` from useSetupStore:
 *   • no token                        → mount AuthStack (login / register)
 *   • token exists, !isSetupComplete  → mount SetupScreen (initial setup)
 *   • token exists, isSetupComplete   → mount DrawerNavigator (authenticated)
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/useAuthStore';
import { useSetupStore } from '../store/useSetupStore';
import DrawerNavigator from './DrawerNavigator';
import AuthStack from './AuthStack';
import SetupScreen from '../screens/SetupScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';

const Stack = createNativeStackNavigator();

const RootNavigator: React.FC = () => {
  const token = useAuthStore((s) => s.token);
  const isSetupComplete = useSetupStore((s) => s.isSetupComplete);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);

  const navTheme = {
    dark: isDarkMode,
    colors: {
      primary: theme.colors.accent,
      background: theme.colors.primary,
      card: theme.colors.surface,
      text: theme.colors.textPrimary,
      border: theme.colors.border,
      notification: theme.colors.danger,
    },
    fonts: {
      regular: { fontFamily: theme.fonts.regular, fontWeight: '400' as const },
      medium: { fontFamily: theme.fonts.medium, fontWeight: '500' as const },
      bold: { fontFamily: theme.fonts.bold, fontWeight: '700' as const },
      heavy: { fontFamily: theme.fonts.bold, fontWeight: '900' as const },
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <Stack.Screen name="Auth" component={AuthStack} />
        ) : !isSetupComplete ? (
          <Stack.Group>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Setup" component={SetupScreen} />
          </Stack.Group>
        ) : (
          <Stack.Screen name="Main" component={DrawerNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default RootNavigator;
