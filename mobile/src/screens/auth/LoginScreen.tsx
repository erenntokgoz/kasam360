import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../../theme';
import { useThemeStore } from '../../store/useThemeStore';
import { useAuthStore } from '../../store/useAuthStore';
import { getItem, StorageKeys } from '../../utils/storage';

interface Props { navigation: any; }

const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { login, isLoading, error, clearError } = useAuthStore();
  
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [secureEntry, setSecureEntry] = useState(true);
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    const checkSaved = async () => {
      const saved = await getItem(StorageKeys.REMEMBER_ME);
      if (saved === 'true') {
        const savedPhone = await getItem(StorageKeys.PHONE_NUMBER);
        if (savedPhone) {
          setPhone(savedPhone);
          setRememberMe(true);
        }
      }
    };
    checkSaved();
  }, []);

  const handleLogin = async () => {
    if (!phone.trim() || !password.trim()) return;
    try { 
      await login({ phone: phone.trim(), password }, rememberMe); 
    } catch { }
  };

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: theme.colors.primary }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.delay(100).duration(500).springify()} style={styles.brandSection}>
          <Image source={require('../../assets/logo-text.png')} style={styles.logo} resizeMode="contain" />
          <Text style={[styles.brandSubtitle, { color: theme.colors.textTertiary }]}>Ticaretinizi cebinizden yönetin.</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(250).duration(500).springify()} style={[styles.formCard, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
          <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Giriş Yap</Text>

          <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card }]}>
            <Icon name="phone" size={18} color={theme.colors.textTertiary} />
            <TextInput
              style={[styles.input, { color: theme.colors.textPrimary }]}
              placeholder="Telefon Numaranız"
              placeholderTextColor={theme.colors.textTertiary}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={(v) => { clearError(); setPhone(v); }}
            />
          </View>

          <View style={[styles.inputWrapper, { backgroundColor: theme.colors.card }]}>
            <Icon name="lock" size={18} color={theme.colors.textTertiary} />
            <TextInput
              style={[styles.input, { color: theme.colors.textPrimary }]}
              placeholder="Şifreniz"
              placeholderTextColor={theme.colors.textTertiary}
              secureTextEntry={secureEntry}
              value={password}
              onChangeText={(v) => { clearError(); setPassword(v); }}
            />
            <Pressable hitSlop={8} onPress={() => setSecureEntry(!secureEntry)}>
              <Icon name={secureEntry ? 'eye-off' : 'eye'} size={18} color={theme.colors.textTertiary} />
            </Pressable>
          </View>

          <Pressable style={styles.rememberRow} onPress={() => setRememberMe(!rememberMe)}>
            <View style={[styles.checkbox, { borderColor: theme.colors.border }, rememberMe && { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }]}>
              {rememberMe && <Icon name="check" size={12} color="#fff" />}
            </View>
            <Text style={[styles.rememberText, { color: theme.colors.textSecondary }]}>Beni Hatırla</Text>
          </Pressable>

          {error && <Text style={[styles.errorText, { color: theme.colors.danger }]}>{error}</Text>}

          <Pressable
            style={({ pressed }) => [styles.submitButton, { backgroundColor: theme.colors.accent, ...theme.shadows.button }, pressed && { opacity: 0.9 }]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitLabel}>Devam Et</Text>
            )}
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(400).duration(500).springify()} style={styles.linkRow}>
          <Text style={[styles.linkText, { color: theme.colors.textTertiary }]}>Hesabınız yok mu?</Text>
          <Pressable onPress={() => navigation.navigate('Register')}>
            <Text style={[styles.linkAction, { color: theme.colors.accent }]}> Kayıt Olun</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 32, justifyContent: 'center' },
  brandSection: { alignItems: 'center', marginBottom: 48 },
  logo: { width: 180, height: 50 },
  brandSubtitle: { fontSize: 13, marginTop: 8 },
  formCard: { borderRadius: 24, padding: 32 },
  formTitle: { fontSize: 24, fontWeight: '700', marginBottom: 28 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 16, height: 56, marginBottom: 16 },
  input: { flex: 1, fontSize: 15, marginLeft: 12 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rememberText: { fontSize: 14 },
  errorText: { fontSize: 13, marginBottom: 16, textAlign: 'center' },
  submitButton: { borderRadius: 12, height: 56, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: '#fff' },
  linkRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 32 },
  linkText: { fontSize: 14 },
  linkAction: { fontSize: 14, fontWeight: '700' },
});

export default LoginScreen;
