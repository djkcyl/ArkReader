import { defineConfig, type UserConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const downloadContent = readFileSync('src/app/download-content.html', 'utf8');
export default defineConfig(({ mode }): UserConfig => {
  if (mode === 'web' && !/^engine\/[a-f0-9]{64}\/$/.test(process.env.VITE_ENGINE_PATH ?? ''))
    throw new Error('Build the Web engine with npm run web:build before bundling its frontend.');
  return {
    base: './',
    plugins: [
      {
        name: 'app-version-html',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) =>
            html
              .replaceAll('%DOWNLOAD_CONTENT%', downloadContent)
              .replaceAll('%APP_VERSION%', version),
        },
      },
    ],
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    build: {
      outDir: mode === 'web' ? 'web-dist' : 'dist',
      rollupOptions: {
        input:
          mode === 'web'
            ? { web: resolve('web.html'), download: resolve('download.html') }
            : { main: resolve('index.html'), startup: resolve('startup.html') },
      },
    },
    server: { proxy: { '/api': 'http://127.0.0.1:8017', '/media': 'http://127.0.0.1:8017' } },
    worker: { format: 'es' },
  };
});
