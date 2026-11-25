import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const platform = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const formats = {
  windows: [
    ['portable', '.zip', 'portable.zip'],
    ['nsis', '-setup.exe', 'setup.exe'],
  ],
  macos: [
    ['portable', '.zip', 'app.zip'],
    ['dmg', '.dmg', 'dmg'],
  ],
  linux: [
    ['appimage', '.AppImage', 'AppImage'],
    ['deb', '.deb', 'deb'],
  ],
}[platform];
await fs.mkdir('release', { recursive: true });
const checksums = [];
for (const [directory, extension, suffix] of formats) {
  const folder = `src-tauri/target/release/bundle/${directory}`;
  const files = (await fs.readdir(folder)).filter(
    (name) => name.includes(version) && name.endsWith(extension),
  );
  if (files.length !== 1)
    throw new Error(`Expected one ${directory} package for ${version}, found ${files.length}`);
  const separator = ['dmg', 'deb', 'AppImage'].includes(suffix) ? '.' : '-';
  const name = `ArkReader-${version}-${platform}-${arch}${separator}${suffix}`;
  const bytes = await fs.readFile(path.join(folder, files[0]));
  await fs.writeFile(path.join('release', name), bytes);
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await fs.writeFile(`release/SHA256SUMS-${platform}-${arch}.txt`, checksums.join('\n') + '\n');
console.log(checksums.join('\n'));
