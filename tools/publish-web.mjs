import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { clientDownloads } from './client-downloads.mjs';

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  }).trim();
const archive = path.resolve(process.argv[2]);
const sourceCommit = process.argv[3];
const preview = process.argv.includes('--preview');
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? ''))
  throw Error('An exact build source commit is required');
const entries = run('unzip', ['-Z', '-1', archive])
  .split(/\r?\n/)
  .filter((name) => name && !name.endsWith('/'));
if (entries.length > 1000 || new Set(entries).size !== entries.length)
  throw Error('Invalid Web archive');
for (const name of entries)
  if (
    name.startsWith('/') ||
    name.includes('\\') ||
    /[\t\r\0]/.test(name) ||
    name.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')
  )
    throw Error('Unsafe Web archive path');
const read = (name) =>
  execFileSync('unzip', ['-p', archive, name], { maxBuffer: 128 * 1024 * 1024 });
const build = JSON.parse(read('build.json'));
if (build.version !== version || build.sourceCommit !== sourceCommit)
  throw Error('Web build identity mismatch');
if (!!build.preview !== preview) throw Error('Web preview mode mismatch');
if (!/^engine\/[a-f0-9]{64}\/$/.test(build.engine ?? ''))
  throw Error('Web engine identity missing');
for (const name of [
  'index.html',
  'sw.js',
  build.engine + 'arkreader-web.js',
  build.engine + 'arkreader_web.wasm',
])
  if (!entries.includes(name)) throw Error('Missing Web asset: ' + name);
const files = new Map(entries.map((name) => ['site/' + name, read(name)]));
const downloadsArg = process.argv.indexOf('--downloads-dir');
if (downloadsArg !== -1) {
  const directory = process.argv[downloadsArg + 1];
  if (!directory) throw Error('Missing client download directory');
  for (const [name, bytes] of clientDownloads(path.resolve(directory), version, sourceCommit))
    files.set('site/' + name, bytes);
}
for (const [name, bytes] of files)
  if (bytes.length > 25_000_000) throw Error(`Static hosting file limit exceeded: ${name}`);
const pkg = {
  name: 'arkreader-web-deploy',
  version,
  private: true,
  scripts: { build: 'node build.mjs' },
};
files.set('package.json', JSON.stringify(pkg, null, 2) + '\n');
files.set(
  'package-lock.json',
  JSON.stringify(
    {
      name: pkg.name,
      version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: pkg.name, version } },
    },
    null,
    2,
  ) + '\n',
);
files.set(
  'build.mjs',
  `import fs from 'node:fs';\nconst output = new URL('./dist/', import.meta.url);\nfs.rmSync(output, { recursive: true, force: true });\nfs.cpSync(new URL('./site/', import.meta.url), output, { recursive: true });\n`,
);
files.set(
  'README.md',
  `# ArkReader ${version}${preview ? ' · Web 预览' : ''}\n\n${preview ? '此分支当前为临时网页验证版，不对应新的正式发行。' : '此分支保存已通过发行验证的静态站点。'}仅保留一个提交。\n\nMakers 等静态托管平台：\n\n- 生产分支：\`web\`\n- 框架：Other\n- 根目录：\`./\`\n- 安装命令：\`npm ci\`\n- 构建命令：\`npm run build\`\n- 输出目录：\`dist\`\n\n[源码](https://github.com/djkcyl/ArkReader/tree/${sourceCommit}) · [下载](https://github.com/djkcyl/ArkReader/releases/tag/v${version})\n`,
);
if (process.argv.includes('--verify-only')) {
  const check = path.resolve('artifacts/web-deploy-check');
  fs.mkdirSync(check, { recursive: true });
  for (const [name, bytes] of files) {
    const file = path.join(check, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  run(process.execPath, [path.join(check, 'build.mjs')]);
  for (const [name, bytes] of files)
    if (
      name.startsWith('site/') &&
      !fs.readFileSync(path.join(check, 'dist', name.slice(5))).equals(Buffer.from(bytes))
    )
      throw Error('Deployment copy differs: ' + name);
  console.log('Deployment build preserves every verified static asset.');
  process.exit(0);
}

const tree = new Map();
for (const [name, bytes] of files) {
  let directory = tree;
  const parts = name.split('/');
  for (const part of parts.slice(0, -1)) {
    if (!directory.has(part)) directory.set(part, new Map());
    directory = directory.get(part);
    if (!(directory instanceof Map)) throw Error('Conflicting Web archive paths');
  }
  directory.set(parts.at(-1), run('git', ['hash-object', '-w', '--stdin'], { input: bytes }));
}
function writeTree(directory) {
  return run('git', ['mktree'], {
    input: [...directory]
      .map(
        ([name, value]) =>
          `${value instanceof Map ? '040000 tree' : '100644 blob'} ${value instanceof Map ? writeTree(value) : value}\t${name}\n`,
      )
      .join(''),
  });
}
const webTree = writeTree(tree);
const remote = run('git', ['ls-remote', 'origin', 'refs/heads/web']);
const previous = remote ? remote.split(/\s+/)[0] : null;
if (previous) run('git', ['fetch', '--no-tags', 'origin', 'refs/heads/web']);
if (
  previous &&
  run('git', ['rev-parse', `${previous}^{tree}`]) === webTree &&
  run('git', ['rev-list', '--parents', '-n', '1', previous]).split(/\s+/).length === 1
) {
  console.log('Web deployment already matches this build.');
  process.exit(0);
}
const commit = run('git', [
  ...(preview
    ? []
    : [
        '-c',
        'user.name=github-actions[bot]',
        '-c',
        'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      ]),
  'commit-tree',
  webTree,
  '-m',
  `${preview ? 'Preview' : 'Deploy'} ArkReader ${version} from ${sourceCommit}`,
]);
run('git', [
  'push',
  `--force-with-lease=refs/heads/web:${previous ?? ''}`,
  'origin',
  `${commit}:refs/heads/web`,
]);
console.log(`Published Web deployment ${commit} with one root commit.`);
