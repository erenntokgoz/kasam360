import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'app.isDarkMode';

interface ThemeState {
  isDarkMode: boolean;
  toggleTheme: () => void;
  hydrateTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  isDarkMode: true,

  hydrateTheme: async () => {
    try {
      const stored = await AsyncStorage.getItem(THEME_KEY);
      if (stored !== null) {
        set({ isDarkMode: stored === 'true' });
      }
    } catch (e) {
      console.error('[ThemeStore] hydrateTheme error', e);
    }
  },

  toggleTheme: () => {
    set((state) => {
      const next = !state.isDarkMode;
      AsyncStorage.setItem(THEME_KEY, String(next)).catch(console.error);
      return { isDarkMode: next };
    });
  },
}));
