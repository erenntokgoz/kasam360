import { create } from 'zustand';
import { storage } from '../utils/storage';
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
  hydrateNotifications: () => void;
  getUnreadCount: () => number;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  hydrateNotifications: () => {
    const stored = storage.getString(NOTIFICATIONS_KEY);
    if (stored) {
      try {
        set({ notifications: JSON.parse(stored) });
      } catch (e) {
        set({ notifications: [] });
      }
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
      
      // Avoid duplicate notifications with same title and body in last 24 hours
      const isDuplicate = state.notifications.some(
        n => n.title === newNotif.title && 
             n.body === newNotif.body && 
             (new Date(newNotif.createdAt).getTime() - new Date(n.createdAt).getTime() < 86400000)
      );
      
      if (isDuplicate) return state;

      const newNotifications = [newNotif, ...state.notifications];
      storage.set(NOTIFICATIONS_KEY, JSON.stringify(newNotifications));
      return { notifications: newNotifications };
    });
  },

  markAsRead: (id) => {
    set((state) => {
      const newNotifications = state.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n
      );
      storage.set(NOTIFICATIONS_KEY, JSON.stringify(newNotifications));
      return { notifications: newNotifications };
    });
  },

  markAllAsRead: () => {
    set((state) => {
      const newNotifications = state.notifications.map((n) => ({ ...n, isRead: true }));
      storage.set(NOTIFICATIONS_KEY, JSON.stringify(newNotifications));
      return { notifications: newNotifications };
    });
  },

  clearAll: () => {
    storage.remove(NOTIFICATIONS_KEY);
    set({ notifications: [] });
  },

  getUnreadCount: () => {
    return get().notifications.filter((n) => !n.isRead).length;
  },
}));
