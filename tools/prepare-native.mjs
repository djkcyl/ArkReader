import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.8.1';
const targets = {
  'win32-x64': ['win_amd64', 'f27ca4cb85e2d4946deedbce1a81245dfd942a2bcf94b53676fb3956aa95bf1b'],
  'darwin-arm64': [
    'macosx_12_0_arm64',
    '5636d691e36e5274b13fe38182b1f627b2e35dcecc63944012c2470f9484fc45',
  ],
  'linux-x64': [
    'manylinux_2_28_x86_64',
    '050d6850601c3b3890bd2b28306f3b842b3daea390a561101174375a1c460bda',
  ],
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error(`Unsupported release host: ${process.platform}/${process.arch}`);
const [platform, expected] = target;
const output = path.join(root, 'src-tauri/resources/native');
const cache = path.join(root, 'artifacts/native-tools');
const filename = `imageio_ffmpeg-${version}-py3-none-${platform}.whl`;
await fs.mkdir(cache, { recursive: true });
await fs.mkdir(output, { recursive: true });
let archive = await fs.readFile(path.join(cache, filename)).catch(() => null);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let url = '';
if (!archive || hash(archive) !== expected) {
  const response = await fetch(`https://pypi.org/pypi/imageio-ffmpeg/${version}/json`);
  if (!response.ok) throw new Error('Could not read the native media package manifest');
  const metadata = await response.json();
  const record = metadata.urls.find((entry) => entry.filename === filename);
  if (!record || record.digests.sha256 !== expected)
    throw new Error('Media package checksum changed');
  url = record.url;
  const download = await fetch(url);
  if (!download.ok) throw new Error('Could not download the native media component');
  archive = Buffer.from(await download.arrayBuffer());
  if (hash(archive) !== expected) throw new Error('Native media component failed verification');
  await fs.writeFile(path.join(cache, filename), archive);
}
const files = unzipSync(archive, {
  filter: (file) => /^imageio_ffmpeg\/binaries\/ffmpeg-[^/]+(?:\.exe)?$/.test(file.name),
});
const binaries = Object.entries(files);
if (binaries.length !== 1) throw new Error('Native media package has ambiguous contents');
const executable = path.join(output, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
await fs.writeFile(executable, binaries[0][1]);
await fs.chmod(executable, 0o755);
const run = (args) => {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Native media component could not run');
  return result.stdout + result.stderr;
};
const build = run(['-version']);
if (build.includes('--enable-nonfree'))
  throw new Error('A nonredistributable media build was selected');
await fs.writeFile(path.join(output, 'FFmpeg-LICENSE.txt'), run(['-L']));
await fs.writeFile(
  path.join(output, 'FFmpeg-SOURCE.txt'),
  [
    'FFmpeg binary supplied by imageio-ffmpeg.',
    `Supplier source: https://github.com/imageio/imageio-ffmpeg/tree/v${version}`,
    'FFmpeg source and license: https://ffmpeg.org/download.html',
    `Package: ${filename}`,
    `SHA-256: ${expected}`,
    url ? `Download: ${url}` : '',
    '',
    build,
  ]
    .filter(Boolean)
    .join('\n'),
);
console.log(`Prepared native media component for ${process.platform}/${process.arch}`);
