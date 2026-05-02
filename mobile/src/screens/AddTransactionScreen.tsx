import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MainStackParamList } from '../navigation/MainStack';
import { SafeIcon } from '../components/SafeIcon';
import { useLedgerStore } from '../store/useLedgerStore';

type RouteProps = RouteProp<MainStackParamList, 'AddTransaction'>;

export default function AddTransactionScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProps>();
  const insets = useSafeAreaInsets();
  const addTransaction = useLedgerStore((s) => s.addTransaction);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const isIncome = route.params.type === 'INCOME';
  const color = isIncome ? '#10B981' : '#EF4444';
  const title = isIncome ? 'YENİ GELİR' : 'YENİ GİDER';

  const handleSave = async () => {
    if (!amount || !category) {
      Alert.alert('Hata', 'Lütfen tutar ve kategori alanlarını doldurun.');
      return;
    }

    const amountValue = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountValue)) {
      Alert.alert('Hata', 'Geçerli bir tutar girin.');
      return;
    }

    setLoading(true);
    try {
      await addTransaction({
        type: route.params.type,
        amount: Math.round(amountValue * 100), // convert to cents
        method: 'CASH', // default payment method
        category,
        description,
        transactionDate: new Date().toISOString(),
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
        <Text style={styles.label}>TUTAR</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="0.00"
          placeholderTextColor="#8E8E93"
          value={amount}
          onChangeText={setAmount}
        />

        <Text style={styles.label}>KATEGORİ</Text>
        <TextInput
          style={styles.input}
          placeholder={isIncome ? "Örn: Maaş, Prim" : "Örn: Kira, Market"}
          placeholderTextColor="#8E8E93"
          value={category}
          onChangeText={setCategory}
        />

        <Text style={styles.label}>AÇIKLAMA</Text>
        <TextInput
          style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
          placeholder="İsteğe bağlı açıklama..."
          placeholderTextColor="#8E8E93"
          multiline
          value={description}
          onChangeText={setDescription}
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
