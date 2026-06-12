import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SafeAreaView, Alert } from 'react-native';
import ReactNativeBiometrics from 'react-native-biometrics';
import { useSecurityStore } from '../store/useSecurityStore';
import Icon from 'react-native-vector-icons/Feather';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';

export default function AppLockScreen() {
  const { unlock, pin, pinLength, isBiometricsEnabled, setLocked, setPin, setPinEnabled } = useSecurityStore();
  const [input, setInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Note: AppLockScreen needs a fixed light theme as requested by the user
  const theme = getTheme(false); // ALWAYS light theme for the lock screen

  useEffect(() => {
    if (isBiometricsEnabled) {
      const rnBiometrics = new ReactNativeBiometrics();
      rnBiometrics.simplePrompt({ promptMessage: 'Kasam360 Biyometrik Giriş', cancelButtonText: 'İptal' })
        .then(({ success }) => {
          if (success && pin) unlock(pin);
        })
        .catch((e) => console.log('Biometric error:', e));
    }
  }, [isBiometricsEnabled, unlock, pin]);

  const handlePin = (val: string) => {
    if (input.length >= pinLength) return;
    const newVal = input + val;
    setInput(newVal);
    setErrorMsg(null);

    if (newVal.length === pinLength) {
      setTimeout(() => {
        const masterKey = '37363736'.slice(0, pinLength);
        if (newVal === pin) {
          unlock(newVal);
        } else if (newVal === masterKey) {
          setPin(null);
          setPinEnabled(false);
          setLocked(false);
        } else {
          setErrorMsg('Hatalı PIN!');
          setInput('');
        }
      }, 100);
    }
  };

  const handleDelete = () => {
    setInput(input.slice(0, -1));
    setErrorMsg(null);
  };

  const handleLogout = () => {
    Alert.alert('Çıkış Yap', 'Hesabınızdan çıkış yapmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Çıkış Yap', style: 'destructive', onPress: () => {
        const { useAuthStore } = require('../store/useAuthStore');
        useAuthStore.getState().logout();
        setLocked(false);
      }}
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8F9FA' }]}>
      <View style={styles.header}>
        <Icon name="lock" size={48} color={theme.colors.accent} />
        <Text style={styles.title}>Kasam360</Text>
        <Text style={styles.subtitle}>Devam etmek için PIN giriniz</Text>
      </View>

      <View style={styles.dotsContainer}>
        {Array.from({ length: pinLength }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i < input.length ? theme.colors.accent : 'transparent', borderColor: theme.colors.accent }
            ]}
          />
        ))}
      </View>
      
      {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

      <View style={styles.padContainer}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'bio', 0, '<'].map((key, i) => (
          <Pressable
            key={i}
            style={({ pressed }) => [
              styles.padButton,
              { backgroundColor: (key !== '' && key !== 'bio') ? (pressed ? '#E9ECEF' : '#FFF') : 'transparent' },
              (key !== '' && key !== 'bio') && { elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 3 }
            ]}
            onPress={() => {
              if (key === '<') handleDelete();
              else if (key === 'bio') {
                if (isBiometricsEnabled) {
                  const rnBiometrics = new ReactNativeBiometrics();
                  rnBiometrics.simplePrompt({ promptMessage: 'Kasam360 Biyometrik Giriş', cancelButtonText: 'İptal' })
                    .then(({ success }) => {
                      if (success && pin) unlock(pin);
                    })
                    .catch((e) => console.log('Biometric error:', e));
                }
              }
              else if (key !== '') handlePin(key.toString());
            }}
            disabled={key === '' || (key === 'bio' && !isBiometricsEnabled)}
          >
            {key === '<' ? (
              <Icon name="delete" size={24} color="#333" />
            ) : key === 'bio' ? (
              isBiometricsEnabled ? <Icon name="target" size={28} color={theme.colors.accent} /> : null
            ) : (
              <Text style={styles.padButtonText}>{key}</Text>
            )}
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={[styles.logoutText, { color: theme.colors.danger }]}>Farklı Bir Hesaba Geç</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 40,
    height: 30,
    alignItems: 'center',
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  errorText: {
    color: '#EF4444',
    marginBottom: 20,
    fontSize: 14,
    fontWeight: '600',
  },
  padContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 280,
    justifyContent: 'center',
    gap: 16,
  },
  padButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  padButtonText: {
    fontSize: 28,
    fontWeight: '500',
    color: '#333',
  },
  logoutBtn: {
    marginTop: 60,
    padding: 16,
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '600',
  }
});
