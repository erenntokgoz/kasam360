import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeIcon } from '../components/SafeIcon';

const settingsOptions = [
  { id: '0', title: 'Profili Düzenle', route: 'ProfileSettings' },
  { id: '2', title: 'Tema', route: 'ThemeSettings' },
  { id: '3', title: 'Bildirimler', route: 'NotificationSettings' },
];

export default function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <SafeIcon name="menu-outline" size={28} color="#FFFFFF" fallbackText="MENÜ" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AYARLAR</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.listContainer}>
          {settingsOptions.map((option) => (
            <TouchableOpacity 
              key={option.id} 
              style={styles.blockButton} 
              activeOpacity={0.8}
              onPress={() => (navigation.navigate as any)(option.route)}
            >
              <Text style={styles.blockButtonText}>{option.title.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity 
          style={styles.logoutButton} 
          activeOpacity={0.8}
          onPress={() => Alert.alert('ÇIKIŞ', 'Sistemden çıkış yapmak istediğinize emin misiniz?', [{ text: 'İPTAL' }, { text: 'ÇIKIŞ YAP', style: 'destructive' }])}
        >
          <Text style={styles.logoutButtonText}>SİSTEMDEN ÇIKIŞ YAP</Text>
        </TouchableOpacity>
      </ScrollView>
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
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  scrollContent: {
    padding: 20,
    flexGrow: 1,
  },
  listContainer: {
    gap: 16,
    marginBottom: 40,
    marginTop: 10,
  },
  blockButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    paddingVertical: 24,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  blockButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  logoutButton: {
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingVertical: 14,
    marginHorizontal: 20,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
  },
  logoutButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
