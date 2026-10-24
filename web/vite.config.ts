// Vite config for the web v1 page. Root is web/, output web/dist (served by the Worker as static assets).
// `npm run dev:web` proxies /api and /health to `wrangler dev` on :8787.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const worker = 'http://127.0.0.1:8787';

export default defineConfig({
  root: 'web', // npm scripts run from the repo root
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: { proxy: { '/api': worker, '/health': worker } },
});
