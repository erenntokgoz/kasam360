import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';

const NOTIFICATIONS_KEY = 'app.notifications';

export type NotificationType = 'BUDGET' | 'DEBT' | 'RECURRING' | 'INFO';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  isRead: boolean;
  createdAt: string;
}

interface NotificationState {
  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, 'id' | 'isRead' | 'createdAt'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  hydrateNotifications: () => Promise<void>;
  getUnreadCount: () => number;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  hydrateNotifications: async () => {
    try {
      const stored = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
      if (stored) {
        set({ notifications: JSON.parse(stored) });
      }
    } catch {
      set({ notifications: [] });
    }
  },

  addNotification: (notification) => {
    set((state) => {
      const newNotif: AppNotification = {
        ...notification,
        id: Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
        isRead: false,
        createdAt: new Date().toISOString(),
      };

      const isDuplicate = state.notifications.some(
        n =>
          n.title === newNotif.title &&
          n.body === newNotif.body &&
          new Date(newNotif.createdAt).getTime() - new Date(n.createdAt).getTime() < 86400000,
      );

      if (isDuplicate) return state;

      const updated = [newNotif, ...state.notifications];
      AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated)).catch(console.error);
      return { notifications: updated };
    });
  },

  markAsRead: (id) => {
    set((state) => {
      const updated = state.notifications.map(n => (n.id === id ? { ...n, isRead: true } : n));
      AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated)).catch(console.error);
      return { notifications: updated };
    });
  },

  markAllAsRead: () => {
    set((state) => {
      const updated = state.notifications.map(n => ({ ...n, isRead: true }));
      AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated)).catch(console.error);
      return { notifications: updated };
    });
  },

  clearAll: async () => {
    await AsyncStorage.removeItem(NOTIFICATIONS_KEY);
    set({ notifications: [] });
  },

  getUnreadCount: () => get().notifications.filter(n => !n.isRead).length,
}));
