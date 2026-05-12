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
    '2xl': 30,
    '3xl': 40,
  },
  fonts: {
    regular: 'System',
    medium: 'System',
    semiBold: 'System',
    bold: 'System',
  },
  radii: {
    sm: 10,
    base: 16,
    lg: 24,
    xl: 32,
    full: 9999,
  },
};

// ─── Dark Theme (Midnight Solid) ──────────────────────────────────────────────
export const darkTheme = {
  ...shared,
  colors: {
    // Core — net, keskin, bulanıklık yok
    primary: '#0A0E17',       // Koyu gece mavisi
    surface: '#141925',       // Kartların oturduğu zemin
    card: '#1E2433',          // Yükseltilmiş kart — yüzeyden net ayrılır
    border: 'rgba(255, 255, 255, 0.12)',  // Daha belirgin kenarlıklar
    
    // Accents (Indigo & Violet)
    accent: '#6366F1',        // Indigo 500
    accentLight: '#818CF8',   // Indigo 400
    accentDark: '#4F46E5',    // Indigo 600
    accentGradient: ['#6366F1', '#A855F7'], // Indigo to Purple
    
    // Semantic — parlak ve net
    success: '#10B981',       // Emerald 500
    successLight: '#34D399',
    danger: '#F43F5E',        // Rose 500
    dangerLight: '#FB7185',
    warning: '#F59E0B',       // Amber 500
    warningLight: '#FBBF24',
    
    // Text — yüksek kontrast
    textPrimary: '#F1F5F9',   // Slate 100
    textSecondary: '#CBD5E1', // Slate 300
    textTertiary: '#94A3B8',  // Slate 400 (eski 500'den parlak)
    
    // Transparency — daha belirgin
    accentTransparent: 'rgba(99, 102, 241, 0.18)',
    successTransparent: 'rgba(16, 185, 129, 0.18)',
    dangerTransparent: 'rgba(244, 63, 94, 0.18)',
    warningTransparent: 'rgba(245, 158, 11, 0.18)',
    whiteTransparent: 'rgba(255, 255, 255, 0.08)',
    overlay: 'rgba(0, 0, 0, 0.85)',
  },
  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    button: {
      shadowColor: '#6366F1',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
  },
};

// ─── Light Theme (Arctic Glass) ───────────────────────────────────────────────
export const lightTheme = {
  ...shared,
  colors: {
    // Core
    primary: '#F8FAFC',       // Slate 50
    surface: '#FFFFFF',       // Pure white
    card: '#F1F5F9',          // Slate 100
    border: 'rgba(15, 23, 42, 0.06)',
    
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
    accentTransparent: 'rgba(79, 70, 229, 0.08)',
    successTransparent: 'rgba(5, 150, 105, 0.08)',
    dangerTransparent: 'rgba(225, 29, 72, 0.08)',
    warningTransparent: 'rgba(217, 119, 6, 0.08)',
    whiteTransparent: 'rgba(255, 255, 255, 0.8)',
    overlay: 'rgba(15, 23, 42, 0.4)',
  },
  shadows: {
    card: {
      shadowColor: '#475569',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
      elevation: 5,
    },
    button: {
      shadowColor: '#4F46E5',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 8,
    },
  },
};

export const getTheme = (isDark: boolean) => (isDark ? darkTheme : lightTheme);
export const theme = darkTheme;
