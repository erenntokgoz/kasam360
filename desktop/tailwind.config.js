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
        // POS Apple HIG ve Spatial Glass antrasit renk paleti
        pos: {
          bg: '#16171b',
          surface: '#1c1d22',
          card: '#222329',
          border: 'rgba(255, 255, 255, 0.1)',
          primary: '#007AFF',
          'primary-hover': '#0062cc',
          success: '#34C759',
          'success-hover': '#2eb34f',
          warning: '#FF9F0A',
          danger: '#FF453A',
          'danger-hover': '#d93a31',
        },
        // Apple Human Interface Guidelines sistem renk token'ları
        apple: {
          bg: '#090a0f',
          card: '#16171b',
          card2: '#1c1d22',
          border: 'rgba(255,255,255,0.08)',
          blue: '#007AFF',
          green: '#34C759',
          red: '#FF3B30',
          orange: '#FF9500',
          yellow: '#FFCC00',
          gray1: '#8E8E93',
          gray2: '#636366',
          gray3: '#48484A',
          gray4: '#3A3A3C',
          gray5: '#2C2C2E',
          gray6: '#1C1C1E',
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
