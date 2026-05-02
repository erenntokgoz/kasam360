import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeIcon } from '../components/SafeIcon';

export default function NotificationSettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [reportsEnabled, setReportsEnabled] = useState(true);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()}>
          <SafeIcon name="arrow-back-outline" size={28} color="#FFFFFF" fallbackText="GERİ" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>BİLDİRİMLER</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.list}>
        <View style={styles.row}>
          <Text style={styles.rowText}>ANLIK BİLDİRİMLER</Text>
          <Switch 
            value={pushEnabled} 
            onValueChange={setPushEnabled}
            trackColor={{ false: '#333333', true: '#10B981' }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.rowText}>E-POSTA BİLDİRİMLERİ</Text>
          <Switch 
            value={emailEnabled} 
            onValueChange={setEmailEnabled}
            trackColor={{ false: '#333333', true: '#10B981' }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.rowText}>HAFTALIK ÖZET RAPORLARI</Text>
          <Switch 
            value={reportsEnabled} 
            onValueChange={setReportsEnabled}
            trackColor={{ false: '#333333', true: '#10B981' }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#FFFFFF',
  },
  list: {
    paddingTop: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  rowText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
