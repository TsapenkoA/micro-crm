import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'development-csp',
    apply: 'serve',
    transformIndexHtml: { order: 'post', handler: html => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '') },
  }],
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; frame-src 'self' blob:; worker-src 'none'",
      'Referrer-Policy': 'no-referrer',
    },
    proxy: { '/api': { target: 'http://127.0.0.1:8000' } },
  },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] },
});
