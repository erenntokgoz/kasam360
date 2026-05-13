// ─── Shared Tokens ─────────────────────────────────────────────────────────────
const shared = {
  spacing: {
    xs: 4, sm: 8, base: 12, md: 16, lg: 24, xl: 32, '2xl': 48, '3xl': 64,
  },
  fontSizes: {
    xs: 12, sm: 14, base: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 36,
  },
  fonts: {
    regular: 'System', medium: 'System', semiBold: 'System', bold: 'System',
  },
  radii: {
    sm: 8, base: 14, lg: 20, xl: 28, full: 9999,
  },
};

// ─── Dark Theme (OLED Premium / True Black) ──────────────────────────────────
export const darkTheme = {
  ...shared,
  colors: {
    primary: '#000000',       // %100 Saf Siyah (Zemin)
    surface: '#121212',       // Yüzey 1
    card: '#1A1A1A',          // Yüzey 2 (Modal/Kart)
    border: 'rgba(255, 255, 255, 0.08)',

    accent: '#6366F1',
    accentLight: '#818CF8',
    accentDark: '#4F46E5',
    accentGradient: ['#6366F1', '#8B5CF6'],

    success: '#10B981',
    successLight: '#34D399',
    danger: '#F43F5E',
    dangerLight: '#FB7185',
    warning: '#F59E0B',
    warningLight: '#FBBF24',

    textPrimary: '#FFFFFF',
    textSecondary: '#A1A1AA',
    textTertiary: '#71717A',

    accentTransparent: 'rgba(99, 102, 241, 0.15)',
    successTransparent: 'rgba(16, 185, 129, 0.15)',
    dangerTransparent: 'rgba(244, 63, 94, 0.15)',
    warningTransparent: 'rgba(245, 158, 11, 0.15)',
    whiteTransparent: 'rgba(255, 255, 255, 0.10)',
    overlay: 'rgba(0, 0, 0, 0.85)',
  },
  shadows: {
    card: {
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 10,
    },
    button: {
      shadowColor: '#6366F1', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
    },
  },
};

// ─── Light Theme (Arctic Premium) ───────────────────────────────────────────────
export const lightTheme = {
  ...shared,
  colors: {
    primary: '#F8FAFC',
    surface: '#FFFFFF',
    card: '#F1F5F9',
    border: 'rgba(15, 23, 42, 0.08)',
    accent: '#4F46E5',
    accentLight: '#6366F1',
    accentDark: '#3730A3',
    accentGradient: ['#4F46E5', '#7C3AED'],
    success: '#059669',
    successLight: '#10B981',
    danger: '#E11D48',
    dangerLight: '#F43F5E',
    warning: '#D97706',
    warningLight: '#F59E0B',
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textTertiary: '#94A3B8',
    accentTransparent: 'rgba(79, 70, 229, 0.06)',
    successTransparent: 'rgba(5, 150, 105, 0.06)',
    dangerTransparent: 'rgba(225, 29, 72, 0.06)',
    warningTransparent: 'rgba(217, 119, 6, 0.06)',
    whiteTransparent: 'rgba(255, 255, 255, 0.8)',
    overlay: 'rgba(15, 23, 42, 0.4)',
  },
  shadows: {
    card: {
      shadowColor: '#0F172A', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 4,
    },
    button: {
      shadowColor: '#4F46E5', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 6,
    },
  },
};

export const getTheme = (isDark: boolean) => (isDark ? darkTheme : lightTheme);
export const theme = darkTheme;