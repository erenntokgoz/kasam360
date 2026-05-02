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

const RegisterScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { register, isLoading, error, clearError } = useAuthStore();

  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [password, setPassword] = useState('');
  const [secureEntry, setSecureEntry] = useState(true);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const handleRegister = async () => {
    if (!phone.trim() || !businessName.trim() || !password.trim()) { return; }
    try {
      await register({
        phone: phone.trim(),
        businessName: businessName.trim(),
        password,
      });
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
            paddingTop: insets.top + theme.spacing.xl,
            paddingBottom: insets.bottom + theme.spacing.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(500)}
          style={styles.brandSection}
        >
          <View style={styles.logoCircle}>
            <Icon name="user-plus" size={32} color={theme.colors.accent} />
          </View>
          <Text style={styles.brandName}>KASAM360</Text>
          <Text style={styles.brandSubtitle}>Yeni Hesap Oluşturun</Text>
        </Animated.View>

        {/* Form */}
        <Animated.View
          entering={FadeInDown.delay(200).duration(500)}
          style={styles.formContainer}
        >
          <Text style={styles.welcomeText}>Aramıza Katılın</Text>
          <Text style={styles.instructionText}>İşletmenizi dijitalleştirin</Text>

          {/* Business name */}
          <View style={[
            styles.inputContainer,
            focusedField === 'business' && styles.inputFocused
          ]}>
            <Icon name="briefcase" size={18} color={focusedField === 'business' ? theme.colors.accent : theme.colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="İşletme Adı"
              placeholderTextColor={theme.colors.textTertiary}
              value={businessName}
              onFocus={() => setFocusedField('business')}
              onBlur={() => setFocusedField(null)}
              onChangeText={(v) => { clearError(); setBusinessName(v); }}
              autoCapitalize="words"
            />
          </View>

          {/* Phone */}
          <View style={[
            styles.inputContainer,
            focusedField === 'phone' && styles.inputFocused
          ]}>
            <Icon name="phone" size={18} color={focusedField === 'phone' ? theme.colors.accent : theme.colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Telefon Numaranız"
              placeholderTextColor={theme.colors.textTertiary}
              keyboardType="phone-pad"
              value={phone}
              onFocus={() => setFocusedField('phone')}
              onBlur={() => setFocusedField(null)}
              onChangeText={(v) => { clearError(); setPhone(v); }}
              autoCapitalize="none"
            />
          </View>

          {/* Password */}
          <View style={[
            styles.inputContainer,
            focusedField === 'password' && styles.inputFocused
          ]}>
            <Icon name="lock" size={18} color={focusedField === 'password' ? theme.colors.accent : theme.colors.textTertiary} />
            <TextInput
              style={styles.input}
              placeholder="Şifre Belirleyin"
              placeholderTextColor={theme.colors.textTertiary}
              secureTextEntry={secureEntry}
              value={password}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              onChangeText={(v) => { clearError(); setPassword(v); }}
              autoCapitalize="none"
            />
            <Pressable hitSlop={12} onPress={() => setSecureEntry(!secureEntry)}>
              <Icon
                name={secureEntry ? 'eye-off' : 'eye'}
                size={18}
                color={theme.colors.textTertiary}
              />
            </Pressable>
          </View>

          {/* Error */}
          {error && (
            <View style={styles.errorContainer}>
              <Icon name="alert-circle" size={16} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Submit */}
          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              { backgroundColor: theme.colors.accent },
              pressed && styles.submitPressed,
              isLoading && styles.submitDisabled,
            ]}
            onPress={handleRegister}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Text style={styles.submitLabel}>KAYIT OL</Text>
            )}
          </Pressable>

          <View style={styles.linkRow}>
            <Text style={styles.linkText}>Zaten hesabınız var mı? </Text>
            <Pressable onPress={() => navigation.navigate('Login')}>
              <Text style={styles.linkAction}>Giriş Yap</Text>
            </Pressable>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.primary },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  brandName: {
    fontFamily: theme.fonts.black,
    fontSize: 28,
    color: theme.colors.textPrimary,
    letterSpacing: 2,
  },
  brandSubtitle: {
    fontFamily: theme.fonts.light,
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  formContainer: {
    width: '100%',
  },
  welcomeText: {
    fontFamily: theme.fonts.black,
    fontSize: 24,
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  instructionText: {
    fontFamily: theme.fonts.light,
    fontSize: 16,
    color: theme.colors.textSecondary,
    marginBottom: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 16,
  },
  inputFocused: {
    borderColor: theme.colors.accent,
  },
  input: {
    flex: 1,
    fontFamily: theme.fonts.light,
    fontSize: 16,
    color: theme.colors.textPrimary,
    marginLeft: 12,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#EF4444',
  },
  errorText: {
    fontFamily: theme.fonts.light,
    fontSize: 14,
    color: '#EF4444',
    marginLeft: 8,
    flex: 1,
  },
  submitButton: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitDisabled: { opacity: 0.7 },
  submitPressed: { opacity: 0.9 },
  submitLabel: {
    fontFamily: theme.fonts.black,
    fontSize: 16,
    color: theme.colors.primary,
    letterSpacing: 1,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
  },
  linkText: {
    fontFamily: theme.fonts.light,
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  linkAction: {
    fontFamily: theme.fonts.black,
    fontSize: 14,
    color: theme.colors.accent,
  },
});


export default RegisterScreen;
