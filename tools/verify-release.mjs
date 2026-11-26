import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
let native =
  process.argv[2] ??
  (process.platform === 'darwin'
    ? 'src-tauri/target/release/bundle/macos/ArkReader.app/Contents/MacOS/arkreader-desktop'
    : `src-tauri/target/release/arkreader-desktop${process.platform === 'win32' ? '.exe' : ''}`);
native = path.resolve(native);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arkreader-native-check-'));
const log = await fs.open(path.join(directory, 'startup.log'), 'w');
try {
  const env = {
    ...process.env,
    ARKREADER_DATA: path.join(directory, 'library'),
    ARKREADER_VERIFY_HIDDEN: process.env.CI === 'true' ? '0' : '1',
    ARKREADER_VERIFY_EXIT_READY: '1',
    ARKREADER_VERIFY_SCRIPT: path.join(root, 'tools/verify-native-media.js'),
    WEBVIEW2_USER_DATA_FOLDER: path.join(directory, 'webview'),
    APPIMAGE_EXTRACT_AND_RUN: '1',
  };
  delete env.ARKREADER_FFMPEG;
  const child = spawn(native, [], {
    cwd: directory,
    env,
    stdio: ['ignore', log.fd, log.fd],
    windowsHide: true,
  });
  const deadline = setTimeout(() => child.kill(), 600000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  clearTimeout(deadline);
  await log.close();
  const output = await fs.readFile(path.join(directory, 'startup.log'), 'utf8');
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, 'artifacts/native-startup.log'), output);
  assert.equal(code, 0, output);
  assert(output.includes('ARKREADER_DIAGNOSTIC main_ui_ready'), output);
  assert(output.includes('ARKREADER_MEDIA_VERIFIED'), output);
  assert(!output.includes('ARKREADER_MEDIA_FAILED'), output);
  console.log('Native startup, movie picture/audio and seeking passed.');
} finally {
  await log.close().catch(() => {});
  const resolved = await fs.realpath(directory);
  assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
  assert(path.basename(resolved).startsWith('arkreader-native-check-'));
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
}
