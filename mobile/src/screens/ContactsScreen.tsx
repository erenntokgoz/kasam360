import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, StatusBar, TextInput, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import AddCard from '../components/AddCard';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useContactStore, ContactInfo } from '../store/useContactStore';
import { formatCurrency, formatDate } from '../utils/format';

const ContactRow: React.FC<{ item: ContactInfo; onPress: (c: ContactInfo) => void }> = ({ item, onPress }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);

  return (
    <Pressable style={[styles.rowContainer, { backgroundColor: theme.colors.surface }]} onPress={() => onPress(item)}>
      <View style={[styles.rowIconCircle, { backgroundColor: theme.colors.accentTransparent }]}>
        <Icon name="user" size={20} color={theme.colors.accent} />
      </View>
      <View style={styles.rowMiddle}>
        <Text style={[styles.rowName, { color: theme.colors.textPrimary }]}>{item.name}</Text>
        {item.lastTransactionDate && (
          <Text style={[styles.rowDate, { color: theme.colors.textTertiary }]}>Son İşlem: {formatDate(item.lastTransactionDate)}</Text>
        )}
      </View>
      <View style={styles.rowRight}>
        {item.totalBalance !== undefined && (
          <Text style={[styles.rowAmount, { color: item.totalBalance >= 0 ? theme.colors.success : theme.colors.danger }]}>
            {formatCurrency(item.totalBalance, true)}
          </Text>
        )}
        <Icon name="chevron-right" size={16} color={theme.colors.textTertiary} />
      </View>
    </Pressable>
  );
};

const ContactsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const { contacts, addContact } = useContactStore();
  const [search, setSearch] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const [newName, setNewName] = useState('');

  const filteredContacts = contacts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const handleAddContact = () => {
    if (!newName.trim()) {
      Alert.alert('Hata', 'Lütfen geçerli bir isim girin.');
      return;
    }
    addContact(newName.trim());
    setNewName('');
    setShowAddInput(false);
    Alert.alert('Başarılı', 'Kişi rehbere eklendi.');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base, borderBottomColor: theme.colors.border }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Rehber</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}>
          <Icon name="search" size={18} color={theme.colors.textTertiary} />
          <TextInput
            style={[styles.searchInput, { color: theme.colors.textPrimary }]}
            placeholder="Kişi Ara..."
            placeholderTextColor={theme.colors.textTertiary}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <FlatList
        data={filteredContacts}
        keyExtractor={(item) => item.name}
        renderItem={({ item }) => <ContactRow item={item} onPress={(c) => navigation.navigate('ContactDetail', { contactName: c.name })} />}
        ListHeaderComponent={(
          <View style={{ marginBottom: 20 }}>
            {!showAddInput ? (
              <AddCard 
                title="Yeni Kişi Ekle" 
                subtitle="Borç/Alacak kaydı için kişi ekleyin" 
                icon="user-plus" 
                onPress={() => setShowAddInput(true)} 
              />
            ) : (
              <View style={[styles.addInputContainer, { backgroundColor: theme.colors.surface, ...theme.shadows.card }]}>
                <TextInput
                  style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
                  placeholder="Kişi Adı"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                />
                <View style={styles.addActions}>
                  <Pressable style={[styles.actionBtn, { backgroundColor: theme.colors.card }]} onPress={() => setShowAddInput(false)}>
                    <Text style={{ color: theme.colors.textPrimary }}>Vazgeç</Text>
                  </Pressable>
                  <Pressable style={[styles.actionBtn, { backgroundColor: theme.colors.accent }]} onPress={handleAddContact}>
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Kaydet</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={!search ? <Text style={styles.emptyText}>Henüz kayıtlı kişi yok</Text> : <Text style={styles.emptyText}>Sonuç bulunamadı</Text>}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  searchContainer: { paddingHorizontal: 20, marginBottom: 16 },
  searchBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 48, borderRadius: 14 },
  searchInput: { flex: 1, marginLeft: 12, fontSize: 15 },
  listContent: { paddingHorizontal: 20 },
  addInputContainer: { padding: 20, borderRadius: 20 },
  input: { height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, marginBottom: 12 },
  addActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  actionBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  rowContainer: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 12 },
  rowIconCircle: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  rowMiddle: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowDate: { fontSize: 12, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowAmount: { fontSize: 14, fontWeight: '700' },
  emptyText: { textAlign: 'center', marginTop: 40, opacity: 0.5 }
});

export default ContactsScreen;
