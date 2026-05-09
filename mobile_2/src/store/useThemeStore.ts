import { create } from 'zustand';
import { storage } from '../utils/storage';

const THEME_KEY = 'app.isDarkMode';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ThemeState {
  isDarkMode: boolean;
  toggleTheme: () => void;
  hydrateTheme: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useThemeStore = create<ThemeState>((set) => ({
  /** Default: karanlık mod (mevcut davranış korunuyor) */
  isDarkMode: true,

  /** Uygulama açılışında MMKV'den okur. App.tsx'te çağırılmalı. */
  hydrateTheme: () => {
    const stored = storage.getString(THEME_KEY);
    if (stored !== undefined) {
      set({ isDarkMode: stored === 'true' });
    }
  },

  /** Dark ↔ Light arasında geçiş yapar ve MMKV'ye kaydeder. */
  toggleTheme: () =>
    set((state) => {
      const next = !state.isDarkMode;
      storage.set(THEME_KEY, String(next));
      return { isDarkMode: next };
    }),
}));
