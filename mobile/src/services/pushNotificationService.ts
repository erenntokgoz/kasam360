import messaging from '@react-native-firebase/messaging';
import { Alert, Platform } from 'react-native';
import { navigate } from '../navigation/navigationRef';
import apiClient from '../api/client';
import { useAuthStore } from '../store/useAuthStore';

class PushNotificationService {
  /**
   * Bildirim izinlerini ister ve FCM token'ı alır.
   */
  static async requestUserPermission() {
    if (Platform.OS === 'ios') {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled) {
        console.log('Authorization status:', authStatus);
      }
    } else if (Platform.OS === 'android') {
      // Android 13+ requires explicit permission request
      try {
        // Normally done via PermissionsAndroid, simplified here
        console.log('Android push permissions requested if needed.');
      } catch (err) {
        console.warn('Android permission error:', err);
      }
    }
    
    return await this.getFcmToken();
  }

  static async getFcmToken() {
    try {
      const token = await messaging().getToken();
      
      const authToken = useAuthStore.getState().token;
      if (authToken && token) {
        await apiClient
          .put('/api/tenant/device-token', { deviceToken: token })
          .catch((e) => console.warn('[FCM] Token sync failed', e));
      }
      
      return token;
    } catch (error) {
      console.error('Error getting FCM token:', error);
      return null;
    }
  }

  /**
   * Foreground, Background ve Quit state listener'ları başlatır.
   */
  static initializeListeners() {
    // Foreground (Uygulama açıkken gelen bildirimler)
    const unsubscribe = messaging().onMessage(async remoteMessage => {
      console.log('A new FCM message arrived in foreground!', JSON.stringify(remoteMessage));
      
      const { title, body } = remoteMessage.notification || {};
      Alert.alert(
        title || 'Yeni Bildirim',
        body || 'Bir bildirim aldınız.',
        [{ text: 'Tamam' }]
      );
    });

    // Background'da iken veya kapalıyken bildirime tıklanınca (Açılış anında)
    messaging().onNotificationOpenedApp(remoteMessage => {
      console.log('Notification caused app to open from background state:', remoteMessage.notification);
      const type = remoteMessage.data?.type;
      if (type === 'budget' || type === 'BUDGET' || type === 'BUDGET_ALERT') {
        navigate('Dashboard');
      } else if (type === 'debt' || type === 'DEBT' || type === 'DEBT_REMINDER' || type === 'DEBT_OVERDUE') {
        navigate('Debts');
      }
    });

    // Uygulama tamamen kapalıyken (Quit state) bildirime tıklanıp açıldığında
    messaging()
      .getInitialNotification()
      .then(remoteMessage => {
        if (remoteMessage) {
          console.log('Notification caused app to open from quit state:', remoteMessage.notification);
          const type = remoteMessage.data?.type;
          if (type === 'budget' || type === 'BUDGET' || type === 'BUDGET_ALERT') {
            navigate('Dashboard');
          } else if (type === 'debt' || type === 'DEBT' || type === 'DEBT_REMINDER' || type === 'DEBT_OVERDUE') {
            navigate('Debts');
          }
        }
      });

    return unsubscribe;
  }
}

// Background handler'ı uygulamanın kök dizininde (index.js/App.tsx dışında) kaydetmek gerekir.
// messaging().setBackgroundMessageHandler(async remoteMessage => {
//   console.log('Message handled in the background!', remoteMessage);
// });

export default PushNotificationService;
