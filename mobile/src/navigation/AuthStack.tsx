/**
 * AuthStack — Unauthenticated Screen Stack
 * ──────────────────────────────────────────────────────────────────────────────
 * Mounted when there is no valid token in useAuthStore.
 * If user has already seen onboarding (hasSeenOnboarding=true), starts at Login.
 * Otherwise starts at Onboarding so new users get the intro slides.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OnboardingScreen from '../screens/OnboardingScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useSetupStore } from '../store/useSetupStore';

export type AuthStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  Register: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

const AuthStack: React.FC = () => {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);

  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.primary },
        animation: 'fade_from_bottom',
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
};

export default AuthStack;
