import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getTheme } from '../../theme';
import { useThemeStore } from '../../store/useThemeStore';
import { useAuthStore } from '../../store/useAuthStore';

interface Props { navigation: any; }

const RegisterScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { register, isLoading, error, clearError } = useAuthStore();
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [password, setPassword] = useState('');
  const [secureEntry, setSecureEntry] = useState(true);

  const handleRegister = async () => {
    if (!phone.trim() || !businessName.trim() || !password.trim()) return;
    try { await register({ phone: phone.trim(), businessName: businessName.trim(), password }); } catch { }
  };

  return (
    <KeyboardAvoidingView style={[{ flex: 1 }, { backgroundColor: theme.colors.primary }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[{ flexGrow: 1, paddingHorizontal: theme.spacing.xl, justifyContent: 'center' }, { paddingTop: insets.top + theme.spacing['3xl'], paddingBottom: insets.bottom + theme.spacing['2xl'] }]} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.delay(100).duration(500).springify()} style={{ alignItems: 'center', marginBottom: theme.spacing['3xl'] }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(37, 99, 235, 0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md }}>
            <Icon name="layers" size={28} color={theme.colors.accent} />
          </View>
          <Text style={{ fontFamily: theme.fonts.bold, fontSize: theme.fontSizes['2xl'], color: theme.colors.textPrimary, letterSpacing: 0.5 }}>{t('register.title')}</Text>
          <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary, marginTop: 4 }}>{t('register.subtitle')}</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(250).duration(500).springify()} style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing.xl, ...theme.shadows.card }}>
          <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.xl, color: theme.colors.textPrimary, marginBottom: theme.spacing.lg }}>{t('register.register')}</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, paddingVertical: Platform.select({ ios: 14, android: 8 }), marginBottom: theme.spacing.md }}>
            <Icon name="briefcase" size={16} color={theme.colors.textTertiary} />
            <TextInput style={{ flex: 1, fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }} placeholder={t('register.businessName')} placeholderTextColor={theme.colors.textTertiary} value={businessName} onChangeText={(v) => { clearError(); setBusinessName(v); }} autoCapitalize="words" />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, paddingVertical: Platform.select({ ios: 14, android: 8 }), marginBottom: theme.spacing.md }}>
            <Icon name="phone" size={16} color={theme.colors.textTertiary} />
            <TextInput style={{ flex: 1, fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }} placeholder={t('register.phone')} placeholderTextColor={theme.colors.textTertiary} keyboardType="phone-pad" value={phone} onChangeText={(v) => { clearError(); setPhone(v); }} autoCapitalize="none" />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.card, borderRadius: theme.radii.base, paddingHorizontal: theme.spacing.base, paddingVertical: Platform.select({ ios: 14, android: 8 }), marginBottom: theme.spacing.md }}>
            <Icon name="lock" size={16} color={theme.colors.textTertiary} />
            <TextInput style={{ flex: 1, fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.base, color: theme.colors.textPrimary, marginLeft: theme.spacing.sm }} placeholder={t('register.password')} placeholderTextColor={theme.colors.textTertiary} secureTextEntry={secureEntry} value={password} onChangeText={(v) => { clearError(); setPassword(v); }} autoCapitalize="none" />
            <Pressable hitSlop={8} onPress={() => setSecureEntry(!secureEntry)}>
              <Icon name={secureEntry ? 'eye-off' : 'eye'} size={16} color={theme.colors.textTertiary} />
            </Pressable>
          </View>

          {error && <Text style={{ fontFamily: theme.fonts.medium, fontSize: theme.fontSizes.sm, color: theme.colors.dangerLight, marginBottom: theme.spacing.md }}>{error}</Text>}

          <Pressable style={({ pressed }) => [{ backgroundColor: theme.colors.accent, borderRadius: theme.radii.base, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.sm }, pressed && { opacity: 0.9 }]} onPress={handleRegister} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.base, color: '#FFFFFF', letterSpacing: 0.3 }}>{t('register.createAccount')}</Text>}
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(400).duration(500).springify()} style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.xl }}>
          <Text style={{ fontFamily: theme.fonts.regular, fontSize: theme.fontSizes.sm, color: theme.colors.textTertiary }}>{t('register.alreadyHaveAccount')}</Text>
          <Pressable onPress={() => navigation.navigate('Login')}>
            <Text style={{ fontFamily: theme.fonts.semiBold, fontSize: theme.fontSizes.sm, color: theme.colors.accent }}>{t('register.signIn')}</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default RegisterScreen;