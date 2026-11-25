import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  build: {
    rollupOptions: { input: { main: resolve('index.html'), startup: resolve('startup.html') } },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:8017', '/media': 'http://127.0.0.1:8017' } },
});
