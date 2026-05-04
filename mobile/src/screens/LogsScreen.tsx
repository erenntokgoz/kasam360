import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeIcon } from '../components/SafeIcon';
import { useLogStore } from '../store/useLogStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';
import { formatDate } from '../utils/format';

export default function LogsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const logs = useLogStore((s) => s.logs);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);

  const renderLog = ({ item }: { item: any }) => {
    let color = theme.colors.textPrimary;
    if (item.type === 'success') color = theme.colors.successLight;
    if (item.type === 'error') color = theme.colors.dangerLight;

    return (
      <View style={[styles.logRow, { borderColor: theme.colors.border }]}>
        <Text style={[styles.timestamp, { color: theme.colors.textSecondary }]}>[{formatDate(item.timestamp)}]</Text>
        <Text style={[styles.action, { color }]}>{item.action}</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <View style={[styles.header, { borderColor: theme.colors.border }]}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <SafeIcon name="menu-outline" size={28} color={theme.colors.textPrimary} fallbackText="MENÜ" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>SİSTEM KAYITLARI</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={[styles.statusDot, { backgroundColor: theme.colors.successLight }]} />
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
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  listContent: {
    padding: 10,
  },
  logRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    flexWrap: 'wrap',
  },
  timestamp: {
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
