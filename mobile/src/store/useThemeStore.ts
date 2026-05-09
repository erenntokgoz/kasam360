import { create } from 'zustand';
import { getItem, setItem, StorageKeys } from '../utils/storage';

interface ThemeState {
  isDarkMode: boolean;
  toggleTheme: () => void;
  hydrateTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  isDarkMode: true,

  hydrateTheme: async () => {
    try {
      const stored = await getItem(StorageKeys.THEME);
      if (stored !== null) {
        set({ isDarkMode: stored === 'true' });
      }
    } catch (e) {
      console.error('[ThemeStore] hydrateTheme error', e);
    }
  },

  toggleTheme: async () => {
    set((state) => {
      const next = !state.isDarkMode;
      setItem(StorageKeys.THEME, String(next)).catch(console.error);
      return { isDarkMode: next };
    });
  },
}));
