import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useEmployeeStore } from '../store/useEmployeeStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';
import { EmptyState } from '../components/EmptyState';

export const EmployeeDetailScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { employeeId } = route.params;
  const { employees } = useEmployeeStore();
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);

  const employee = employees.find((e) => e.id === employeeId);

  if (!employee) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: theme.colors.textPrimary }}>Personel bulunamadı.</Text>
        <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
          <Text style={{ color: theme.colors.accent }}>Geri Dön</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primary, paddingTop: insets.top }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Personel Detayı</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Card */}
        <View style={[styles.profileCard, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.name, { color: theme.colors.textPrimary }]}>{employee.name}</Text>
          <Text style={[styles.role, { color: theme.colors.textSecondary }]}>{employee.role}</Text>
          <View style={styles.separator} />
          <View style={styles.detailRow}>
            <Text style={{ color: theme.colors.textTertiary }}>Maaş</Text>
            <Text style={[styles.detailValue, { color: theme.colors.accent }]}>{employee.salary.toLocaleString('tr-TR')} ₺</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={{ color: theme.colors.textTertiary }}>Başlangıç Tarihi</Text>
            <Text style={[styles.detailValue, { color: theme.colors.textPrimary }]}>{employee.startDate}</Text>
          </View>
        </View>

        {/* Salary History */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Maaş Geçmişi</Text>
          {employee.salaries.length === 0 ? (
            <EmptyState
              title="Maaş Kaydı Yok"
              message="Bu personele ait maaş ödeme kaydı bulunamadı."
              icon={<Icon name="credit-card" size={32} color={theme.colors.textTertiary} />}
            />
          ) : (
            employee.salaries.map((salary) => (
              <View key={salary.id} style={[styles.itemCard, { backgroundColor: theme.colors.surface }]}>
                <View>
                  <Text style={[styles.itemTitle, { color: theme.colors.textPrimary }]}>{salary.month}</Text>
                  <Text style={[styles.itemDate, { color: theme.colors.textTertiary }]}>{salary.date}</Text>
                </View>
                <Text style={[styles.itemAmount, { color: theme.colors.success }]}>
                  +{salary.amount.toLocaleString('tr-TR')} ₺
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Expense History */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Gider Geçmişi</Text>
          {employee.expenses.length === 0 ? (
            <EmptyState
              title="Gider Kaydı Yok"
              message="Bu personele ait gider kaydı bulunamadı."
              icon={<Icon name="file-text" size={32} color={theme.colors.textTertiary} />}
            />
          ) : (
            employee.expenses.map((expense) => (
              <View key={expense.id} style={[styles.itemCard, { backgroundColor: theme.colors.surface }]}>
                <View>
                  <Text style={[styles.itemTitle, { color: theme.colors.textPrimary }]}>{expense.description}</Text>
                  <Text style={[styles.itemDate, { color: theme.colors.textTertiary }]}>{expense.date}</Text>
                </View>
                <Text style={[styles.itemAmount, { color: theme.colors.danger }]}>
                  -{expense.amount.toLocaleString('tr-TR')} ₺
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
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
  scrollContent: {
    padding: 16,
    gap: 24,
  },
  profileCard: {
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  role: {
    fontSize: 14,
    marginBottom: 16,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailValue: {
    fontWeight: '600',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  itemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  itemDate: {
    fontSize: 12,
    marginTop: 2,
  },
  itemAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
});

export default EmployeeDetailScreen;
