import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeIcon } from '../components/SafeIcon';
import { useLogStore } from '../store/useLogStore';

export default function LogsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const logs = useLogStore((s) => s.logs);

  const renderLog = ({ item }: { item: any }) => {
    let color = '#FFFFFF';
    if (item.type === 'success') color = '#10B981';
    if (item.type === 'error') color = '#EF4444';

    return (
      <View style={styles.logRow}>
        <Text style={styles.timestamp}>[{item.timestamp}]</Text>
        <Text style={[styles.action, { color }]}>{item.action}</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <SafeIcon name="menu-outline" size={28} color="#FFFFFF" fallbackText="MENÜ" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SİSTEM KAYITLARI</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={styles.statusDot} />
        </View>
      </View>
      <FlatList
        data={logs}
        keyExtractor={(item) => item.id}
        renderItem={renderLog}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    backgroundColor: '#10B981',
  },
  listContent: {
    padding: 10,
  },
  logRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    flexWrap: 'wrap',
  },
  timestamp: {
    color: '#8E8E93',
    fontSize: 12,
    marginRight: 10,
    fontWeight: 'bold',
  },
  action: {
    fontSize: 12,
    flex: 1,
    fontWeight: '500',
  },
});
