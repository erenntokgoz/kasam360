import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Switch, ScrollView, Platform, Alert, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/useAuthStore';
import { useBudgetStore } from '../store/useBudgetStore';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';
import { changeLanguage } from '../i18n';

const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  
  const { user, logout } = useAuthStore();
  const { monthlyLimit, setMonthlyLimit, warningThreshold, setWarningThreshold } = useBudgetStore();
  const { isDarkMode, toggleTheme } = useThemeStore();
  
  const theme = getTheme(isDarkMode);

  const [limitInput, setLimitInput] = useState(monthlyLimit ? monthlyLimit.toString() : '');
  const [warningInput, setWarningInput] = useState(warningThreshold ? warningThreshold.toString() : '');

  useEffect(() => {
    setLimitInput(monthlyLimit ? monthlyLimit.toString() : '');
    setWarningInput(warningThreshold ? warningThreshold.toString() : '');
  }, [monthlyLimit, warningThreshold]);

  const handleLimitChange = (val: string) => {
    setLimitInput(val);
    const num = parseInt(val, 10);
    if (!isNaN(num)) {
      setMonthlyLimit(num);
    } else if (val === '') {
      setMonthlyLimit(0);
    }
  };

  const handleWarningChange = (val: string) => {
    setWarningInput(val);
    const num = parseInt(val, 10);
    if (!isNaN(num)) {
      setWarningThreshold(num);
    } else if (val === '') {
      setWarningThreshold(0);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      t('settings.logoutConfirm'),
      t('settings.logoutMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.logout'), style: 'destructive', onPress: logout },
      ]
    );
  };

  const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.primary },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingVertical: 12,
      paddingTop: insets.top + 12,
      backgroundColor: theme.colors.surface,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
        },
        android: {
          elevation: 4,
        },
      }),
    },
    headerTitle: { fontFamily: 'System', fontSize: 18, fontWeight: '600', color: theme.colors.textPrimary },
    content: { flex: 1, padding: 16 },
    section: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
        },
        android: {
          elevation: 2,
        },
      }),
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconContainer: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    rowTitle: {
      fontSize: 16,
      color: theme.colors.textPrimary,
      fontWeight: '500',
    },
    rowValue: {
      fontSize: 15,
      color: theme.colors.textSecondary,
    },
    divider: {
      height: 1,
      backgroundColor: theme.colors.border,
      marginVertical: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      color: theme.colors.textPrimary,
      width: 100,
      textAlign: 'right',
      backgroundColor: theme.colors.card,
    },
    langButtons: {
      flexDirection: 'row',
      gap: 8,
    },
    langButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    langButtonActive: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    langText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
    },
    langTextActive: {
      color: '#fff',
      fontWeight: '600',
    },
    logoutBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      marginTop: 8,
      marginBottom: insets.bottom + 24,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
        },
        android: {
          elevation: 2,
        },
      }),
    },
    logoutText: {
      marginLeft: 8,
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.dangerLight,
    },
  });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Ayarlar</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Section */}
        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconContainer}>
                <Icon name="briefcase" size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.rowTitle}>İşletme Adı</Text>
            </View>
            <Text style={styles.rowValue}>{user?.businessName || '-'}</Text>
          </View>
          <View style={styles.divider} />
          
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconContainer}>
                <Icon name="phone" size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.rowTitle}>Telefon</Text>
            </View>
            <Text style={styles.rowValue}>{user?.phone || '-'}</Text>
          </View>
          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconContainer}>
                <Icon name="award" size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.rowTitle}>Abonelik Durumu</Text>
            </View>
            <Text style={styles.rowValue}>{user?.subscriptionStatus || '-'}</Text>
          </View>
        </View>

        {/* Preferences Section */}
        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconContainer}>
                <Icon name={isDarkMode ? 'moon' : 'sun'} size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.rowTitle}>Karanlık Mod</Text>
            </View>
            <Switch
              value={isDarkMode}
              onValueChange={toggleTheme}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconContainer}>
                <Icon name="globe" size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.rowTitle}>Dil Seçimi</Text>
            </View>
            <View style={styles.langButtons}>
              <Pressable
                style={[styles.langButton, i18n.language === 'tr' && styles.langButtonActive]}
                onPress={() => changeLanguage('tr')}
              >
                <Text style={[styles.langText, i18n.language === 'tr' && styles.langTextActive]}>TR</Text>
              </Pressable>
              <Pressable
                style={[styles.langButton, i18n.language === 'en' && styles.langButtonActive]}
                onPress={() => changeLanguage('en')}
              >
                <Text style={[styles.langText, i18n.language === 'en' && styles.langTextActive]}>EN</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.divider} />

          <Pressable style={styles.row} onPress={() => navigation.navigate('Notifications')}>
            <View style={styles.rowLeft}>
              <View style={styles.iconContainer}>
                <Icon name="bell" size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.rowTitle}>Bildirimler</Text>
            </View>
            <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
          </Pressable>
        </View>

        {/* Budget Section */}
        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconContainer}>
                <Icon name="target" size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.rowTitle}>Aylık Bütçe Limiti</Text>
            </View>
            <TextInput
              style={styles.input}
              value={limitInput}
              onChangeText={handleLimitChange}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.colors.textTertiary}
            />
          </View>
          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconContainer}>
                <Icon name="alert-triangle" size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.rowTitle}>Uyarı Eşiği (%)</Text>
            </View>
            <TextInput
              style={styles.input}
              value={warningInput}
              onChangeText={handleWarningChange}
              keyboardType="numeric"
              placeholder="80"
              placeholderTextColor={theme.colors.textTertiary}
              maxLength={3}
            />
          </View>
        </View>

        {/* Logout Button */}
        <Pressable style={styles.logoutBtn} onPress={handleLogout}>
          <Icon name="log-out" size={20} color={theme.colors.dangerLight} />
          <Text style={styles.logoutText}>Çıkış Yap</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
};

export default SettingsScreen;
