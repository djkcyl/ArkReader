import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  }).trim();
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const sourceCommit = run('git', ['rev-parse', 'HEAD']);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
const expected = {
  'windows-x64': [
    `ArkReader-${version}-windows-x64-setup.exe`,
    `ArkReader-${version}-windows-x64-portable.zip`,
  ],
  'macos-arm64': [
    `ArkReader-${version}-macos-arm64.dmg`,
    `ArkReader-${version}-macos-arm64-app.zip`,
  ],
  'linux-x64': [`ArkReader-${version}-linux-x64.deb`, `ArkReader-${version}-linux-x64.AppImage`],
  'android-arm64': [`ArkReader-${version}-android-arm64.apk`],
  web: [`ArkReader-${version}-web.zip`],
};
const checksums = [];
for (const [id, names] of Object.entries(expected)) {
  const record = JSON.parse(fs.readFileSync(`release/build-${id}.json`, 'utf8'));
  if (
    record.format !== 1 ||
    record.id !== id ||
    record.version !== version ||
    record.sourceCommit !== sourceCommit
  )
    throw Error(`Build provenance mismatch: ${id}`);
  if (JSON.stringify(Object.keys(record.files).sort()) !== JSON.stringify([...names].sort()))
    throw Error(`Unexpected package set: ${id}`);
  for (const name of names) {
    const digest = createHash('sha256')
      .update(fs.readFileSync(path.join('release', name)))
      .digest('hex');
    if (digest !== record.files[name]) throw Error(`Package checksum mismatch: ${name}`);
    checksums.push(`${digest}  ${name}`);
  }
}
const archive = path.resolve('release', expected.web[0]);
const entries = run('unzip', ['-Z', '-1', archive])
  .split(/\r?\n/)
  .filter((name) => name && !name.endsWith('/'));
if (new Set(entries).size !== entries.length || entries.length > 1000)
  throw Error('Invalid web archive entries');
for (const name of entries)
  if (
    name.startsWith('/') ||
    name.includes('\\') ||
    /[\t\r\0]/.test(name) ||
    name.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')
  )
    throw Error('Unsafe web archive path');
const readEntry = (name) =>
  execFileSync('unzip', ['-p', archive, name], { maxBuffer: 128 * 1024 * 1024 });
const web = JSON.parse(readEntry('build.json'));
if (web.version !== version || web.sourceCommit !== sourceCommit)
  throw Error('Web archive source mismatch');
for (const file of [
  'index.html',
  'sw.js',
  'engine/arkreader_web.wasm',
  'licenses/FFmpeg-LICENSE.txt',
  'licenses/FFmpeg-SOURCE.txt',
  '.nojekyll',
])
  if (!entries.includes(file)) throw Error('Incomplete web archive: ' + file);
fs.writeFileSync('release/SHA256SUMS.txt', checksums.sort().join('\n') + '\n');
if (process.argv.includes('--check-only')) {
  console.log('All five platform artifacts match the source and checksums.');
  process.exit(0);
}

const tag = `v${version}`;
run('git', ['fetch', '--no-tags', 'origin', `refs/tags/${tag}`]);
if (run('git', ['rev-parse', 'FETCH_HEAD^{commit}']) !== sourceCommit)
  throw Error('Release tag does not match the build');
let release;
try {
  release = JSON.parse(run('gh', ['release', 'view', tag, '--json', 'isDraft']));
} catch (error) {
  // A missing release is the only expected case here; authentication and network errors must fail.
  if (!String(error.stderr).includes('release not found')) throw error;
}
if (release && !release.isDraft)
  throw Error('This release is already published; published assets are immutable.');
if (!release)
  run('gh', [
    'release',
    'create',
    tag,
    '--verify-tag',
    '--draft',
    '--title',
    `ArkReader ${version}`,
    '--notes-file',
    `docs/releases/${version}.md`,
  ]);
run('gh', [
  'release',
  'upload',
  tag,
  ...checksums.map((line) => path.join('release', line.split('  ')[1])),
  'release/SHA256SUMS.txt',
  '--clobber',
]);

run(process.execPath, ['tools/publish-web.mjs', archive, sourceCommit]);

run('gh', ['release', 'edit', tag, '--draft=false', '--latest']);
console.log(`Published ${tag} with the verified static Web ZIP.`);
