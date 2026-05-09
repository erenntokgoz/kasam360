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
    sm: 8,
    base: 12,
    lg: 20,
    xl: 28,
    full: 9999,
  },
  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.1,
      shadowRadius: 20,
      elevation: 5,
    },
    button: {
      shadowColor: '#3B82F6',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 8,
    },
  },
};

// ─── Dark Theme (Premium Midnight) ────────────────────────────────────────

export const darkTheme = {
  ...shared,
  colors: {
    primary: '#0F1623',        // Deeper dark bg
    surface: '#1A2333',        // Slightly lighter surface
    card: '#243044',           // Card bg
    accent: '#3B82F6',         // Blue 500
    accentGradient: ['#3B82F6', '#2563EB'],
    success: '#10B981',        // Emerald 500
    successLight: '#34D399',
    danger: '#EF4444',         // Red 500
    dangerLight: '#F87171',
    textPrimary: '#F9FAFB',    // Gray 50
    textSecondary: '#CBD5E1',  // Slate 300 - daha iyi kontrast
    textTertiary: '#94A3B8',   // Slate 400
    border: '#2D3F55',         // Koyu mavi-gri border
    accentTransparent: 'rgba(59, 130, 246, 0.15)',
    successTransparent: 'rgba(16, 185, 129, 0.15)',
    dangerTransparent: 'rgba(239, 68, 68, 0.15)',
    overlay: 'rgba(0, 0, 0, 0.75)',
  },
};

// ─── Light Theme (Premium Arctic) ───────────────────────────────────────────

export const lightTheme = {
  ...shared,
  colors: {
    primary: '#F8FAFC',       // Slate 50
    surface: '#FFFFFF',       // Pure White
    card: '#F1F5F9',          // Slate 100
    accent: '#2563EB',        // Blue 600
    accentGradient: ['#2563EB', '#1D4ED8'],
    success: '#059669',       // Emerald 600
    successLight: '#10B981',
    danger: '#DC2626',        // Red 600
    dangerLight: '#EF4444',
    textPrimary: '#0F172A',   // Slate 900
    textSecondary: '#475569', // Slate 600
    textTertiary: '#94A3B8',  // Slate 400
    border: '#E2E8F0',        // Slate 200
    accentTransparent: 'rgba(37, 99, 235, 0.10)',
    successTransparent: 'rgba(16, 185, 129, 0.10)',
    dangerTransparent: 'rgba(239, 68, 68, 0.10)',
    overlay: 'rgba(15, 23, 42, 0.40)',
  },
  shadows: {
    card: {
      shadowColor: '#64748B',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 24,
      elevation: 4,
    },
    button: {
      shadowColor: '#2563EB',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 6,
    },
  },
};

// ─── Helper ───────────────────────────────────────────────────────────────────

export const getTheme = (isDark: boolean) => (isDark ? darkTheme : lightTheme);

export const theme = darkTheme;