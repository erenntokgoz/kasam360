/**
 * LoginScreen — Executive Dark Auth
 * ──────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../theme';
import { useAuthStore } from '../../store/useAuthStore';

interface Props {
  navigation: any;
}

const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { login, isLoading, error, clearError } = useAuthStore();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [secureEntry, setSecureEntry] = useState(true);

  const handleLogin = async () => {
    if (!phone.trim() || !password.trim()) { return; }
    try {
      await login({ phone: phone.trim(), password });
    } catch {
      // error is already set in store
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
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
        {/* Brand */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(500).springify()}
          style={styles.brandSection}
        >
          <View style={styles.logoCircle}>
            <Icon name="layers" size={28} color={theme.colors.successLight} />
          </View>
          <Text style={styles.brandName}>Kasam360</Text>
          <Text style={styles.brandSubtitle}>Executive Financial Ledger</Text>
        </Animated.View>

        {/* Form */}
        <Animated.View
          entering={FadeInDown.delay(250).duration(500).springify()}
          style={styles.formCard}
        >
          <Text style={styles.formTitle}>Sign In</Text>

          {/* Phone */}
          <View style={styles.inputWrapper}>
            <Icon name="phone" size={16} color={theme.colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              placeholderTextColor={theme.colors.textTertiary}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={(v) => { clearError(); setPhone(v); }}
              autoCapitalize="none"
            />
          </View>

          {/* Password */}
          <View style={styles.inputWrapper}>
            <Icon name="lock" size={16} color={theme.colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={theme.colors.textTertiary}
              secureTextEntry={secureEntry}
              value={password}
              onChangeText={(v) => { clearError(); setPassword(v); }}
              autoCapitalize="none"
            />
            <Pressable hitSlop={8} onPress={() => setSecureEntry(!secureEntry)}>
              <Icon
                name={secureEntry ? 'eye-off' : 'eye'}
                size={16}
                color={theme.colors.textTertiary}
              />
            </Pressable>
          </View>

          {/* Error */}
          {error && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          {/* Submit */}
          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              pressed && styles.submitPressed,
            ]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={theme.colors.textPrimary} />
            ) : (
              <Text style={styles.submitLabel}>Continue</Text>
            )}
          </Pressable>
        </Animated.View>

        {/* Register link */}
        <Animated.View
          entering={FadeInDown.delay(400).duration(500).springify()}
          style={styles.linkRow}
        >
          <Text style={styles.linkText}>Don't have an account? </Text>
          <Pressable onPress={() => navigation.navigate('Register')}>
            <Text style={styles.linkAction}>Register</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.primary },
  container: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.xl,
    justifyContent: 'center',
  },

  brandSection: { alignItems: 'center', marginBottom: theme.spacing['3xl'] },
  logoCircle: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(16,185,129,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  brandName: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSizes['2xl'],
    color: theme.colors.textPrimary,
    letterSpacing: 0.6,
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
    paddingVertical: Platform.select({ ios: 14, android: 4 }),
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  input: {
    flex: 1,
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.base,
    color: theme.colors.textPrimary,
    marginLeft: theme.spacing.sm,
  },

  errorText: {
    fontFamily: theme.fonts.medium,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.dangerLight,
    marginBottom: theme.spacing.md,
  },

  submitButton: {
    backgroundColor: theme.colors.success,
    borderRadius: theme.radii.base,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
  },
  submitPressed: { opacity: 0.85 },
  submitLabel: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.base,
    color: theme.colors.textPrimary,
    letterSpacing: 0.3,
  },

  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: theme.spacing.xl,
  },
  linkText: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textTertiary,
  },
  linkAction: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.successLight,
  },
});

export default LoginScreen;
