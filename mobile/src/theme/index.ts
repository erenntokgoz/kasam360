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
    // Core — Daha okunabilir ve yumuşak tonlar (üst üste binmeyi engellemek için)
    primary: '#121212',       // Çok koyu gri (neredeyse siyah) zemin
    surface: '#1E1E1E',       // Kartların oturduğu zemin (bir tık açık)
    card: '#2C2C2C',          // Yükseltilmiş kart
    border: 'rgba(255, 255, 255, 0.15)',  // Daha dengeli kenarlıklar

    // Accents (Indigo & Violet)
    accent: '#818CF8',        // Indigo 400 (Daha parlak ve belirgin)
    accentLight: '#A5B4FC',   // Indigo 300
    accentDark: '#6366F1',    // Indigo 500
    accentGradient: ['#818CF8', '#C084FC'], // Indigo to Purple

    // Semantic
    success: '#34D399',       // Emerald 400
    successLight: '#6EE7B7',
    danger: '#FB7185',        // Rose 400
    dangerLight: '#FDA4AF',
    warning: '#FBBF24',       // Amber 400
    warningLight: '#FDE047',

    // Text — net kontrast
    textPrimary: '#F8FAFC',   // Neredeyse beyaz
    textSecondary: '#CBD5E1', // Açık gri
    textTertiary: '#94A3B8',  // Orta gri

    // Transparency — Düşük opaklıklar
    accentTransparent: 'rgba(129, 140, 248, 0.15)',
    successTransparent: 'rgba(52, 211, 153, 0.15)',
    dangerTransparent: 'rgba(251, 113, 133, 0.15)',
    warningTransparent: 'rgba(251, 191, 36, 0.15)',
    whiteTransparent: 'rgba(255, 255, 255, 0.10)',
    overlay: 'rgba(0, 0, 0, 0.65)', // Modallar için standart overlay rengi
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
