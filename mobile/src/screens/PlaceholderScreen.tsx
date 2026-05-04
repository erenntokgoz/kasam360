import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ScrollView, Dimensions, TextInput, Alert, Switch, Modal, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { getTheme, theme } from '../theme';
import { useThemeStore } from '../store/useThemeStore';
import { useLedgerStore } from '../store/useLedgerStore';
import { useAuthStore } from '../store/useAuthStore';
import { Transaction } from '../api/transactionService';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../i18n';
import { useBudgetStore } from '../store/useBudgetStore';
import { exportToCSV, exportToPDF } from '../utils/exportService';
import { getAuditLogs, AuditLog } from '../api/auditLogService';

// Format Functions
const formatCurrency = (cents: number, signed: boolean = false): string => {
  const lira = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
  }).format(lira);
  
  if (signed && cents > 0) return `+${formatted}`;
  if (signed && cents < 0) return `-${formatted}`;
  return formatted;
};

const formatDate = (iso: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const AnalyticsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { transactions, isLoading, fetchTransactions, pagination, totalIncome, totalExpense, balance } = useLedgerStore();
  
  // Filter state
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [filterType, setFilterType] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // prompt: "totalTransactions çek"
  const totalTransactions = pagination?.total || 0;

  const applyFilters = () => {
    const parseDate = (d: string) => {
      if (!d) return undefined;
      const parts = d.split('/');
      if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
      return undefined;
    };
    
    fetchTransactions(1, 50, {
      type: filterType,
      startDate: parseDate(startDate),
      endDate: parseDate(endDate),
      categories: selectedCategories
    });
    setIsFilterVisible(false);
  };

  useEffect(() => {
    applyFilters();
    getAuditLogs().then(setAuditLogs).catch(console.error);
  }, []);

  const onRefresh = () => {
    applyFilters();
    getAuditLogs().then(setAuditLogs).catch(console.error);
  };

  const handleExport = () => {
    Alert.alert(
      "Dışa Aktar",
      "Verileri hangi formatta dışa aktarmak istersiniz?",
      [
        { text: "İptal", style: "cancel" },
        { text: "CSV", onPress: () => exportToCSV(transactions, `Islemler_${Date.now()}`) },
        { text: "PDF", onPress: () => exportToPDF(transactions, { totalIncome, totalExpense, balance }, `Ozet_${Date.now()}`) }
      ]
    );
  };

  const percentageChanges = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    let currInc = 0, prevInc = 0;
    let currExp = 0, prevExp = 0;
    
    transactions.forEach(t => {
      const d = new Date(t.transactionDate || t.createdAt);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        if (t.type === 'INCOME') currInc += t.amount;
        else currExp += t.amount;
      } else if (d.getMonth() === (currentMonth === 0 ? 11 : currentMonth - 1) && 
                 d.getFullYear() === (currentMonth === 0 ? currentYear - 1 : currentYear)) {
        if (t.type === 'INCOME') prevInc += t.amount;
        else prevExp += t.amount;
      }
    });
    
    const calcPerc = (curr: number, prev: number) => prev === 0 ? (curr > 0 ? 100 : 0) : ((curr - prev) / prev) * 100;
    
    return {
      income: calcPerc(currInc, prevInc),
      expense: calcPerc(currExp, prevExp)
    };
  }, [transactions]);

  const last6MonthsData = useMemo(() => {
    const data = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = d.toLocaleString('tr-TR', { month: 'short' });
      
      let inc = 0;
      let exp = 0;
      
      transactions.forEach(t => {
        const td = new Date(t.transactionDate || t.createdAt);
        if (td.getMonth() === d.getMonth() && td.getFullYear() === d.getFullYear()) {
          if (t.type === 'INCOME') inc += t.amount;
          else exp += t.amount;
        }
      });
      
      data.push({ month: monthStr, income: inc, expense: exp });
    }
    return data;
  }, [transactions]);

  const incomeData = last6MonthsData.map(d => d.income);
  const expenseData = last6MonthsData.map(d => d.expense);
  const last6Months = last6MonthsData.map(d => d.month);
  const maxDataValue = Math.max(...incomeData, ...expenseData, 1);

  const expenseTransactions = transactions.filter(t => t.type === 'EXPENSE');
  const categoryMap = expenseTransactions.reduce((acc, txn) => {
    const cat = txn.category || t('analytics.other');
    acc[cat] = (acc[cat] || 0) + txn.amount;
    return acc;
  }, {} as Record<string, number>);
  
  const categoryData = Object.entries(categoryMap)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const renderHeader = () => {
    const chartHeight = 100;
    const chartWidth = 300;
    const barWidth = 12;
    const barGap = 4;
    const groupWidth = barWidth * 2 + barGap;
    const spaceBetweenGroups = (chartWidth - (groupWidth * 6)) / 5;

    return (
      <View style={styles.headerContent}>
        {/* a) ÖZET KART */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>{t('analytics.totalBalance')}</Text>
          <Text style={styles.summaryBalance}>{formatCurrency(balance)}</Text>
          
          <View style={styles.summaryRow}>
            <View style={styles.summaryCol}>
              <View style={styles.summaryIconIncome}>
                <Icon name="arrow-down-left" size={16} color={theme.colors.successLight} />
              </View>
              <View>
                <Text style={styles.summaryLabel}>{t('analytics.income')}</Text>
                <Text style={styles.summaryIncome}>{formatCurrency(totalIncome)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <Icon name={percentageChanges.income >= 0 ? "trending-up" : "trending-down"} size={12} color={percentageChanges.income >= 0 ? theme.colors.successLight : theme.colors.dangerLight} />
                  <Text style={{ fontSize: 10, color: percentageChanges.income >= 0 ? theme.colors.successLight : theme.colors.dangerLight, marginLeft: 4 }}>
                    {Math.abs(percentageChanges.income).toFixed(1)}%
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.summaryCol}>
              <View style={styles.summaryIconExpense}>
                <Icon name="arrow-up-right" size={16} color={theme.colors.dangerLight} />
              </View>
              <View>
                <Text style={styles.summaryLabel}>{t('analytics.expense')}</Text>
                <Text style={styles.summaryExpense}>{formatCurrency(totalExpense)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <Icon name={percentageChanges.expense >= 0 ? "trending-up" : "trending-down"} size={12} color={percentageChanges.expense >= 0 ? theme.colors.dangerLight : theme.colors.successLight} />
                  <Text style={{ fontSize: 10, color: percentageChanges.expense >= 0 ? theme.colors.dangerLight : theme.colors.successLight, marginLeft: 4 }}>
                    {Math.abs(percentageChanges.expense).toFixed(1)}%
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* b) BASİT BAR CHART */}
        <View style={styles.chartCard}>
          <Text style={styles.sectionTitle}>{t('analytics.sixMonths')}</Text>
          <View style={styles.chartContainer}>
            <Svg width="100%" height={chartHeight + 20} viewBox={`0 0 ${chartWidth} ${chartHeight + 20}`}>
              {last6Months.map((month, i) => {
                const xOffset = i * (groupWidth + spaceBetweenGroups);
                const incomeHeight = Math.max((incomeData[i] / maxDataValue) * chartHeight, 4);
                const expenseHeight = Math.max((expenseData[i] / maxDataValue) * chartHeight, 4);
                
                return (
                  <React.Fragment key={month}>
                    <Rect
                      x={xOffset}
                      y={chartHeight - incomeHeight}
                      width={barWidth}
                      height={incomeHeight}
                      fill={theme.colors.successLight}
                      rx={3}
                    />
                    <Rect
                      x={xOffset + barWidth + barGap}
                      y={chartHeight - expenseHeight}
                      width={barWidth}
                      height={expenseHeight}
                      fill={theme.colors.dangerLight}
                      rx={3}
                    />
                    <SvgText
                      x={xOffset + groupWidth / 2}
                      y={chartHeight + 16}
                      fontSize="10"
                      fontFamily={theme.fonts.regular}
                      fill={theme.colors.textSecondary}
                      textAnchor="middle"
                    >
                      {month}
                    </SvgText>
                  </React.Fragment>
                );
              })}
            </Svg>
          </View>
        </View>

        {/* c) HARCAMA DAĞILIMI */}
        <View style={styles.distributionCard}>
          <Text style={styles.sectionTitle}>{t('analytics.distribution')}</Text>
          {categoryData.length > 0 ? (
            categoryData.map((cat, index) => {
              const percentageNum = totalExpense > 0 ? (cat.amount / totalExpense) * 100 : 0;
              const percentageStr = percentageNum.toFixed(1);
              return (
                <View key={index} style={styles.categoryRow}>
                  <View style={styles.categoryIconContainer}>
                    <Icon name="pie-chart" size={16} color={theme.colors.accent} />
                  </View>
                  <View style={styles.categoryInfo}>
                    <Text style={styles.categoryName}>{cat.name}</Text>
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${percentageNum}%` as any }]} />
                    </View>
                  </View>
                  <View style={styles.categoryValues}>
                    <Text style={styles.categoryAmount}>{formatCurrency(cat.amount)}</Text>
                    <Text style={styles.categoryPercentage}>%{percentageStr}</Text>
                  </View>
                </View>
              );
            })
          ) : (
            <Text style={styles.emptySubtitle}>{t('analytics.noData')}</Text>
          )}
        </View>
        
        <Text style={[styles.sectionTitle, { marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }]}>
          {t('analytics.recent')}
        </Text>
      </View>
    );
  };

  const combinedData = useMemo(() => {
    const list: any[] = [];
    transactions.forEach(t => list.push({ ...t, itemType: 'TRANSACTION' }));
    auditLogs.forEach(a => list.push({ ...a, itemType: 'AUDITLOG' }));
    
    list.sort((a, b) => {
      const dateA = new Date(a.transactionDate || a.createdAt).getTime();
      const dateB = new Date(b.transactionDate || b.createdAt).getTime();
      return dateB - dateA;
    });
    
    return list;
  }, [transactions, auditLogs]);

  const renderItem = ({ item }: { item: any }) => {
    if (item.itemType === 'AUDITLOG') {
      const isDelete = item.action === 'DELETE';
      return (
        <View style={styles.row}>
          <View style={[styles.iconContainer, { backgroundColor: theme.colors.card }]}>
            <Icon 
              name={isDelete ? 'trash-2' : 'edit-2'} 
              size={20} 
              color={theme.colors.textSecondary} 
            />
          </View>
          <View style={styles.rowCenter}>
            <Text style={styles.categoryText} numberOfLines={1}>
              Sistem Kaydı: {item.entityType === 'TRANSACTION' ? 'İşlem' : 'Borç'} {isDelete ? 'Silindi' : 'Güncellendi'}
            </Text>
            <Text style={styles.dateText}>
              {formatDate(item.createdAt)}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.amountText, { color: theme.colors.textSecondary, fontSize: 12 }]}>
              {isDelete ? 'Silinme' : 'Düzenleme'}
            </Text>
          </View>
        </View>
      );
    }

    const isIncome = item.type === 'INCOME';
    // If expense, pass negative amount for signed formatting
    const amountStr = formatCurrency(isIncome ? item.amount : -item.amount, true);
    
    return (
      <View style={styles.row}>
        {/* Left: İşlem tipi ikonu */}
        <View style={styles.iconContainer}>
          <Icon 
            name={isIncome ? 'arrow-down-left' : 'arrow-up-right'} 
            size={20} 
            color={isIncome ? theme.colors.successLight : theme.colors.dangerLight} 
          />
        </View>
        
        {/* Orta: category/description + tarih/saat */}
        <View style={styles.rowCenter}>
          <Text style={styles.categoryText} numberOfLines={1}>
            {item.category || item.description || t('analytics.transaction')}
          </Text>
          <Text style={styles.dateText}>
            {formatDate(item.transactionDate || item.createdAt)}
          </Text>
        </View>
        
        {/* Sağ: tutar */}
        <View style={styles.rowRight}>
          <Text 
            style={[
              styles.amountText, 
              { color: isIncome ? theme.colors.successLight : theme.colors.dangerLight }
            ]}
          >
            {amountStr}
          </Text>
          <Text style={styles.balanceAfterText}>
            Bakiye: {formatCurrency((item as any).balanceAfter || 0)}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>{t('analytics.noRecordsTitle')}</Text>
      <Text style={styles.emptySubtitle}>{t('analytics.noRecordsSub')}</Text>
    </View>
  );

  const renderFooter = () => {
    if (transactions.length === 0) return null;
    return (
      <View style={styles.footerContainer}>
        <Text style={styles.footerText}>{t('analytics.totalRecords').replace('{{count}}', String(totalTransactions))}</Text>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable
          hitSlop={12}
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>{t('analytics.title')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable hitSlop={12} onPress={handleExport} style={{ marginRight: 16 }}>
            <Icon name="download" size={22} color={theme.colors.textPrimary} />
          </Pressable>
          <Pressable hitSlop={12} onPress={() => setIsFilterVisible(true)}>
            <Icon name="filter" size={22} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={combinedData}
        keyExtractor={(item) => item._id + item.itemType}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: 100 }]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={renderEmpty}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl 
            refreshing={isLoading} 
            onRefresh={onRefresh} 
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
      />

      {/* Filter Modal */}
      <Modal visible={isFilterVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>Filtrele</Text>
              <Pressable hitSlop={12} onPress={() => setIsFilterVisible(false)}>
                <Icon name="x" size={24} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.filterScroll}>
              {/* Date Range */}
              <Text style={[styles.filterLabel, { color: theme.colors.textPrimary }]}>Tarih Aralığı</Text>
              <View style={styles.dateRow}>
                <TextInput
                  style={[styles.dateInput, { backgroundColor: theme.colors.primary, color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
                  placeholder="Başlangıç (GG/AA/YYYY)"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={startDate}
                  onChangeText={setStartDate}
                  maxLength={10}
                />
                <Text style={{ color: theme.colors.textSecondary }}> - </Text>
                <TextInput
                  style={[styles.dateInput, { backgroundColor: theme.colors.primary, color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
                  placeholder="Bitiş (GG/AA/YYYY)"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={endDate}
                  onChangeText={setEndDate}
                  maxLength={10}
                />
              </View>

              {/* Type */}
              <Text style={[styles.filterLabel, { color: theme.colors.textPrimary }]}>İşlem Tipi</Text>
              <View style={styles.typeGroup}>
                {(['ALL', 'INCOME', 'EXPENSE'] as const).map(type => (
                  <Pressable
                    key={type}
                    style={[
                      styles.typeButton,
                      { borderColor: theme.colors.border },
                      filterType === type && { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }
                    ]}
                    onPress={() => setFilterType(type)}
                  >
                    <Text style={[
                      styles.typeButtonText,
                      { color: theme.colors.textSecondary },
                      filterType === type && { color: '#fff' }
                    ]}>
                      {type === 'ALL' ? 'Tümü' : type === 'INCOME' ? 'Gelir' : 'Gider'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Categories */}
              <Text style={[styles.filterLabel, { color: theme.colors.textPrimary }]}>Kategoriler</Text>
              <View style={styles.chipsContainer}>
                {['Maaş', 'Yemek', 'Ulaşım', 'Market', 'Fatura', 'Diğer'].map(cat => {
                  const isSelected = selectedCategories.includes(cat);
                  return (
                    <Pressable
                      key={cat}
                      style={[
                        styles.chip,
                        { backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.1)' : theme.colors.primary, borderColor: isSelected ? theme.colors.accent : theme.colors.border }
                      ]}
                      onPress={() => {
                        setSelectedCategories(prev => 
                          prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
                        );
                      }}
                    >
                      <Text style={[
                        styles.chipText,
                        { color: isSelected ? theme.colors.accent : theme.colors.textSecondary }
                      ]}>{cat}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <TouchableOpacity style={[styles.applyButton, { backgroundColor: theme.colors.accent }]} onPress={applyFilters}>
              <Text style={styles.applyButtonText}>Uygula</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuthStore();
  const { monthlyLimit, warningThreshold, setMonthlyLimit, setWarningThreshold } = useBudgetStore();
  const { isDarkMode, toggleTheme } = useThemeStore();
  const theme = getTheme(isDarkMode);
  const [tempLimit, setTempLimit] = React.useState(monthlyLimit > 0 ? monthlyLimit.toString() : '');

  const handleLimitSave = () => {
    const val = parseInt(tempLimit, 10);
    if (!isNaN(val) && val >= 0) setMonthlyLimit(val);
    else if (tempLimit === '') setMonthlyLimit(0);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base }]}>
        <Pressable
          hitSlop={12}
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Icon name="menu" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>{t('settings.title')}</Text>
        <View style={{ width: 22 }} />
      </View>
      
      <ScrollView contentContainerStyle={styles.settingsContent}>
        <View style={[styles.settingsCard, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.settingsRow}>
            <View style={[styles.settingsIconContainer, { backgroundColor: 'rgba(37, 99, 235, 0.1)' }]}>
              <Icon name="briefcase" size={20} color={theme.colors.accent} />
            </View>
            <View style={styles.settingsInfo}>
              <Text style={[styles.settingsLabel, { color: theme.colors.textSecondary }]}>{t('settings.businessName')}</Text>
              <Text style={[styles.settingsValue, { color: theme.colors.textPrimary }]}>{user?.businessName || t('settings.notSpecified')}</Text>
            </View>
          </View>
          
          <View style={styles.settingsRow}>
            <View style={[styles.settingsIconContainer, { backgroundColor: 'rgba(37, 99, 235, 0.1)' }]}>
              <Icon name="phone" size={20} color={theme.colors.accent} />
            </View>
            <View style={styles.settingsInfo}>
              <Text style={[styles.settingsLabel, { color: theme.colors.textSecondary }]}>{t('settings.phone')}</Text>
              <Text style={[styles.settingsValue, { color: theme.colors.textPrimary }]}>{user?.phone || t('settings.notSpecified')}</Text>
            </View>
          </View>
          
          <View style={styles.settingsRow}>
            <View style={[styles.settingsIconContainer, { backgroundColor: 'rgba(37, 99, 235, 0.1)' }]}>
              <Icon name="star" size={20} color={theme.colors.accent} />
            </View>
            <View style={styles.settingsInfo}>
              <Text style={[styles.settingsLabel, { color: theme.colors.textSecondary }]}>{t('settings.subscription')}</Text>
              <Text style={[styles.settingsValue, { color: theme.colors.textPrimary }]}>{user?.subscriptionStatus || 'FREE'}</Text>
            </View>
          </View>

          {/* Karanlık Mod Toggle */}
          <View style={styles.settingsRow}>
            <View style={[styles.settingsIconContainer, { backgroundColor: 'rgba(37, 99, 235, 0.1)' }]}>
              <Icon name={isDarkMode ? 'moon' : 'sun'} size={20} color={theme.colors.accent} />
            </View>
            <View style={styles.settingsInfo}>
              <Text style={[styles.settingsLabel, { color: theme.colors.textSecondary }]}>Karanlık Mod</Text>
              <Text style={[styles.settingsValue, { color: theme.colors.textPrimary }]}>{isDarkMode ? 'Açık' : 'Kapalı'}</Text>
            </View>
            <Switch
              value={isDarkMode}
              onValueChange={toggleTheme}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.settingsRow}>
            <View style={[styles.settingsIconContainer, { backgroundColor: 'rgba(37, 99, 235, 0.1)' }]}>
              <Icon name="globe" size={20} color={theme.colors.accent} />
            </View>
            <View style={styles.settingsInfo}>
              <Text style={[styles.settingsLabel, { color: theme.colors.textSecondary }]}>{t('settings.language')}</Text>
              <View style={styles.langActions}>
                <Pressable
                  style={[styles.langBtn, { borderColor: theme.colors.border }, i18n.language === 'tr' && { backgroundColor: 'rgba(37, 99, 235, 0.1)', borderColor: theme.colors.accent }]}
                  onPress={() => changeLanguage('tr')}
                >
                  <Text style={[styles.langBtnText, { color: theme.colors.textSecondary }, i18n.language === 'tr' && { color: theme.colors.accent }]}>{t('settings.langTr')}</Text>
                </Pressable>
                <Pressable
                  style={[styles.langBtn, { borderColor: theme.colors.border }, i18n.language === 'en' && { backgroundColor: 'rgba(37, 99, 235, 0.1)', borderColor: theme.colors.accent }]}
                  onPress={() => changeLanguage('en')}
                >
                  <Text style={[styles.langBtnText, { color: theme.colors.textSecondary }, i18n.language === 'en' && { color: theme.colors.accent }]}>{t('settings.langEn')}</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <Pressable style={styles.settingsRow} onPress={() => navigation.navigate('Notifications' as never)}>
            <View style={[styles.settingsIconContainer, { backgroundColor: 'rgba(37, 99, 235, 0.1)' }]}>
              <Icon name="bell" size={20} color={theme.colors.accent} />
            </View>
            <View style={[styles.settingsInfo, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={[styles.settingsValue, { color: theme.colors.textPrimary }]}>Bildirimler</Text>
              <Icon name="chevron-right" size={20} color={theme.colors.textSecondary} />
            </View>
          </Pressable>

          <View style={styles.goldSeparator} />

          <Text style={[styles.settingsLabel, { marginBottom: 12, color: theme.colors.textPrimary }]}>Bütçe Hedefi</Text>
          
          <View style={{ marginBottom: theme.spacing.lg }}>
            <Text style={[styles.settingsLabel, { color: theme.colors.textSecondary }]}>Aylık Limit (TL)</Text>
            <TextInput
              style={{ backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : theme.colors.card, color: theme.colors.textPrimary, padding: 12, borderRadius: theme.radii.base, marginTop: 8 }}
              value={tempLimit}
              onChangeText={setTempLimit}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.colors.textTertiary}
              onBlur={handleLimitSave}
              onSubmitEditing={handleLimitSave}
            />
          </View>

          <View style={{ marginBottom: theme.spacing.lg }}>
            <Text style={[styles.settingsLabel, { color: theme.colors.textSecondary }]}>Uyarı Eşiği</Text>
            <View style={styles.langActions}>
              {[70, 80, 90].map(val => (
                <Pressable
                  key={val}
                  style={[styles.langBtn, { borderColor: theme.colors.border }, warningThreshold === val && { backgroundColor: 'rgba(37, 99, 235, 0.1)', borderColor: theme.colors.accent }]}
                  onPress={() => setWarningThreshold(val)}
                >
                  <Text style={[styles.langBtnText, { color: theme.colors.textSecondary }, warningThreshold === val && { color: theme.colors.accent }]}>%{val}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.goldSeparator} />

          <Pressable 
            style={({ pressed }) => [
              styles.logoutButton,
              pressed && { opacity: 0.8 }
            ]}
            onPress={logout}
          >
            <Icon name="log-out" size={20} color={theme.colors.dangerLight} />
            <Text style={[styles.logoutText, { color: theme.colors.dangerLight }]}>{t('settings.logout')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontFamily: 'System',
    fontSize: 18,
    letterSpacing: 0.4,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.base,
  },
  headerContent: {
    paddingBottom: theme.spacing.lg,
  },
  summaryCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.base,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  summaryTitle: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  summaryBalance: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSizes.xl * 1.2,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  summaryIconIncome: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.sm,
  },
  summaryIconExpense: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.sm,
  },
  summaryLabel: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.xs,
    color: theme.colors.textSecondary,
  },
  summaryIncome: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.successLight,
  },
  summaryExpense: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.dangerLight,
  },
  chartCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.base,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.base,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.md,
  },
  chartContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: theme.spacing.sm,
  },
  distributionCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.base,
    padding: theme.spacing.lg,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  categoryIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  categoryInfo: {
    flex: 1,
    marginRight: theme.spacing.md,
  },
  categoryName: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textPrimary,
    marginBottom: 6,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: theme.colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: theme.colors.accent,
    borderRadius: 3,
  },
  categoryValues: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  categoryAmount: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textPrimary,
    marginBottom: 2,
  },
  categoryPercentage: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.xs,
    color: theme.colors.textTertiary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.base,
    padding: theme.spacing.lg,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 8,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  rowCenter: {
    flex: 1,
    justifyContent: 'center',
  },
  categoryText: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.base,
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  dateText: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.xs,
    color: theme.colors.textTertiary,
  },
  rowRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: theme.spacing.sm,
  },
  amountText: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSizes.base,
  },
  balanceAfterText: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.xs,
    color: theme.colors.textTertiary,
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.lg,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  emptySubtitle: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  footerContainer: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
  },
  footerText: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textTertiary,
  },
  settingsContent: {
    padding: theme.spacing.lg,
  },
  settingsCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.base,
    padding: theme.spacing.lg,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  settingsIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(37, 99, 235, 0.1)', // accent color with opacity
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  settingsInfo: {
    flex: 1,
  },
  settingsLabel: {
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textSecondary,
    marginBottom: 2,
  },
  settingsValue: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.base,
    color: theme.colors.textPrimary,
  },
  goldSeparator: {
    height: 1,
    backgroundColor: '#FCD34D', // Gold color for accent separator
    marginVertical: theme.spacing.md,
    opacity: 0.5,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)', // dangerLight with opacity
    padding: theme.spacing.lg,
    borderRadius: theme.radii.base,
    marginTop: theme.spacing.sm,
  },
  logoutText: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.base,
    color: theme.colors.dangerLight,
    marginLeft: theme.spacing.sm,
  },
  langActions: {
    flexDirection: 'row',
    marginTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  langBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.radii.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  langBtnActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    borderColor: theme.colors.accent,
  },
  langBtnText: {
    fontFamily: theme.fonts.medium,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textSecondary,
  },
  langBtnTextActive: {
    color: theme.colors.accent,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    padding: theme.spacing.lg,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  modalTitle: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSizes.lg,
  },
  filterScroll: {
    paddingBottom: theme.spacing.xl,
  },
  filterLabel: {
    fontFamily: theme.fonts.semiBold,
    fontSize: theme.fontSizes.sm,
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: theme.radii.base,
    padding: theme.spacing.sm,
    fontFamily: theme.fonts.regular,
    fontSize: theme.fontSizes.sm,
  },
  typeGroup: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  typeButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: theme.radii.base,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  typeButtonText: {
    fontFamily: theme.fonts.medium,
    fontSize: theme.fontSizes.sm,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipText: {
    fontFamily: theme.fonts.medium,
    fontSize: theme.fontSizes.sm,
  },
  applyButton: {
    borderRadius: theme.radii.base,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    marginTop: theme.spacing.lg,
  },
  applyButtonText: {
    fontFamily: theme.fonts.bold,
    fontSize: theme.fontSizes.base,
    color: '#FFF',
  },
});
