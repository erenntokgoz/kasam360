// ─── Shared (mode-agnostic) tokens ────────────────────────────────────────────

const shared = {
  spacing: {
    xs: 4,
    sm: 8,
    base: 12,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 48,
    '3xl': 64,
    '4xl': 80,
  },
  fontSizes: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 18,
    xl: 22,
    '2xl': 28,
    '3xl': 36,
  },
  fonts: {
    regular: 'System',
    medium: 'System',
    semiBold: 'System',
    bold: 'System',
  },
  radii: {
    sm: 6,
    base: 10,
    lg: 16,
    xl: 24,
    full: 9999,
  },
  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 10,
      elevation: 2,
    },
    button: {
      shadowColor: '#2563EB',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
      elevation: 6,
    },
  },
};

// ─── Dark Theme (mevcut koyu lacivert) ────────────────────────────────────────

export const darkTheme = {
  ...shared,
  colors: {
    primary: '#0A0F1A',       // ultra koyu lacivert
    surface: '#141C2B',       // kart yüzeyleri
    card: '#1E293B',          // input, küçük kartlar
    accent: '#2563EB',        // güven mavisi
    success: '#059669',
    successLight: '#10B981',
    danger: '#DC2626',
    dangerLight: '#EF4444',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    textTertiary: '#64748B',
    border: '#334155',
  },
};

// ─── Light Theme (profesyonel açık) ───────────────────────────────────────────

export const lightTheme = {
  ...shared,
  colors: {
    primary: '#F8FAFC',       // açık arkaplan
    surface: '#FFFFFF',       // kart yüzeyleri
    card: '#F1F5F9',          // input, küçük kartlar
    accent: '#2563EB',        // aynı accent mavi
    success: '#059669',
    successLight: '#10B981',
    danger: '#DC2626',
    dangerLight: '#EF4444',
    textPrimary: '#0F172A',   // koyu metin
    textSecondary: '#475569',
    textTertiary: '#94A3B8',
    border: '#E2E8F0',
  },
  shadows: {
    card: {
      shadowColor: '#94A3B8',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 2,
    },
    button: {
      shadowColor: '#2563EB',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 4,
    },
  },
};

// ─── Helper ───────────────────────────────────────────────────────────────────

export const getTheme = (isDark: boolean) => (isDark ? darkTheme : lightTheme);

// ─── Backwards-compat default export (dark theme) ─────────────────────────────
// Eski import'lar hâlâ `import { theme } from '../theme'` kullanıyorsa bozulmasın.

export const theme = darkTheme;