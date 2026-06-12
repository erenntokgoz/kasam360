// ─── Shared Tokens ─────────────────────────────────────────────────────────────
// Tek kaynak: tokens.ts — index.ts buradan türetilir, direkt tekrar tanımlama yapılmaz.
import { tokens, darkColors, lightColors, shadows } from './tokens';

// ─── Dark Theme (OLED Premium / True Black) ──────────────────────────────────
export const darkTheme = {
  spacing: tokens.spacing,
  fontSizes: tokens.fontSizes,
  fonts: tokens.fonts,
  radii: tokens.radii,
  colors: darkColors,
  shadows: shadows.dark,
};

// ─── Light Theme (Arctic Premium) ───────────────────────────────────────────────
export const lightTheme = {
  spacing: tokens.spacing,
  fontSizes: tokens.fontSizes,
  fonts: tokens.fonts,
  radii: tokens.radii,
  colors: lightColors,
  shadows: shadows.light,
};

export const getTheme = (isDark: boolean) => (isDark ? darkTheme : lightTheme);
export const theme = darkTheme;

// Re-export tokens for convenience
export { tokens, darkColors, lightColors, shadows };