import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import '../../i18n'; // Initialize i18n
import { getTheme } from '../../theme';
import { useThemeStore } from '../../store/useThemeStore';
import { useAuthStore } from '../../store/useAuthStore';

interface Props { navigation: any; }

const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { login, isLoading, error, clearError } = useAuthStore();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [secureEntry, setSecureEntry] = useState(true);

  const handleLogin = async () => {
    if (!phone.trim() || !password.trim()) return;
    try { await login({ phone: phone.trim(), password }); } catch { }
  };

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: theme.colors.primary }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + theme.spacing['3xl'], paddingBottom: insets.bottom + theme.spacing['2xl'] }]} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.delay(100).duration(500).springify()} style={styles.brandSection}>
          <View style={[styles.logoCircle, { backgroundColor: theme.colors.accentTransparent }]}>
            <Icon name="layers" size={28} color={theme.colors.accent} />
          </View>
          <Image source={require('../../assets/logo-text.png')} style={{ width: 160, height: 40, resizeMode: 'contain' }} />
          <Text style={[styles.brandSubtitle, { color: theme.colors.textTertiary }]}>{t('login.subtitle')}</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(250).duration(500).springify()} style={[styles.formCard, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>{t('login.signIn')}</Text>

          <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card }]}>
            <Icon name="phone" size={16} color={theme.colors.textTertiary} />
            <TextInput
              style={[styles.input, { color: theme.colors.textPrimary }]}
              placeholder={t('login.phone')}
              placeholderTextColor={theme.colors.textTertiary}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={(v) => { clearError(); setPhone(v); }}
              autoCapitalize="none"
            />
          </View>

          <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card }]}>
            <Icon name="lock" size={16} color={theme.colors.textTertiary} />
            <TextInput
              style={[styles.input, { color: theme.colors.textPrimary }]}
              placeholder={t('login.password')}
              placeholderTextColor={theme.colors.textTertiary}
              secureTextEntry={secureEntry}
              value={password}
              onChangeText={(v) => { clearError(); setPassword(v); }}
              autoCapitalize="none"
            />
            <Pressable hitSlop={8} onPress={() => setSecureEntry(!secureEntry)}>
              <Icon name={secureEntry ? 'eye-off' : 'eye'} size={16} color={theme.colors.textTertiary} />
            </Pressable>
          </View>

          {error && <Text style={[styles.errorText, { color: theme.colors.dangerLight }]}>{error}</Text>}

          <Pressable
            style={({ pressed }) => [styles.submitButton, { backgroundColor: theme.colors.accent }, pressed && { opacity: 0.9 }]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={theme.colors.surface} />
            ) : (
              <Text style={[styles.submitLabel, { color: theme.colors.surface }]}>{t('login.continue')}</Text>
            )}
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(400).duration(500).springify()} style={styles.linkRow}>
          <Text style={[styles.linkText, { color: theme.colors.textTertiary }]}>{t('login.noAccount')}</Text>
          <Pressable onPress={() => navigation.navigate('Register')}>
            <Text style={[styles.linkAction, { color: theme.colors.accent }]}>{t('login.register')}</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 32, justifyContent: 'center' },
  brandSection: { alignItems: 'center', marginBottom: 64 },
  logoCircle: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  brandName: { fontSize: 28, letterSpacing: 0.5 },
  brandSubtitle: { fontSize: 13, marginTop: 4 },
  formCard: { borderRadius: 16, padding: 32 },
  formTitle: { fontSize: 22, marginBottom: 24 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.select({ ios: 14, android: 8 }), marginBottom: 16 },
  input: { flex: 1, fontSize: 15, marginLeft: 8 },
  errorText: { fontSize: 13, marginBottom: 16 },
  submitButton: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  submitLabel: { fontSize: 15, letterSpacing: 0.3 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 32 },
  linkText: { fontSize: 13 },
  linkAction: { fontSize: 13 },
});

export default LoginScreen;