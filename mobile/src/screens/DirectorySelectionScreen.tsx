import React from 'react';
import { View, Text, StyleSheet, Pressable, StatusBar } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';

const DirectorySelectionScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);

  const cards = [
    {
      title: 'Müşteri / Tedarikçi',
      subtitle: 'Borç, alacak ve işletme rehberiniz',
      icon: 'users',
      color: theme.colors.accent,
      route: 'Contacts',
    },
    {
      title: 'Personel Rehberi',
      subtitle: 'Çalışanlarınızın maaş ve avans kayıtları',
      icon: 'briefcase',
      color: theme.colors.success,
      route: 'StaffExpenses',
    },
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Rehber Seçimi</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.container}>
        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
          Lütfen hangi rehberi görüntülemek istediğinizi seçiniz:
        </Text>

        <View style={styles.grid}>
          {cards.map((card, index) => (
            <Pressable
              key={index}
              style={[styles.card, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}
              onPress={() => navigation.navigate(card.route)}
            >
              <View style={[styles.iconCircle, { backgroundColor: card.color + '20' }]}>
                <Icon name={card.icon} size={32} color={card.color} />
              </View>
              <View style={styles.cardContent}>
                <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>{card.title}</Text>
                <Text style={[styles.cardSubtitle, { color: theme.colors.textTertiary }]}>{card.subtitle}</Text>
              </View>
              <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  label: { fontSize: 15, textAlign: 'center', marginBottom: 40, lineHeight: 22 },
  grid: { gap: 20 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 24,
    borderRadius: 24,
    gap: 20,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, lineHeight: 18 },
});

export default DirectorySelectionScreen;
