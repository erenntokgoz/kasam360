import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ReactNativeBiometrics from 'react-native-biometrics';
import { useSecurityStore } from '../store/useSecurityStore';

export default function AppLockScreen() {
  const { unlock, pin, isBiometricsEnabled } = useSecurityStore();
  const [input, setInput] = useState('');

  useEffect(() => {
    if (isBiometricsEnabled) {
      const rnBiometrics = new ReactNativeBiometrics();
      rnBiometrics.simplePrompt({ promptMessage: 'Kasam360 Biyometrik Giriş' })
        .then(({ success }) => { if (success) unlock(); })
        .catch(() => {});
    }
  }, [isBiometricsEnabled, unlock]);

  const handlePin = (val: string) => {
    const newVal = input + val;
    setInput(newVal);
    if (newVal.length === 4) {
      if (newVal === pin) unlock();
      else setInput('');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kasam360 Kilit</Text>
      <Text style={styles.dots}>{'*'.repeat(input.length)}</Text>
      <View style={styles.pad}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '<'].map((key, i) => (
          <TouchableOpacity key={i} style={styles.btn} onPress={() => {
            if (key === '<') setInput(input.slice(0, -1));
            else if (key !== '') handlePin(key.toString());
          }}>
            <Text style={styles.btnText}>{key}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, color: '#fff', marginBottom: 40 },
  dots: { fontSize: 40, color: '#fff', marginBottom: 40, letterSpacing: 15, height: 50 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 280, justifyContent: 'center' },
  btn: { width: 80, height: 80, justifyContent: 'center', alignItems: 'center', margin: 5, borderRadius: 40, backgroundColor: '#222' },
  btnText: { fontSize: 24, color: '#fff' }
});
