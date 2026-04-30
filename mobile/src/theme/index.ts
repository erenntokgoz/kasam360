/**
 * Kasam360 — Executive Design System
 * ──────────────────────────────────────────────────────────────────────────────
 * All visual tokens live here. Import { theme } everywhere; never hard-code
 * colours or font sizes in component files.
 */

export const theme = {
  // ─── Palette ──────────────────────────────────────────────────────────────
  colors: {
    /** Core background — deep neutral slate */
    primary: '#1A1C1E',
    /** Slightly elevated surface */
    surface: '#22252A',
    /** Card / elevated container */
    card: '#2A2D33',
    /** Dividers, very subtle lines */
    border: '#3A3D44',

    /** Deep emerald — income / success */
    success: '#064E3B',
    /** Lighter emerald for text on dark bg */
    successLight: '#10B981',

    /** Expense / danger */
    danger: '#991B1B',
    dangerLight: '#F87171',

    /** Ivory white — primary text */
    textPrimary: '#F8F9FA',
    /** Muted / secondary text */
    textSecondary: '#9CA3AF',
    /** Even more muted — timestamps, labels */
    textTertiary: '#6B7280',

    /** Accent highlight — subtle gold for emphasis */
    accent: '#D4AF37',

    /** Glassmorphism sidebar background (20 % opacity applied inline) */
    glassBackground: 'rgba(26, 28, 30, 0.20)',
    /** Sidebar border — ivory at low opacity */
    glassBorder: 'rgba(248, 249, 250, 0.08)',
  },

  // ─── Typography ───────────────────────────────────────────────────────────
  fonts: {
    /** Primary typeface — must be linked in native */
    regular: 'Inter-Regular',
    medium: 'Inter-Medium',
    semiBold: 'Inter-SemiBold',
    bold: 'Inter-Bold',
  },

  fontSizes: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 17,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },

  // ─── Spacing ──────────────────────────────────────────────────────────────
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    base: 16,
    lg: 20,
    xl: 24,
    '2xl': 32,
    '3xl': 40,
    '4xl': 48,
  },

  // ─── Radii ────────────────────────────────────────────────────────────────
  radii: {
    sm: 6,
    base: 10,
    lg: 14,
    xl: 20,
    full: 999,
  },

  // ─── Shadows ──────────────────────────────────────────────────────────────
  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 6,
    },
    subtle: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.10,
      shadowRadius: 6,
      elevation: 3,
    },
  },
} as const;

export type Theme = typeof theme;
