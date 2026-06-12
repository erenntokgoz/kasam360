import { create } from 'zustand';
import { getItem, setItem, StorageKeys } from '../utils/storage';

interface ThemeState {
  isDarkMode: boolean;
  toggleTheme: () => void;
  hydrateTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  isDarkMode: false,

  hydrateTheme: async () => {
    try {
      // Dark mode is disabled by user request. Always light mode.
      set({ isDarkMode: false });
    } catch (e) {
      console.error('[ThemeStore] hydrateTheme error', e);
    }
  },

  toggleTheme: async () => {
    // Disabled
  },
}));
