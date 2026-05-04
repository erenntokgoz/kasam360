import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import RootNavigator from './src/navigation/RootNavigator';
import { useAuthStore } from './src/store/useAuthStore';
import { useThemeStore } from './src/store/useThemeStore';
import { useNotificationStore } from './src/store/useNotificationStore';
import { getTheme } from './src/theme';

function App(): React.JSX.Element {
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);
  const { isDarkMode, hydrateTheme } = useThemeStore();
  const hydrateNotifications = useNotificationStore((s) => s.hydrateNotifications);

  useEffect(() => {
    hydrateFromStorage();
    hydrateTheme();
    hydrateNotifications();
  }, [hydrateFromStorage, hydrateTheme, hydrateNotifications]);

  const theme = getTheme(isDarkMode);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar
          barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          backgroundColor={theme.colors.primary}
          translucent={false}
        />
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;