import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './src/core'),
      '@domain': path.resolve(__dirname, './src/domain'),
      '@data': path.resolve(__dirname, './src/data'),
      '@presentation': path.resolve(__dirname, './src/presentation'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['**/tests/e2e-playwright/**', '**/e2e-playwright/**', '**/node_modules/**'],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**", "**/backend/target/**"],
    },
  },
});
