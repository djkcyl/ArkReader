import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version),
  },
  build: {
    outDir: mode === 'web' ? 'web-dist' : 'dist',
    rollupOptions: {
      input:
        mode === 'web'
          ? resolve('web.html')
          : { main: resolve('index.html'), startup: resolve('startup.html') },
    },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:8017', '/media': 'http://127.0.0.1:8017' } },
  worker: { format: 'es' },
}));
