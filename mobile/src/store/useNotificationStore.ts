import { create } from 'zustand';
import { getItem, setItem, removeItem, StorageKeys } from '../utils/storage';

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
  addNotification: (notification: Omit<AppNotification, 'id' | 'isRead' | 'createdAt'>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  hydrateNotifications: () => Promise<void>;
  getUnreadCount: () => number;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  hydrateNotifications: async () => {
    try {
      const stored = await getItem(StorageKeys.NOTIFICATIONS);
      if (stored) {
        set({ notifications: JSON.parse(stored) });
      }
    } catch {
      set({ notifications: [] });
    }
  },

  addNotification: async (notification) => {
    const state = get();
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

    if (isDuplicate) return;

    const updated = [newNotif, ...state.notifications];
    await setItem(StorageKeys.NOTIFICATIONS, JSON.stringify(updated));
    set({ notifications: updated });
  },

  markAsRead: async (id) => {
    const updated = get().notifications.map(n => (n.id === id ? { ...n, isRead: true } : n));
    await setItem(StorageKeys.NOTIFICATIONS, JSON.stringify(updated));
    set({ notifications: updated });
  },

  markAllAsRead: async () => {
    const updated = get().notifications.map(n => ({ ...n, isRead: true }));
    await setItem(StorageKeys.NOTIFICATIONS, JSON.stringify(updated));
    set({ notifications: updated });
  },

  clearAll: async () => {
    await removeItem(StorageKeys.NOTIFICATIONS);
    set({ notifications: [] });
  },

  getUnreadCount: () => get().notifications.filter(n => !n.isRead).length,
}));
