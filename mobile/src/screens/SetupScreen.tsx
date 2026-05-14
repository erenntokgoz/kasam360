import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable,
  KeyboardAvoidingView, Platform, ScrollView, Image, ActivityIndicator, Alert
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens, darkColors } from '../theme/tokens';
import { useSetupStore } from '../store/useSetupStore';
import { useToastStore } from '../store/useToastStore';
import { useHaptics } from '../hooks/useHaptics';

const SetupScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const styles = getStyles();
  const { setOpeningData, setSetupComplete } = useSetupStore();
  const { showToast } = useToastStore();
  const { trigger } = useHaptics();

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
      trigger('success');
      showToast('Kurulum başarıyla tamamlandı!', 'success');
    } catch (err: any) {
      trigger('error');
      const message = err?.response?.data?.message || err?.message || 'Kurulum kaydedilemedi.';
      Alert.alert('Hata', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: darkColors.primary }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: insets.top + tokens.spacing['3xl'],
            paddingBottom: insets.bottom + tokens.spacing['2xl'],
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          entering={FadeInDown.delay(100).duration(500).springify()}
          style={styles.brandSection}
        >
          <View style={styles.logoCircle}>
            <Icon name="settings" size={28} color={darkColors.accent} />
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
            <Icon name="dollar-sign" size={16} color={darkColors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder={t('setup.balance')}
              placeholderTextColor={darkColors.textTertiary}
              keyboardType="numeric"
              value={balance}
              onChangeText={setBalance}
            />
          </View>

          <View style={styles.inputWrapper}>
            <Icon name="trending-down" size={16} color={darkColors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder={t('setup.debts')}
              placeholderTextColor={darkColors.textTertiary}
              keyboardType="numeric"
              value={debts}
              onChangeText={setDebts}
            />
          </View>

          <View style={styles.inputWrapper}>
            <Icon name="trending-up" size={16} color={darkColors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder={t('setup.receivables')}
              placeholderTextColor={darkColors.textTertiary}
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
              <ActivityIndicator color={darkColors.surface} />
            ) : (
              <Text style={styles.submitLabel}>{t('setup.complete')}</Text>
            )}
          </Pressable>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const getStyles = () => StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: tokens.spacing['3xl'],
  },
  logoCircle: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: darkColors.accentTransparent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.spacing.md,
  },
  brandName: {
    fontFamily: tokens.fonts.bold,
    fontSize: tokens.fontSizes['2xl'],
    color: darkColors.textPrimary,
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontFamily: tokens.fonts.regular,
    fontSize: tokens.fontSizes.sm,
    color: darkColors.textTertiary,
    marginTop: 4,
  },
  formCard: {
    backgroundColor: darkColors.surface,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 10,
  },
  formTitle: {
    fontFamily: tokens.fonts.semiBold,
    fontSize: tokens.fontSizes.xl,
    color: darkColors.textPrimary,
    marginBottom: tokens.spacing.lg,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: darkColors.card,
    borderRadius: tokens.radii.base,
    paddingHorizontal: tokens.spacing.base,
    paddingVertical: Platform.select({ ios: 14, android: 8 }),
    marginBottom: tokens.spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: tokens.fonts.regular,
    fontSize: tokens.fontSizes.base,
    color: darkColors.textPrimary,
    marginLeft: tokens.spacing.sm,
  },
  submitButton: {
    backgroundColor: darkColors.accent,
    borderRadius: tokens.radii.base,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: tokens.spacing.sm,
    shadowColor: darkColors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  submitLabel: {
    fontFamily: tokens.fonts.semiBold,
    fontSize: tokens.fontSizes.base,
    color: darkColors.surface,
    letterSpacing: 0.3,
  },
});

export default SetupScreen;
