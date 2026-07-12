import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Host base path (ADR-011). Defaults to "/" (integrated Worker, user/org Pages,
  // Azure SWA). Set VITE_BASE_PATH=/repo-wrangler/ for a GitHub Pages project site.
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    // In local development the Worker (wrangler dev) listens on 8787.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/auth': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
