import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { SafeIcon } from '../components/SafeIcon';

export default function AlacakScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>ALACAKLARIM</Text>
        <TouchableOpacity 
          hitSlop={12} 
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          style={styles.iconButton}
        >
          <SafeIcon name="menu-outline" size={24} color={theme.colors.textPrimary} fallbackText="=" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.illustration}>
          <View style={styles.shapeMain} />
          <View style={[styles.shapeAccent, { backgroundColor: theme.colors.accent }]} />
        </View>
        <Text style={styles.emptyTitle}>Henüz alacak yok</Text>
        <Text style={styles.emptySubtitle}>Eklediğiniz alacaklar burada listelenecektir.</Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.primaryButton, { backgroundColor: theme.colors.accent }]} 
          activeOpacity={0.9}
          onPress={() => (navigation.navigate as any)('AddDebt', { type: 'GIVEN' })}
        >
          <Text style={styles.primaryButtonText}>YENİ ALACAK EKLE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primary,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontFamily: theme.fonts.black,
    fontSize: theme.fontSizes.lg,
    color: theme.colors.textPrimary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  illustration: {
    width: 100,
    height: 100,
    marginBottom: theme.spacing.xl,
  },
  shapeMain: {
    width: 80,
    height: 80,
    borderWidth: 1,
    borderColor: theme.colors.border,
    position: 'absolute',
    top: 0,
    left: 0,
  },
  shapeAccent: {
    width: 40,
    height: 40,
    position: 'absolute',
    bottom: 10,
    right: 10,
  },
  emptyTitle: {
    fontFamily: theme.fonts.black,
    fontSize: theme.fontSizes.lg,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: theme.fonts.light,
    fontSize: theme.fontSizes.base,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  footer: {
    padding: theme.spacing.lg,
  },
  primaryButton: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.none,
  },
  primaryButtonText: {
    fontFamily: theme.fonts.black,
    fontSize: theme.fontSizes.base,
    color: theme.colors.primary,
    letterSpacing: 1,
  },
});
