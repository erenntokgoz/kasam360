import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MainStackParamList } from '../navigation/MainStack';
import { SafeIcon } from '../components/SafeIcon';
import { useDebtStore } from '../store/useDebtStore';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';

type RouteProps = RouteProp<MainStackParamList, 'AddDebt'>;

export default function AddDebtScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProps>();
  const insets = useSafeAreaInsets();
  const addDebt = useDebtStore((s) => s.addDebt);

  const [personName, setPersonName] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);

  const isDebt = route.params.type === 'TAKEN';
  const color = isDebt ? theme.colors.dangerLight : theme.colors.successLight;
  const title = isDebt ? 'YENİ BORÇ' : 'YENİ ALACAK';

  const handleSave = async () => {
    if (!amount || !personName) {
      Alert.alert('Hata', 'Lütfen kişi adı ve tutar alanlarını doldurun.');
      return;
    }

    const amountValue = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountValue)) {
      Alert.alert('Hata', 'Geçerli bir tutar girin.');
      return;
    }

    setLoading(true);
    try {
      await addDebt({
        type: route.params.type,
        entityName: personName,
        totalAmount: Math.round(amountValue * 100), // convert to cents
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // +30 days by default
      });
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Hata', error.message || 'Kayıt eklenemedi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <View style={[styles.header, { borderColor: theme.colors.border }]}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()}>
          <SafeIcon name="close-outline" size={32} color={theme.colors.textPrimary} fallbackText="KAPAT" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color }]}>{title}</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.form}>
        <Text style={[styles.label, { color: theme.colors.textTertiary }]}>KİŞİ ADI</Text>
        <TextInput
          style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.card, color: theme.colors.textPrimary }]}
          placeholder="Örn: Ahmet, Ayşe"
          placeholderTextColor={theme.colors.textTertiary}
          value={personName}
          onChangeText={setPersonName}
        />

        <Text style={[styles.label, { color: theme.colors.textTertiary }]}>TUTAR</Text>
        <TextInput
          style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.card, color: theme.colors.textPrimary }]}
          keyboardType="numeric"
          placeholder="0.00"
          placeholderTextColor={theme.colors.textTertiary}
          value={amount}
          onChangeText={setAmount}
        />
      </View>

      <TouchableOpacity 
        style={[styles.saveButton, { backgroundColor: color }]} 
        activeOpacity={0.8}
        onPress={handleSave}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={theme.colors.surface} />
        ) : (
          <Text style={[styles.saveButtonText, { color: theme.colors.surface }]}>KAYDET</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
  form: {
    padding: 20,
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 20,
  },
  input: {
    borderWidth: 1,
    padding: 16,
    fontSize: 16,
    fontWeight: '500',
  },
  saveButton: {
    marginHorizontal: 20,
    marginBottom: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
