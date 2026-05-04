import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, Alert, Switch } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useRecurringStore, RecurringItem } from '../store/useRecurringStore';
import AddTransactionModal from '../components/AddTransactionModal';
import { formatCurrency } from '../utils/format';

const frequencyMap = {
  DAILY: 'Günlük',
  WEEKLY: 'Haftalık',
  MONTHLY: 'Aylık',
  YEARLY: 'Yıllık',
};

const RecurringsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { recurrings, toggleRecurring, removeRecurring } = useRecurringStore();
  const [showAddModal, setShowAddModal] = React.useState(false);

  const handleLongPress = (id: string) => {
    Alert.alert('Hatırlatıcıyı Sil', 'Bu hatırlatıcıyı silmek istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeRecurring(id) },
    ]);
  };

  const renderItem = ({ item, index }: { item: RecurringItem; index: number }) => {
    const isIncome = item.type === 'INCOME';
    const iconName = isIncome ? 'arrow-down-left' : 'arrow-up-right';
    const amountColor = isIncome ? theme.colors.successLight : theme.colors.dangerLight;
    const displayAmount = isIncome ? item.amount : -item.amount;

    return (
      <View style={[styles.rowContainer, { backgroundColor: theme.colors.surface }, !item.active && { opacity: 0.6 }]}>
        <Pressable
          style={styles.rowContent}
          onLongPress={() => handleLongPress(item.id)}
          activeOpacity={0.7}
        >
          <View style={[styles.rowIconCircle, { backgroundColor: isIncome ? 'rgba(16, 185, 129, 0.10)' : 'rgba(248, 113, 113, 0.10)' }]}>
            <Icon name={iconName} size={16} color={amountColor} />
          </View>
          <View style={styles.rowMiddle}>
            <Text style={[styles.rowCategory, { color: theme.colors.textPrimary }]} numberOfLines={1}>{item.category || item.type}</Text>
            <Text style={[styles.rowFreq, { color: theme.colors.textTertiary }]}>{frequencyMap[item.frequency]}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowAmount, { color: amountColor }]}>{formatCurrency(displayAmount, true)}</Text>
            <Switch
              value={item.active}
              onValueChange={() => toggleRecurring(item.id)}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor={theme.colors.primary}
              style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
            />
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.colors.primary} />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Hatırlatıcılar</Text>
        <Pressable hitSlop={12} onPress={() => setShowAddModal(true)}>
          <Icon name="plus-circle" size={22} color={theme.colors.accent} />
        </Pressable>
      </View>
      <FlatList
        data={recurrings}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing.xl }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing['4xl'], gap: theme.spacing.sm }}>
            <Icon name="calendar" size={48} color={theme.colors.textTertiary} />
            <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.lg, color: theme.colors.textSecondary, marginTop: theme.spacing.base }}>Hatırlatıcı Yok</Text>
            <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary, textAlign: 'center', maxWidth: 260 }}>Düzenli işlemleriniz için hatırlatıcı ekleyin.</Text>
          </View>
        }
      />
      <AddTransactionModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontFamily: 'System', fontSize: 18, letterSpacing: 0.4 },
  listContent: {},
  rowContainer: { borderRadius: 10, marginBottom: 16 },
  rowContent: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  rowIconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1, marginRight: 8 },
  rowCategory: { fontFamily: 'System', fontSize: 15, marginBottom: 2 },
  rowFreq: { fontFamily: 'System', fontSize: 11 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontFamily: 'System', fontSize: 15, letterSpacing: -0.3, marginBottom: 4 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'System', fontSize: 18, marginTop: 12 },
  emptySubtitle: { fontFamily: 'System', fontSize: 13, textAlign: 'center', maxWidth: 260 },
});

export default RecurringsScreen;