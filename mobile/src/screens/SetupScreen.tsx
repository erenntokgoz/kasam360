import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable,
  KeyboardAvoidingView, Platform, ScrollView, Image, ActivityIndicator, Alert
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useSetupStore } from '../store/useSetupStore';

const SetupScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const styles = getStyles(theme);
  const { setOpeningData, setSetupComplete } = useSetupStore();

  const [balance, setBalance] = useState('');
  const [debts, setDebts] = useState('');
  const [receivables, setReceivables] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleComplete = async () => {
    setIsSubmitting(true);
    const openingBalance = parseFloat(balance.replace(',', '.')) || 0;
    const openingDebts = parseFloat(debts.replace(',', '.')) || 0;
    const openingReceivables = parseFloat(receivables.replace(',', '.')) || 0;

    try {
      await setOpeningData({ openingBalance, openingDebts, openingReceivables });
      await setSetupComplete(true);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Kurulum kaydedilemedi.';
      Alert.alert('Hata', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.colors.primary }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: insets.top + theme.spacing['3xl'],
            paddingBottom: insets.bottom + theme.spacing['2xl'],
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          entering={FadeInDown.delay(100).duration(500).springify()}
          style={styles.brandSection}
        >
          <View style={styles.logoCircle}>
            <Icon name="settings" size={28} color={theme.colors.accent} />
          </View>
          <Image source={require('../assets/logo-text.png')} style={{ width: 160, height: 40, resizeMode: 'contain' }} />
          <Text style={styles.brandSubtitle}>{t('setup.subtitle')}</Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(250).duration(500).springify()}
          style={styles.formCard}
        >
          <Text style={styles.formTitle}>{t('setup.dataTitle')}</Text>

          <View style={styles.inputWrapper}>
            <Icon name="dollar-sign" size={16} color={theme.colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder={t('setup.balance')}
              placeholderTextColor={theme.colors.textTertiary}
              keyboardType="numeric"
              value={balance}
              onChangeText={setBalance}
            />
          </View>

          <View style={styles.inputWrapper}>
            <Icon name="trending-down" size={16} color={theme.colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder={t('setup.debts')}
              placeholderTextColor={theme.colors.textTertiary}
              keyboardType="numeric"
              value={debts}
              onChangeText={setDebts}
            />
          </View>

          <View style={styles.inputWrapper}>
            <Icon name="trending-up" size={16} color={theme.colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder={t('setup.receivables')}
              placeholderTextColor={theme.colors.textTertiary}
              keyboardType="numeric"
              value={receivables}
              onChangeText={setReceivables}
            />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              pressed && { opacity: 0.9 },
            ]}
            onPress={handleComplete}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={theme.colors.surface} />
            ) : (
              <Text style={styles.submitLabel}>{t('setup.complete')}</Text>
            )}
          </Pressable>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const getStyles = (theme: any) => StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: theme.spacing['3xl'],
  },
  logoCircle: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: theme.colors.accentTransparent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  brandName: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSizes['2xl'],
    color: theme.colors.textPrimary,
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textTertiary,
    marginTop: 4,
  },
  formCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.xl,
    ...theme.shadows.card,
  },
  formTitle: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.xl,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.lg,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: theme.radii.base,
    paddingHorizontal: theme.spacing.base,
    paddingVertical: Platform.select({ ios: 14, android: 8 }),
    marginBottom: theme.spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.base,
    color: theme.colors.textPrimary,
    marginLeft: theme.spacing.sm,
  },
  submitButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.base,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
    ...theme.shadows.button,
  },
  submitLabel: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.base,
    color: theme.colors.surface,
    letterSpacing: 0.3,
  },
});

export default SetupScreen;