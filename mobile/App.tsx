import React, { useEffect, useState } from 'react';
import { StatusBar, View, ActivityIndicator, Image } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import RootNavigator from './src/navigation/RootNavigator';
import { useAuthStore } from './src/store/useAuthStore';
import { useThemeStore } from './src/store/useThemeStore';
import { useNotificationStore } from './src/store/useNotificationStore';
import { useSetupStore } from './src/store/useSetupStore';
import { useContactStore } from './src/store/useContactStore';
import { useRecurringStore } from './src/store/useRecurringStore';
import { getTheme } from './src/theme';
import { hydrateLanguage } from './src/i18n';

function App(): React.JSX.Element {
  const [isReady, setIsReady] = useState(false);
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);
  const { isDarkMode, hydrateTheme } = useThemeStore();
  const hydrateNotifications = useNotificationStore((s) => s.hydrateNotifications);
  const hydrateContacts = useContactStore((s) => s.hydrateContacts);
  const hydrateSetup = useSetupStore((s) => s.hydrateSetup);
  const checkAndNotify = useRecurringStore((s) => s.checkAndNotify);
  const addNotification = useNotificationStore((s) => s.addNotification);

  useEffect(() => {
    const init = async () => {
      try {
        await hydrateLanguage();
        await hydrateFromStorage();
        await hydrateTheme();
        await hydrateNotifications();
        await hydrateContacts();
        await hydrateSetup();
        // Check recurring items and create notifications for due ones
        const dueItems = checkAndNotify();
        for (const item of dueItems) {
          await addNotification({
            title: 'Tekrarlayan Ödeme Hatırlatması',
            body: `${item.description || item.category} — ${(item.amount / 100).toLocaleString('tr-TR')}₺`,
            type: 'RECURRING',
          });
        }
      } catch (e) {
        console.error('Initialization error:', e);
      } finally {
        setIsReady(true);
      }
    };
    init();
  }, []);

  const theme = getTheme(isDarkMode);

  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', gap: 24 }}>
        <Image source={require('./src/assets/logo-text.png')} style={{ width: 180, height: 45, resizeMode: 'contain', opacity: 0.9 }} />
        <ActivityIndicator size="small" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.primary }}>
      <SafeAreaProvider>
        <StatusBar
          barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          backgroundColor={theme.colors.primary}
          translucent={true}
        />
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;