import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  // Use relative asset paths so Chrome resolves them correctly within dist/
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Disable the modulepreload polyfill — it uses inline scripts which Chrome
    // extension CSP doesn't allow.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
      },
    },
  },
});
