import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { defineConfig } from '../desktop/node_modules/vite/dist/node/index.js';
import react from '../desktop/node_modules/@vitejs/plugin-react/dist/index.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const desktopModules = path.resolve(root, '../desktop/node_modules');

export default defineConfig({
  root,
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SITE_URL': JSON.stringify(process.env.KASAM360_MOBILE_SITE_URL || 'https://kasam360.com.tr'),
  },
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: path.join(desktopModules, 'react-dom/client.js') },
      { find: /^react-dom$/, replacement: path.join(desktopModules, 'react-dom/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: path.join(desktopModules, 'react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.join(desktopModules, 'react/jsx-dev-runtime.js') },
      { find: /^react$/, replacement: path.join(desktopModules, 'react/index.js') },
      { find: /^lucide-react$/, replacement: path.join(desktopModules, 'lucide-react/dist/cjs/lucide-react.js') },
    ],
  },
  build: { outDir: path.resolve(root, 'dist'), emptyOutDir: true },
});
