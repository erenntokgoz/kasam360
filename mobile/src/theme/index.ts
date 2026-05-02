/**
 * Kasam360 — Brutalist & Minimalist Fintech Design System
 * (Includes legacy aliases to ensure other screens compile smoothly)
 */

export const theme = {
  colors: {
    primary: '#000000',
    surface: '#000000',
    card: '#050508',
    border: 'rgba(255, 255, 255, 0.1)',
    success: '#CCFF00', // Neon Volt Green
    danger: '#FFFFFF', // Ultra Pure White for contrast
    textPrimary: '#FFFFFF',
    textSecondary: 'rgba(255, 255, 255, 0.6)',
    textTertiary: 'rgba(255, 255, 255, 0.3)',
    accent: '#CCFF00',
    
    // Legacy aliases for non-refactored screens
    successLight: '#CCFF00',
    dangerLight: '#FFFFFF',
    glassBackground: '#000000',
    glassBorder: 'rgba(255, 255, 255, 0.1)',
  },
  fonts: {
    light: 'Inter-Light',
    black: 'Inter-Black',
    
    // Legacy aliases
    regular: 'Inter-Light',
    medium: 'Inter-Light',
    semiBold: 'Inter-Black',
    bold: 'Inter-Black',
  },
  fontSizes: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 18,
    xl: 24,
    '2xl': 32,
    '3xl': 48,
    '4xl': 64,
    '5xl': 80,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    base: 16, // Legacy
    lg: 24,
    xl: 32,
    '2xl': 48,
    '3xl': 64,
    '4xl': 80,
  },
  radii: {
    none: 0,
    full: 32,
    
    // Legacy aliases
    sm: 0,
    base: 0,
    lg: 0,
    xl: 0,
  },
  shadows: {
    none: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    // Legacy aliases mapped to none
    card: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    subtle: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
  },
} as const;

export type Theme = typeof theme;
