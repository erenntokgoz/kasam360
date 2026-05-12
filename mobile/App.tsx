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
import { navigate } from './src/navigation/navigationRef';
import { Vibration, Animated as RNAnimated } from 'react-native';
import ReAnimated, { FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence } from 'react-native-reanimated';

function App(): React.JSX.Element {
  const [isReady, setIsReady] = useState(false);
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);
  const { isDarkMode, hydrateTheme } = useThemeStore();
  const hydrateNotifications = useNotificationStore((s) => s.hydrateNotifications);
  const hydrateSetup = useSetupStore((s) => s.hydrateSetup);
  const checkAndNotify = useRecurringStore((s) => s.checkAndNotify);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const logoScale = useSharedValue(1);
  useEffect(() => {
    logoScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1500 }),
        withTiming(1, { duration: 1500 })
      ),
      -1,
      true
    );
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
  }));

  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([
          hydrateLanguage(),
          hydrateFromStorage(),
          hydrateTheme(),
          hydrateNotifications(),
          hydrateSetup(),
        ]);

        // Check recurring items and create notifications for due ones
        const dueItems = checkAndNotify();
        await Promise.all(dueItems.map(item => 
          addNotification({
            title: 'Tekrarlayan Ödeme Hatırlatması',
            body: `${item.description || item.category} — ${(item.amount / 100).toLocaleString('tr-TR')}₺`,
            type: 'RECURRING',
          })
        ));
      } catch (e) {
        console.error('Initialization error:', e);
      } finally {
        setIsReady(true);
      }
    };
    init();

    // FCM token — arka planda, loading'i bloke etmeden
    // FCM sync logic — now handled via AuthStore
    const syncDeviceToken = useAuthStore.getState().syncDeviceToken;
    init().then(() => syncDeviceToken());

    // Listen for token refreshes
    const unsubscribeTokenRefresh = messaging().onTokenRefresh(() => {
      syncDeviceToken();
    });

    // Listen for foreground messages
    const unsubscribeMessages = messaging().onMessage(async remoteMessage => {
      if (remoteMessage.notification) {
        addNotification({
          title: remoteMessage.notification.title || 'Yeni Bildirim',
          body: remoteMessage.notification.body || '',
          type: 'SYSTEM'
        });
        
        // UX: Titreşim (Önemli bildirimler için)
        if (remoteMessage.notification.body?.includes('₺') || remoteMessage.data?.importance === 'high') {
          Vibration.vibrate([0, 500, 200, 500]);
        }
      }
    });

    const handleNotificationNavigation = (remoteMessage: any) => {
      const type = remoteMessage.data?.type || '';
      const title = remoteMessage.notification?.title || '';
      const id = remoteMessage.data?.id || remoteMessage.data?.transactionId || remoteMessage.data?.debtId;
      
      console.log('[FCM] Routing notification:', { type, title, id });

      if (type === 'DEBT' || title.includes('Borç')) {
        navigate('Debts', { debtId: id });
      } else if (type === 'RECURRING' || title.includes('Ödeme')) {
        navigate('Transactions', { transactionId: id });
      } else if (type === 'EXPENSE') {
        navigate('Transactions', { transactionId: id });
      } else {
        navigate('Notifications');
      }
    };

    // Handle notification clicks when the app is in the background
    const unsubscribeNotificationOpened = messaging().onNotificationOpenedApp(remoteMessage => {
      console.log('[FCM] Notification opened from background:', remoteMessage);
      handleNotificationNavigation(remoteMessage);
    });

    // Handle notification clicks when the app is in the quit state
    messaging().getInitialNotification().then(remoteMessage => {
      if (remoteMessage) {
        console.log('[FCM] Initial notification:', remoteMessage);
        handleNotificationNavigation(remoteMessage);
      }
    });

    return () => {
      unsubscribeTokenRefresh();
      unsubscribeMessages();
      unsubscribeNotificationOpened();
    };
  }, []);

  // ── Auto-detect setup: if user has a token but setup flag is missing
  //    Check backend for existing data whenever token becomes available.
  const token = useAuthStore((s) => s.token);
  const isSetupComplete = useSetupStore((s) => s.isSetupComplete);
  const setSetupComplete = useSetupStore((s) => s.setSetupComplete);

  useEffect(() => {
    if (token && !isSetupComplete) {
      getTransactions(1, 1)
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
      <View style={{ flex: 1, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', gap: 32 }}>
        <ReAnimated.View entering={FadeIn.duration(1000)} style={logoStyle}>
          <Image 
            source={require('./src/assets/logo-text.png')} 
            style={{ 
              width: 220, 
              height: 55, 
              resizeMode: 'contain', 
              opacity: 1,
              shadowColor: theme.colors.accent,
              shadowOffset: { width: 0, height: 12 },
              shadowOpacity: 0.4,
              shadowRadius: 16,
            }} 
          />
        </ReAnimated.View>
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
          animated={true}
        />
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;