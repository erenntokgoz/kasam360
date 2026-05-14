import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';

export default function EmployeeListScreen() {
  const { isDarkMode } = useThemeStore();
  const theme = getTheme(isDarkMode);

  // Todo: useEmployeeStore bağlanacak
  const emptyData: any[] = []; 

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primary }]}>
      <Text style={[styles.header, { color: theme.colors.text }]}>Personel Yönetimi</Text>
      
      <FlatList
        data={emptyData}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: theme.colors.textMuted }}>Kayıtlı personel bulunamadı.</Text>
          </View>
        }
        renderItem={({ item }) => <View />}
      />

      <TouchableOpacity style={[styles.fab, { backgroundColor: theme.colors.accent }]}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, marginTop: 10 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  fabText: { color: '#fff', fontSize: 32, fontWeight: 'bold', marginTop: -4 }
});
