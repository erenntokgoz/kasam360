import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native'; // Varsayılan navigasyon
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'; // Varsayılan icon kütüphanesi
import api from '../api/client'; // Varsayılan axios instance

// Çıktı formatı tipleri
type SearchResult = {
  id: string;
  type: 'TRANSACTION' | 'DEBT' | 'DIRECTORY' | 'PERSONNEL';
  title: string;
  subtitle: string;
  amount?: number;
  date?: string;
};

const GlobalSearchScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Debounce mekanizması için
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (query.trim().length > 2) {
        performSearch(query);
      } else {
        setResults([]);
      }
    }, 500); // 500ms bekle

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const performSearch = async (searchTerm: string) => {
    setIsLoading(true);
    try {
      // Backend'de global search endpoint'i olduğunu varsayıyoruz
      // Örnek Endpoint: GET /api/search?q=searchTerm
      const response = await api.get(`/search?q=${encodeURIComponent(searchTerm)}`);
      
      // Backend'den normalize edilmiş bir SearchResult dizisi dönmesini bekliyoruz
      if (response.data && response.data.results) {
        setResults(response.data.results);
      }
    } catch (error) {
      console.error('[GlobalSearchScreen] Search error:', error);
      // Hata durumunda boş liste veya hata state'i gösterilebilir
    } finally {
      setIsLoading(false);
    }
  };

  const getIconForType = (type: string) => {
    switch (type) {
      case 'TRANSACTION': return 'swap-horizontal';
      case 'DEBT': return 'credit-card-outline';
      case 'DIRECTORY': return 'folder-account-outline';
      case 'PERSONNEL': return 'account-tie';
      default: return 'magnify';
    }
  };

  const getColorForType = (type: string) => {
    switch (type) {
      case 'TRANSACTION': return '#3498db';
      case 'DEBT': return '#e74c3c';
      case 'DIRECTORY': return '#f39c12';
      case 'PERSONNEL': return '#9b59b6';
      default: return '#7f8c8d';
    }
  };

  const handleResultPress = (item: SearchResult) => {
    // Tipe göre ilgili detaya git
    switch (item.type) {
      case 'TRANSACTION':
        navigation.navigate('TransactionDetail', { id: item.id });
        break;
      case 'DEBT':
        navigation.navigate('DebtDetail', { id: item.id });
        break;
      case 'DIRECTORY':
        navigation.navigate('DirectoryDetail', { id: item.id });
        break;
      case 'PERSONNEL':
        navigation.navigate('PersonnelDetail', { id: item.id });
        break;
      default:
        break;
    }
  };

  const renderItem = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity style={styles.resultItem} onPress={() => handleResultPress(item)}>
      <View style={[styles.iconContainer, { backgroundColor: getColorForType(item.type) + '20' }]}>
        <Icon name={getIconForType(item.type)} size={24} color={getColorForType(item.type)} />
      </View>
      <View style={styles.resultDetails}>
        <Text style={styles.resultTitle}>{item.title}</Text>
        <Text style={styles.resultSubtitle}>{item.subtitle}</Text>
      </View>
      {item.amount !== undefined && (
        <View style={styles.amountContainer}>
          <Text style={styles.amountText}>{item.amount} ₺</Text>
          {item.date && <Text style={styles.dateText}>{item.date}</Text>}
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={24} color="#333" />
        </TouchableOpacity>
        <TextInput
          style={styles.searchInput}
          placeholder="İşlem, kişi, rehber veya borç ara..."
          value={query}
          onChangeText={setQuery}
          autoFocus
          clearButtonMode="while-editing"
        />
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3498db" />
          <Text style={styles.loadingText}>Aranıyor...</Text>
        </View>
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(item) => `${item.type}-${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      ) : query.length > 2 ? (
        <View style={styles.centerContainer}>
          <Icon name="file-search-outline" size={64} color="#bdc3c7" />
          <Text style={styles.emptyText}>Sonuç bulunamadı</Text>
        </View>
      ) : (
        <View style={styles.centerContainer}>
          <Icon name="magnify" size={64} color="#ecf0f1" />
          <Text style={styles.startText}>Aramaya başlamak için yazın</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    elevation: 2,
  },
  backButton: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#f1f3f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#333',
  },
  listContent: {
    padding: 16,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  resultDetails: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  resultSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  dateText: {
    fontSize: 12,
    color: '#95a5a6',
    marginTop: 4,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#7f8c8d',
  },
  emptyText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#7f8c8d',
  },
  startText: {
    marginTop: 16,
    fontSize: 16,
    color: '#bdc3c7',
  },
});

export default GlobalSearchScreen;
