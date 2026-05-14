import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useEmployeeStore, Employee } from '../store/useEmployeeStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';

export const EmployeeListScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { employees, fetchEmployees } = useEmployeeStore();
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const renderItem = ({ item }: { item: Employee }) => (
    <Pressable
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
      onPress={() => navigation.navigate('EmployeeDetail', { employeeId: item.id })}
    >
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.name, { color: theme.colors.textPrimary }]}>
            {item.name}
          </Text>
          <Text style={[styles.role, { color: theme.colors.textSecondary }]}>
            {item.role}
          </Text>
        </View>
        <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
      </View>
      <View style={styles.cardFooter}>
        <Text style={[styles.salary, { color: theme.colors.accent }]}>
          Maaş: {item.salary.toLocaleString('tr-TR')} ₺
        </Text>
        <Text style={[styles.date, { color: theme.colors.textTertiary }]}>
          Başlangıç: {item.startDate}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primary, paddingTop: insets.top }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Personel Listesi</Text>
        <Pressable onPress={() => {/* Add employee modal or screen */}}>
          <Icon name="plus" size={24} color={theme.colors.accent} />
        </Pressable>
      </View>

      <FlatList
        data={employees}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ color: theme.colors.textSecondary }}>Henüz personel bulunamadı.</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  role: {
    fontSize: 14,
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  salary: {
    fontSize: 14,
    fontWeight: '500',
  },
  date: {
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 40,
  },
});

export default EmployeeListScreen;
