import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK directory.');
if (!env.NDK_HOME) {
  const versions = fs
    .readdirSync(path.join(sdk, 'ndk'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  env.NDK_HOME = path.join(sdk, 'ndk', versions.at(-1));
}
const hosts = fs.readdirSync(path.join(env.NDK_HOME, 'toolchains/llvm/prebuilt'));
const host = hosts.find((name) =>
  name.startsWith({ win32: 'windows', linux: 'linux', darwin: 'darwin' }[process.platform]),
);
if (!host) throw new Error('The NDK has no toolchain for this build host.');
const toolchain = path.join(env.NDK_HOME, 'toolchains/llvm/prebuilt', host);
const clang = fs
  .readdirSync(path.join(toolchain, 'lib/clang'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1);
const quote = (value) => `"${value.replaceAll('\\', '/')}"`;
for (const [target, triple] of [
  ['aarch64_linux_android', 'aarch64-linux-android'],
  ['x86_64_linux_android', 'x86_64-linux-android'],
]) {
  env[`BINDGEN_EXTRA_CLANG_ARGS_${target}`] =
    `--target=${triple}24 --sysroot=${quote(path.join(toolchain, 'sysroot'))} -resource-dir=${quote(path.join(toolchain, 'lib/clang', clang))}`;
}
const args = process.argv.slice(2);
const action = args.shift() ?? 'build';
const assets = 'src-tauri/gen/android/app/src/main/assets/licenses';
fs.mkdirSync(assets, { recursive: true });
fs.cpSync('licenses', assets, { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@tauri-apps/cli/tauri.js',
    'android',
    action,
    '--config',
    'src-tauri/tauri.mobile.conf.json',
    ...args,
  ],
  { env, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
