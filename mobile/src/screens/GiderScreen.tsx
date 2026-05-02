import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeIcon } from '../components/SafeIcon';
import { TransactionList } from '../components/TransactionList';
import { theme } from '../theme';

export default function GiderScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <SafeIcon name="menu-outline" size={28} color="#FFFFFF" fallbackText="MENÜ" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>GİDER KAYITLARI</Text>
        <TouchableOpacity hitSlop={12} onPress={() => (navigation.navigate as any)('ProfileSettings')}>
          <SafeIcon name="person-outline" size={28} color="#FFFFFF" fallbackText="PROFİL" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <TransactionList type="EXPENSE" />
      </View>

      <TouchableOpacity 
        style={styles.fabButton} 
        activeOpacity={0.8}
        onPress={() => (navigation.navigate as any)('AddTransaction', { type: 'EXPENSE' })}
      >
        <Text style={styles.fabText}>YENİ GİDER EKLE</Text>
      </TouchableOpacity>
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
    fontSize: 16,
    fontFamily: 'Inter-Black',
    fontWeight: '900',
    letterSpacing: 2,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  fabButton: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    paddingVertical: 14,
    marginHorizontal: 20,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
