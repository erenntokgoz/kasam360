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

// ─── Dark Theme (Slate Premium) ──────────────────────────────────────────────
export const darkTheme = {
  ...shared,
  colors: {
    // Core — "Crushed Black" yığılmasını önleyen Slate (Mavi-Gri) paleti. Hiyerarşi belirginleştirildi.
    primary: '#0F172A',       // Slate 900: Ana zemin (Önceki #121212 çok boğucuydu)
    surface: '#1E293B',       // Slate 800: Katman 1 (Kart zeminleri, Header)
    card: '#334155',          // Slate 700: Katman 2 (Pop-up, Modal, Vurgulu alanlar)
    border: 'rgba(255, 255, 255, 0.12)',  // Kontrast dengesi için opaklık düşürüldü

    // Accents (Indigo & Violet)
    accent: '#818CF8',
    accentLight: '#A5B4FC',
    accentDark: '#6366F1',
    accentGradient: ['#818CF8', '#C084FC'],

    // Semantic
    success: '#34D399',
    successLight: '#6EE7B7',
    danger: '#FB7185',
    dangerLight: '#FDA4AF',
    warning: '#FBBF24',
    warningLight: '#FDE047',

    // Text — Slate uyumlu okuma kontrastı
    textPrimary: '#F8FAFC',   // Slate 50
    textSecondary: '#CBD5E1', // Slate 300
    textTertiary: '#94A3B8',  // Slate 400

    // Transparency
    accentTransparent: 'rgba(129, 140, 248, 0.15)',
    successTransparent: 'rgba(52, 211, 153, 0.15)',
    dangerTransparent: 'rgba(251, 113, 133, 0.15)',
    warningTransparent: 'rgba(251, 191, 36, 0.15)',
    whiteTransparent: 'rgba(255, 255, 255, 0.10)',
    overlay: 'rgba(15, 23, 42, 0.75)', // Slate tabanlı modal arkaplanı
  },
  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.5,
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