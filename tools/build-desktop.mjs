import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const portableOnly = args.includes('--portable-only');
if (portableOnly && process.platform !== 'win32')
  throw Error('The portable-only development build targets Windows.');
const bundles = { win32: 'nsis', darwin: 'app,dmg', linux: 'appimage,deb' }[process.platform];
if (!bundles) throw Error('Unsupported desktop host: ' + process.platform);
const media = spawnSync(process.execPath, ['tools/prepare-native.mjs'], { stdio: 'inherit' });
if (media.status !== 0) process.exit(media.status ?? 1);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@tauri-apps/cli/tauri.js',
    'build',
    ...(portableOnly ? ['--no-bundle'] : ['--bundles', bundles]),
    ...args.filter((arg) => arg !== '--portable-only'),
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
if (process.platform === 'win32' || process.platform === 'darwin') {
  const portable = spawnSync(process.execPath, ['tools/build-portable.mjs'], { stdio: 'inherit' });
  process.exit(portable.status ?? 1);
}
