import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const platform = process.argv.includes('--android')
  ? 'android'
  : { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
const arch = platform === 'android' || process.arch === 'arm64' ? 'arm64' : 'x64';
const formats = {
  android: [['universal/release', '.apk', 'apk']],
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
  const folder =
    platform === 'android'
      ? `src-tauri/gen/android/app/build/outputs/apk/${directory}`
      : `src-tauri/target/release/bundle/${directory}`;
  const files = (await fs.readdir(folder)).filter(
    (name) => (platform === 'android' || name.includes(version)) && name.endsWith(extension),
  );
  if (files.length !== 1)
    throw new Error(`Expected one ${directory} package for ${version}, found ${files.length}`);
  const source = path.join(folder, files[0]);
  if (platform === 'android') {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    if (!sdk) throw new Error('ANDROID_HOME is required to verify the release APK');
    const versions = (await fs.readdir(path.join(sdk, 'build-tools')))
      .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!versions.length) throw new Error('Android build-tools are missing');
    const buildTools = path.join(sdk, 'build-tools', versions.at(-1));
    const run = (command, args) => {
      const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr || 'APK verification failed');
      return result.stdout;
    };
    const badging = run(
      path.join(buildTools, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'),
      ['dump', 'badging', source],
    );
    if (
      !badging.includes(`versionName='${version}'`) ||
      !/^native-code:\s*'arm64-v8a'\s*$/m.test(badging)
    )
      throw new Error('The APK version or ABI does not match the release');
    const java = process.env.JAVA_HOME
      ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      : 'java';
    run(java, ['-jar', path.join(buildTools, 'lib/apksigner.jar'), 'verify', source]);
  }
  const separator = ['dmg', 'deb', 'AppImage', 'apk'].includes(suffix) ? '.' : '-';
  const name = `ArkReader-${version}-${platform}-${arch}${separator}${suffix}`;
  const bytes = await fs.readFile(source);
  await fs.writeFile(path.join('release', name), bytes);
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await fs.writeFile(`release/SHA256SUMS-${platform}-${arch}.txt`, checksums.join('\n') + '\n');
console.log(checksums.join('\n'));
