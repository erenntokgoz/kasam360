/**
 * Açık/Koyu tema yönetimi — localStorage kalıcılığı ile.
 * Varsayılan tema: dark (Apple Spatial Glass).
 */

import { useState, useEffect, useCallback } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'kasam360-theme';

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    // İlk render'da localStorage'dan oku, yoksa dark
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return (stored === 'light' ? 'light' : 'dark') as Theme;
    } catch {
      return 'dark';
    }
  });

  // Tema değiştiğinde DOM ve localStorage'ı güncelle
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage erişilemezse sessizce devam et
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  return { theme, toggleTheme, setTheme };
}
