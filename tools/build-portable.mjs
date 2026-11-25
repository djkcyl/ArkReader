import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'src-tauri/target/release');
const output = path.join(release, 'bundle/portable');
await fs.mkdir(output, { recursive: true });
if (process.platform === 'darwin') {
  const target = path.join(output, `ArkReader-${version}-macos-arm64.zip`);
  const result = spawnSync(
    'ditto',
    [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      path.join(release, 'bundle/macos/ArkReader.app'),
      target,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(target);
} else if (process.platform === 'win32') {
  const name = `ArkReader-${version}-windows-x64-portable`;
  const destination = path.join(output, name);
  const staging = await fs.mkdtemp(path.join(output, '.portable-'));
  const folder = path.join(staging, name);
  await fs.mkdir(folder);
  await fs.copyFile(
    path.join(release, 'arkreader-desktop.exe'),
    path.join(folder, 'ArkReader.exe'),
  );
  await fs.cp(path.join(root, 'src-tauri/resources/native'), path.join(folder, 'native'), {
    recursive: true,
  });
  await fs.cp(path.join(root, 'licenses'), path.join(folder, 'licenses'), { recursive: true });
  await fs.writeFile(
    path.join(folder, 'portable.json'),
    JSON.stringify(
      { version, format: 'portable', dataDirectory: 'platform-user-directory' },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(folder, '使用说明.txt'),
    '双击 ArkReader.exe 启动。请保留 native 文件夹。\n\n资料库、设置和阅读记录保存在系统用户目录，升级时直接替换程序即可。\n',
  );
  const files = {};
  const checksums = {};
  async function collect(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (entry.isFile()) {
        const relative = path.relative(folder, file).split(path.sep).join('/');
        const bytes = await fs.readFile(file);
        files[`${name}/${relative}`] = new Uint8Array(bytes);
        checksums[relative] = createHash('sha256').update(bytes).digest('hex');
      }
    }
  }
  await collect(folder);
  const receipt = JSON.stringify({ version, files: checksums }, null, 2);
  await fs.writeFile(path.join(folder, 'checksums.json'), receipt);
  files[`${name}/checksums.json`] = new TextEncoder().encode(receipt);
  const archive = path.join(output, `${name}.zip`);
  await fs.writeFile(archive, zipSync(files, { level: 6 }));
  if (await fs.stat(destination).catch(() => null)) {
    const marker = JSON.parse(await fs.readFile(path.join(destination, 'portable.json'), 'utf8'));
    if (
      marker.format !== 'portable' ||
      (await fs.stat(path.join(destination, 'user-data')).catch(() => null))
    )
      throw new Error('Refusing to replace an unmarked folder or user data');
    const resolved = await fs.realpath(destination);
    if (!resolved.startsWith((await fs.realpath(output)) + path.sep))
      throw new Error('Portable path escaped the build directory');
    const executable = path.join(resolved, 'ArkReader.exe');
    const unlocked = await fs.open(executable, 'r+').catch(() => {
      throw new Error(`Close ArkReader before replacing the portable folder: ${resolved}`);
    });
    await unlocked.close();
    await fs.rm(resolved, { recursive: true });
  }
  await fs.rename(folder, destination);
  await fs.rmdir(staging);
  console.log(archive);
} else {
  console.log('Linux portable output is the AppImage.');
}
