import { Vibration, Platform } from 'react-native';

export const useHaptics = () => {
  const trigger = (type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'medium') => {
    if (Platform.OS === 'ios') {
      switch (type) {
        case 'light':
          Vibration.vibrate(10);
          break;
        case 'medium':
          Vibration.vibrate(20);
          break;
        case 'heavy':
          Vibration.vibrate(50);
          break;
        case 'success':
          Vibration.vibrate([0, 10, 50, 10]);
          break;
        case 'warning':
          Vibration.vibrate([0, 20, 100, 20]);
          break;
        case 'error':
          Vibration.vibrate([0, 50, 100, 50, 100, 50]);
          break;
        default:
          Vibration.vibrate(20);
      }
    } else {
      // Android
      switch (type) {
        case 'light':
          Vibration.vibrate(10);
          break;
        case 'medium':
          Vibration.vibrate(20);
          break;
        case 'heavy':
          Vibration.vibrate(50);
          break;
        case 'success':
          Vibration.vibrate([0, 10, 50, 10]);
          break;
        case 'warning':
          Vibration.vibrate([0, 20, 100, 20]);
          break;
        case 'error':
          Vibration.vibrate([0, 50, 50, 50]);
          break;
        default:
          Vibration.vibrate(20);
      }
    }
  };

  return { trigger };
};
