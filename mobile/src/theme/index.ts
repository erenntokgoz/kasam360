// ─── Shared Tokens ─────────────────────────────────────────────────────────────
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
  },
  fontSizes: {
    xs: 12,
    sm: 14,
    base: 16,
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
    base: 14,
    lg: 20,
    xl: 28,
    full: 9999,
  },
};

// ─── Dark Theme (Midnight Premium) ──────────────────────────────────────────────
export const darkTheme = {
  ...shared,
  colors: {
    // Core
    primary: '#020617',       // Slate 950 (Deepest)
    surface: '#0F172A',       // Slate 900
    card: '#1E293B',          // Slate 800
    border: 'rgba(51, 65, 85, 0.5)', // Slate 700 with opacity
    
    // Accents
    accent: '#6366F1',        // Indigo 500
    accentLight: '#818CF8',   // Indigo 400
    accentDark: '#4F46E5',    // Indigo 600
    accentGradient: ['#6366F1', '#8B5CF6'], // Indigo to Violet
    
    // Semantic
    success: '#10B981',       // Emerald 500
    successLight: '#34D399',
    danger: '#F43F5E',        // Rose 500
    dangerLight: '#FB7185',
    warning: '#F59E0B',       // Amber 500
    warningLight: '#FBBF24',
    
    // Text
    textPrimary: '#F8FAFC',   // Slate 50
    textSecondary: '#94A3B8', // Slate 400
    textTertiary: '#64748B',  // Slate 500
    
    // Transparency
    accentTransparent: 'rgba(99, 102, 241, 0.12)',
    successTransparent: 'rgba(16, 185, 129, 0.12)',
    dangerTransparent: 'rgba(244, 63, 94, 0.12)',
    warningTransparent: 'rgba(245, 158, 11, 0.12)',
    whiteTransparent: 'rgba(255, 255, 255, 0.04)',
    overlay: 'rgba(0, 0, 0, 0.7)',
  },
  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.4,
      shadowRadius: 20,
      elevation: 8,
    },
    button: {
      shadowColor: '#6366F1',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 6,
    },
  },
};

// ─── Light Theme (Arctic Premium) ───────────────────────────────────────────────
export const lightTheme = {
  ...shared,
  colors: {
    // Core
    primary: '#F8FAFC',       // Slate 50
    surface: '#FFFFFF',       // Pure White
    card: '#F1F5F9',          // Slate 100
    border: 'rgba(15, 23, 42, 0.08)', // Slate 900 very light
    
    // Accents
    accent: '#4F46E5',        // Indigo 600
    accentLight: '#6366F1',   // Indigo 500
    accentDark: '#3730A3',    // Indigo 800
    accentGradient: ['#4F46E5', '#7C3AED'], // Indigo to Violet
    
    // Semantic
    success: '#059669',       // Emerald 600
    successLight: '#10B981',
    danger: '#E11D48',        // Rose 600
    dangerLight: '#F43F5E',
    warning: '#D97706',       // Amber 600
    warningLight: '#F59E0B',
    
    // Text
    textPrimary: '#0F172A',   // Slate 900
    textSecondary: '#475569', // Slate 600
    textTertiary: '#94A3B8',  // Slate 400
    
    // Transparency
    accentTransparent: 'rgba(79, 70, 229, 0.06)',
    successTransparent: 'rgba(5, 150, 105, 0.06)',
    dangerTransparent: 'rgba(225, 29, 72, 0.06)',
    warningTransparent: 'rgba(217, 119, 6, 0.06)',
    whiteTransparent: 'rgba(255, 255, 255, 0.8)',
    overlay: 'rgba(15, 23, 42, 0.4)',
  },
  shadows: {
    card: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 4,
    },
    button: {
      shadowColor: '#4F46E5',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 6,
    },
  },
};

export const getTheme = (isDark: boolean) => (isDark ? darkTheme : lightTheme);
export const theme = darkTheme;
