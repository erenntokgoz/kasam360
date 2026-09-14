/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      /**
       * CSS-variable bridge required for Shadcn UI + Tailwind v3 compatibility.
       * These mappings allow `@apply border-border`, `@apply bg-background`,
       * `@apply text-foreground`, etc. to resolve against the CSS custom properties
       * defined in :root / .dark in index.css.
       *
       * Without these, `tsc && vite build` fails with:
       *   "The `border-border` class does not exist."
       */
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: {
            DEFAULT: 'var(--sidebar-primary)',
            foreground: 'var(--sidebar-primary-foreground)',
          },
          accent: {
            DEFAULT: 'var(--sidebar-accent)',
            foreground: 'var(--sidebar-accent-foreground)',
          },
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },
        // POS-specific semantic tokens (preserved from original config)
        pos: {
          bg: '#0F172A',
          surface: '#1E293B',
          card: '#182234',
          border: '#334155',
          primary: '#2563EB',
          'primary-hover': '#1D4ED8',
          success: '#10B981',
          'success-hover': '#059669',
          warning: '#F59E0B',
          danger: '#EF4444',
          'danger-hover': '#DC2626',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Geist Variable', 'sans-serif'],
        heading: ['Geist Variable', 'sans-serif'],
        mono: ['Geist Variable', 'monospace'],
      },
    },
  },
  plugins: [],
};
