import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { SafeIcon } from '../components/SafeIcon';

export default function NotificationSettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [reportsEnabled, setReportsEnabled] = useState(true);

  const ToggleItem = ({ icon, label, value, onValueChange, isLast }: any) => (
    <View>
      <View style={styles.item}>
        <View style={styles.itemLeft}>
          <SafeIcon name={icon} size={22} color={theme.colors.textPrimary} fallbackText="•" />
          <Text style={styles.itemLabel}>{label}</Text>
        </View>
        <Switch 
          value={value} 
          onValueChange={onValueChange}
          trackColor={{ false: '#333333', true: theme.colors.accent }}
          thumbColor={value ? theme.colors.primary : '#FFFFFF'}
          ios_backgroundColor="#333333"
        />
      </View>
      {!isLast && <View style={styles.divider} />}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()} style={styles.backButton}>
          <SafeIcon name="arrow-back-outline" size={24} color={theme.colors.textPrimary} fallbackText="<" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>BİLDİRİMLER</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionHeader}>TERCİHLER</Text>
        <View style={styles.section}>
          <ToggleItem 
            icon="notifications-outline" 
            label="Anlık Bildirimler" 
            value={pushEnabled} 
            onValueChange={setPushEnabled} 
          />
          <ToggleItem 
            icon="mail-outline" 
            label="E-posta Bildirimleri" 
            value={emailEnabled} 
            onValueChange={setEmailEnabled} 
          />
          <ToggleItem 
            icon="bar-chart-outline" 
            label="Özet Raporları" 
            value={reportsEnabled} 
            onValueChange={setReportsEnabled} 
            isLast 
          />
        </View>
        
        <Text style={styles.infoText}>
          Bildirim ayarları, cihazınızın sistem ayarlarından da yönetilebilir.
        </Text>
      </ScrollView>
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
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: theme.fonts.black,
    fontSize: theme.fontSizes.lg,
    color: theme.colors.textPrimary,
    letterSpacing: 2,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  sectionHeader: {
    fontFamily: theme.fonts.black,
    fontSize: 11,
    color: theme.colors.textTertiary,
    letterSpacing: 1.5,
    marginTop: 32,
    marginBottom: 8,
    paddingHorizontal: theme.spacing.lg,
    textTransform: 'uppercase',
  },
  section: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  item: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemLabel: {
    fontFamily: theme.fonts.light,
    fontSize: 16,
    color: theme.colors.textPrimary,
    marginLeft: 16,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 56,
  },
  infoText: {
    fontFamily: theme.fonts.light,
    fontSize: 13,
    color: theme.colors.textSecondary,
    paddingHorizontal: theme.spacing.lg,
    marginTop: 16,
  },
});
