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
import { getTransactions } from './src/api/transactionService';
import messaging from '@react-native-firebase/messaging';
import apiClient from './src/api/client';

function App(): React.JSX.Element {
  const [isReady, setIsReady] = useState(false);
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);
  const { isDarkMode, hydrateTheme } = useThemeStore();
  const hydrateNotifications = useNotificationStore((s) => s.hydrateNotifications);
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

    // FCM token — arka planda, loading'i bloke etmeden
    const setupFCM = async () => {
      try {
        const authStatus = await messaging().requestPermission();
        const enabled = authStatus === messaging.AuthorizationStatus.AUTHORIZED || authStatus === messaging.AuthorizationStatus.PROVISIONAL;
        
        if (enabled) {
          const token = await messaging().getToken();
          if (token) {
            console.log('[FCM] Token:', token);
            const authToken = useAuthStore.getState().token;
            if (authToken) {
              await apiClient.put('/api/tenant/device-token', { deviceToken: token }).catch(e => console.warn('Token sync failed', e));
            }
          }
        } else {
          console.warn('[FCM] Bildirim izni reddedildi.');
        }
      } catch (e) {
        console.warn('[FCM] Setup error:', e);
      }
    };
    // init bittikten sonra FCM'i başlat
    init().then(() => setupFCM());

    // Listen for foreground messages
    const unsubscribe = messaging().onMessage(async remoteMessage => {
      if (remoteMessage.notification) {
        addNotification({
          title: remoteMessage.notification.title || 'Yeni Bildirim',
          body: remoteMessage.notification.body || '',
          type: 'INFO'
        });
      }
    });

    return unsubscribe;
  }, []);

  // ── Auto-detect setup: if user has a token but setup flag is missing
  //    Check backend for existing data whenever token becomes available.
  const token = useAuthStore((s) => s.token);
  const isSetupComplete = useSetupStore((s) => s.isSetupComplete);
  const setSetupComplete = useSetupStore((s) => s.setSetupComplete);

  useEffect(() => {
    if (token && !isSetupComplete) {
      getTransactions(null, 1)
        .then((result) => {
          if (result.transactions.length > 0) {
            setSetupComplete(true);
          }
        })
        .catch(() => {});
    }
  }, [token, isSetupComplete, setSetupComplete]);

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
          backgroundColor="transparent"
          translucent={true}
        />
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
