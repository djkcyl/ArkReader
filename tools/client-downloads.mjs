import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const partSize = 20_000_000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function clientDownloads(directory, version, sourceCommit) {
  const files = new Map(),
    packages = [],
    sums = [];
  for (const platform of ['windows-x64', 'macos-arm64', 'linux-x64', 'android-arm64']) {
    const record = JSON.parse(
      fs.readFileSync(path.join(directory, `build-${platform}.json`), 'utf8'),
    );
    if (
      record.format !== 1 ||
      record.id !== platform ||
      record.version !== version ||
      record.sourceCommit !== sourceCommit
    )
      throw Error(`Client download provenance mismatch: ${platform}`);
    for (const [name, expected] of Object.entries(record.files)) {
      if (!name.startsWith(`ArkReader-${version}-${platform}`) || !/^[A-Za-z0-9._-]+$/.test(name))
        throw Error(`Unexpected client filename: ${name}`);
      const bytes = fs.readFileSync(path.join(directory, name)),
        hash = sha256(bytes);
      if (hash !== expected || !bytes.length)
        throw Error(`Client download checksum mismatch: ${name}`);
      const parts = [];
      for (let offset = 0; offset < bytes.length; offset += partSize) {
        const data = bytes.subarray(offset, Math.min(bytes.length, offset + partSize));
        const file = `${hash}/${String(parts.length).padStart(3, '0')}.bin`;
        files.set(`downloads/${file}`, data);
        parts.push({ path: file, size: data.length, sha256: sha256(data) });
      }
      packages.push({
        id: name.slice(`ArkReader-${version}-`.length),
        name,
        size: bytes.length,
        sha256: hash,
        parts,
      });
      sums.push(`${hash}  ${name}`);
    }
  }
  files.set(
    'downloads/manifest.json',
    Buffer.from(JSON.stringify({ schema: 1, version, packages }, null, 2) + '\n'),
  );
  files.set('downloads/SHA256SUMS.txt', Buffer.from(sums.sort().join('\n') + '\n'));
  return files;
}
