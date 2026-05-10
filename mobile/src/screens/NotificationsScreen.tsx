import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useThemeStore } from '../store/useThemeStore';
import { getTheme } from '../theme';
import { useNotificationStore, AppNotification } from '../store/useNotificationStore';

import { formatDate } from '../utils/format';

export const NotificationsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const theme = getTheme(isDarkMode);
  const { notifications, markAsRead, markAllAsRead, clearAll } = useNotificationStore();

  const getIconData = (type: string) => {
    switch(type) {
      case 'BUDGET': return { name: 'pie-chart', color: theme.colors.accent };
      case 'DEBT': return { name: 'alert-circle', color: theme.colors.dangerLight };
      case 'RECURRING': return { name: 'refresh-cw', color: theme.colors.accent };
      default: return { name: 'info', color: theme.colors.successLight };
    }
  };

  const renderItem = ({ item }: { item: AppNotification }) => {
    const iconData = getIconData(item.type);
    
    return (
      <Pressable 
        style={[styles.notificationCard, { backgroundColor: theme.colors.surface }]}
        onPress={() => !item.isRead && markAsRead(item.id)}
      >
        <View style={styles.cardLeft}>
          <View style={[styles.iconContainer, { backgroundColor: `${iconData.color}15` }]}>
            <Icon name={iconData.name} size={20} color={iconData.color} />
          </View>
        </View>
        
        <View style={styles.cardCenter}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: theme.colors.textPrimary, fontFamily: theme.fonts.semiBold }]} numberOfLines={1}>
              {item.title}
            </Text>
            {!item.isRead && (
              <View style={[styles.unreadDot, { backgroundColor: theme.colors.successLight }]} />
            )}
          </View>
          <Text style={[styles.body, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]} numberOfLines={2}>
            {item.body}
          </Text>
          <Text style={[styles.date, { color: theme.colors.textTertiary, fontFamily: theme.fonts.regular }]}>
            {formatDate(item.createdAt)}
          </Text>
        </View>
      </Pressable>
    );
  };

  const renderHeader = () => {
    if (notifications.length === 0) return null;
    const hasUnread = notifications.some(n => !n.isRead);
    return (
      <View style={styles.listHeader}>
          {hasUnread ? (
            <Pressable onPress={markAllAsRead} style={[styles.markAllBtn, { backgroundColor: theme.colors.accentTransparent }]}>
              <Icon name="check" size={16} color={theme.colors.accent} />
              <Text style={[styles.markAllText, { color: theme.colors.accent, fontFamily: theme.fonts.medium }]}>Tümünü Oku</Text>
            </Pressable>
          ) : <View />}
         <Pressable onPress={clearAll} style={styles.clearBtn}>
           <Text style={[styles.clearText, { color: theme.colors.dangerLight, fontFamily: theme.fonts.medium }]}>Temizle</Text>
         </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: theme.colors.primary }]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.base, borderBottomColor: theme.colors.border }]}>
        <Pressable hitSlop={12} onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
          <Icon name="menu" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Bildirimler</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={[styles.listContent, notifications.length === 0 && styles.emptyContent]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="bell-off" size={48} color={theme.colors.textTertiary} style={{ marginBottom: 16 }} />
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary, fontFamily: theme.fonts.semiBold }]}>Henüz bildirim yok</Text>
            <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]}>Yeni bildirimler burada görünecek.</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  markAllBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  markAllText: { fontSize: 13, marginLeft: 6 },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  clearText: { fontSize: 13 },
  listContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40 },
  emptyContent: { flex: 1 },
  notificationCard: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardLeft: { marginRight: 16, justifyContent: 'flex-start' },
  iconContainer: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardCenter: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: 15 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  body: { fontSize: 13, marginBottom: 8, lineHeight: 18 },
  date: { fontSize: 11 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center' },
});

export default NotificationsScreen;
