import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';

const categories = [
  { id: 'all', title: 'Tüm İşlemler', icon: 'list', color: '#3B82F6' },
  { id: 'INCOME', title: 'Gelirler', icon: 'arrow-down-left', color: '#10B981' },
  { id: 'EXPENSE', title: 'Giderler', icon: 'arrow-up-right', color: '#EF4444' },
  { id: 'STAFF', title: 'Personel Ödemeleri', icon: 'users', color: '#8B5CF6' },
];

export const PastTransactionsCategoryScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);

  const renderItem = ({ item }: { item: typeof categories[0] }) => (
    <Pressable
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
      onPress={() => navigation.navigate('PastTransactionsMonth', { category: item.id, categoryTitle: item.title })}
    >
      <View style={[styles.iconCircle, { backgroundColor: item.color + '20' }]}>
        <Icon name={item.icon} size={24} color={item.color} />
      </View>
      <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
        {item.title}
      </Text>
      <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primary, paddingTop: insets.top }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Geçmiş İşlemler</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={categories}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            Görüntülemek istediğiniz kategoriyi seçiniz
          </Text>
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
  subtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PastTransactionsCategoryScreen;
