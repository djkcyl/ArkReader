import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = {
  'win32-x64': 'windows-x64',
  'linux-x64': 'linux-x64',
  'darwin-arm64': 'macos-arm64',
}[`${process.platform}-${process.arch}`];
if (!target) throw new Error(`Unsupported release host: ${process.platform}/${process.arch}`);
const env = { ...process.env };
let bash = 'bash';
if (process.platform === 'win32') {
  const msys = env.MSYS2_ROOT ?? 'C:/msys64';
  bash = path.join(msys, 'usr/bin/bash.exe');
  if (!fs.existsSync(bash))
    throw new Error(
      'Install MSYS2 with make and mingw-w64-ucrt-x86_64-gcc; set MSYS2_ROOT if it is not in C:/msys64.',
    );
  env.MSYSTEM = 'UCRT64';
  env.PATH = [path.join(msys, 'ucrt64/bin'), path.join(msys, 'usr/bin'), env.PATH].join(
    path.delimiter,
  );
}
const result = spawnSync(bash, ['--noprofile', '--norc', 'tools/build-media.sh', target], {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
