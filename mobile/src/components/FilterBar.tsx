import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { getTheme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useContactStore } from '../store/useContactStore';

interface FilterBarProps {
  onDateChange: (start: Date | null, end: Date | null) => void;
  onContactChange: (contactName: string | null) => void;
  showContactFilter?: boolean;
}

const FilterBar: React.FC<FilterBarProps> = ({ onDateChange, onContactChange, showContactFilter = true }) => {
  const isDark = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDark);
  const { contacts } = useContactStore();
  
  const [selectedRange, setSelectedRange] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'>('ALL');
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);

  const ranges = [
    { id: 'ALL', label: 'Tümü' },
    { id: 'TODAY', label: 'Bugün' },
    { id: 'WEEK', label: 'Bu Hafta' },
    { id: 'MONTH', label: 'Bu Ay' },
  ];

  const handleRangeSelect = (range: any) => {
    setSelectedRange(range);
    let start: Date | null = null;
    let end: Date | null = new Date();
    
    const now = new Date();
    if (range === 'TODAY') {
      start = new Date(now.setHours(0, 0, 0, 0));
    } else if (range === 'WEEK') {
      start = new Date(now.setDate(now.getDate() - 7));
    } else if (range === 'MONTH') {
      start = new Date(now.setMonth(now.getMonth() - 1));
    } else {
      start = null;
      end = null;
    }
    
    onDateChange(start, end);
  };

  const handleContactSelect = (name: string | null) => {
    setSelectedContact(name);
    onContactChange(name);
  };

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {ranges.map((r) => (
          <Pressable
            key={r.id}
            style={[
              styles.chip,
              { backgroundColor: selectedRange === r.id ? theme.colors.accent : theme.colors.surface },
              selectedRange === r.id && theme.shadows.button
            ]}
            onPress={() => handleRangeSelect(r.id)}
          >
            <Text style={[styles.chipText, { color: selectedRange === r.id ? '#fff' : theme.colors.textSecondary }]}>
              {r.label}
            </Text>
          </Pressable>
        ))}
        
        {showContactFilter && (
          <Pressable
            style={[
              styles.chip,
              { backgroundColor: selectedContact ? theme.colors.accent : theme.colors.surface },
            ]}
            onPress={() => setShowFilterModal(true)}
          >
            <Icon name="user" size={14} color={selectedContact ? '#fff' : theme.colors.textSecondary} style={{ marginRight: 6 }} />
            <Text style={[styles.chipText, { color: selectedContact ? '#fff' : theme.colors.textSecondary }]}>
              {selectedContact || 'Kişi Filtrele'}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal visible={showFilterModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>Kişi Seç</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              <Pressable
                style={styles.contactItem}
                onPress={() => { handleContactSelect(null); setShowFilterModal(false); }}
              >
                <Text style={{ color: theme.colors.textPrimary }}>Tümü</Text>
              </Pressable>
              {contacts.map((c) => (
                <Pressable
                  key={c.name}
                  style={styles.contactItem}
                  onPress={() => { handleContactSelect(c.name); setShowFilterModal(false); }}
                >
                  <Text style={{ color: theme.colors.textPrimary }}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              style={[styles.closeBtn, { backgroundColor: theme.colors.card }]}
              onPress={() => setShowFilterModal(false)}
            >
              <Text style={{ color: theme.colors.textPrimary }}>Kapat</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  scrollContent: { paddingHorizontal: 4, gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', borderRadius: 24, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  contactItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  closeBtn: { marginTop: 16, padding: 14, borderRadius: 12, alignItems: 'center' }
});

export default FilterBar;
