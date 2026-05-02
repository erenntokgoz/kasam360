/**
 * RootNavigator — Auth-gate entry point
 * ──────────────────────────────────────────────────────────────────────────────
 * Reads `token` from useAuthStore:
 *   • token exists  → mount DrawerNavigator (authenticated)
 *   • no token      → mount AuthStack (login / register)
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useAuthStore } from '../store/useAuthStore';
import MainStack from './MainStack';
import AuthStack from './AuthStack';
import { theme } from '../theme';

/**
 * React Navigation theme — keeps the navigator surfaces consistent
 * with the Executive Slate palette.
 */
const navTheme = {
  dark: true,
  colors: {
    primary: theme.colors.successLight,
    background: theme.colors.primary,
    card: theme.colors.surface,
    text: theme.colors.textPrimary,
    border: theme.colors.border,
    notification: theme.colors.dangerLight,
  },
  fonts: {
    regular: { fontFamily: theme.fonts.regular, fontWeight: '400' as const },
    medium: { fontFamily: theme.fonts.medium, fontWeight: '500' as const },
    bold: { fontFamily: theme.fonts.bold, fontWeight: '700' as const },
    heavy: { fontFamily: theme.fonts.bold, fontWeight: '900' as const },
  },
};

const RootNavigator: React.FC = () => {
  const token = useAuthStore((s) => s.token);

  return (
    <NavigationContainer theme={navTheme}>
      {token ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
};

export default RootNavigator;
