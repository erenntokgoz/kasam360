import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MainStackParamList } from '../navigation/MainStack';
import { SafeIcon } from '../components/SafeIcon';
import { useDebtStore } from '../store/useDebtStore';

type RouteProps = RouteProp<MainStackParamList, 'AddDebt'>;

export default function AddDebtScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProps>();
  const insets = useSafeAreaInsets();
  const addDebt = useDebtStore((s) => s.addDebt);

  const [personName, setPersonName] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const isDebt = route.params.type === 'TAKEN';
  const color = isDebt ? '#EF4444' : '#10B981';
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()}>
          <SafeIcon name="close-outline" size={32} color="#FFFFFF" fallbackText="KAPAT" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color }]}>{title}</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>KİŞİ ADI</Text>
        <TextInput
          style={styles.input}
          placeholder="Örn: Ahmet, Ayşe"
          placeholderTextColor="#8E8E93"
          value={personName}
          onChangeText={setPersonName}
        />

        <Text style={styles.label}>TUTAR</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="0.00"
          placeholderTextColor="#8E8E93"
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
          <ActivityIndicator color="#000000" />
        ) : (
          <Text style={styles.saveButtonText}>KAYDET</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
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
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    padding: 16,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  saveButton: {
    marginHorizontal: 20,
    marginBottom: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
