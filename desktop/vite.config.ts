import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@app': path.resolve(__dirname, './src/app'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@features': path.resolve(__dirname, './src/features'),
      '@services': path.resolve(__dirname, './src/services'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@lib': path.resolve(__dirname, './src/lib'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
