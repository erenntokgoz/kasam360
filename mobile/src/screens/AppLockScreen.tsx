import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useSecurityStore } from '../store/useSecurityStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';

export const AppLockScreen: React.FC = () => {
  const [pin, setPin] = useState('');
  const { unlock, pin: savedPin } = useSecurityStore();
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);

  const handleKeyPress = (val: string) => {
    if (pin.length < 4) {
      const newPin = pin + val;
      setPin(newPin);
      
      if (newPin.length === 4) {
        // Auto submit
        setTimeout(() => {
          const success = unlock(newPin);
          if (!success) {
            Alert.alert('Hata', 'Geçersiz PIN');
            setPin('');
          }
        }, 100);
      }
    }
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.primary }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
          Uygulama Kilitli
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
          Devam etmek için 4 haneli PIN kodunuzu girin
        </Text>

        <View style={styles.pinContainer}>
          {[...Array(4)].map((_, i) => (
            <View
              key={i}
              style={[
                styles.pinDot,
                {
                  backgroundColor:
                    i < pin.length
                      ? theme.colors.accent
                      : theme.colors.border,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.keyboard}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <TouchableOpacity
              key={num}
              style={[styles.key, { backgroundColor: theme.colors.surface }]}
              onPress={() => handleKeyPress(num.toString())}
            >
              <Text style={[styles.keyText, { color: theme.colors.textPrimary }]}>
                {num}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={styles.keyEmpty} />
          <TouchableOpacity
            style={[styles.key, { backgroundColor: theme.colors.surface }]}
            onPress={() => handleKeyPress('0')}
          >
            <Text style={[styles.keyText, { color: theme.colors.textPrimary }]}>
              0
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.key, { backgroundColor: 'transparent' }]}
            onPress={handleBackspace}
          >
            <Text style={[styles.keyText, { color: theme.colors.danger }]}>
              ⌫
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 48,
    textAlign: 'center',
  },
  pinContainer: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 48,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  keyboard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    maxWidth: 320,
  },
  key: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  keyEmpty: {
    width: 80,
    height: 80,
  },
  keyText: {
    fontSize: 24,
    fontWeight: '600',
  },
});

export default AppLockScreen;
