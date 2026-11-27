import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preview = process.argv.includes('--preview');
const sdk = process.env.EMSDK || path.join(root, '.cache/web-build/emsdk');
const emscripten = path.join(sdk, 'upstream/emscripten');
const env = {
  ...process.env,
  EM_CONFIG: process.env.EM_CONFIG || path.join(sdk, '.emscripten'),
  PATH: `${emscripten}${path.delimiter}${process.env.PATH}`,
  VITE_RUNTIME: 'web',
};
if (process.platform === 'win32') {
  for (const key of Object.keys(env))
    if (key !== 'PATH' && key.toUpperCase() === 'PATH') delete env[key];
  const compiler = path.join(emscripten, 'emcc.exe');
  env.CC_wasm32_unknown_emscripten = compiler;
  env.AR_wasm32_unknown_emscripten = path.join(emscripten, 'emar.exe');
  env.CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER = compiler;
}
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...env, ...extra },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const flags = [
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sENVIRONMENT=web,worker',
  '-sALLOW_MEMORY_GROWTH=1',
  '-sMAXIMUM_MEMORY=4GB',
  '-sSTACK_SIZE=8MB',
  '-sEXPORTED_FUNCTIONS=["_main","_ark_init","_ark_poll","_ark_request","_ark_playing","_malloc","_free"]',
  '-sEXPORTED_RUNTIME_METHODS=["FS","HEAPU8"]',
  '-sFORCE_FILESYSTEM=1',
  '-sEXIT_RUNTIME=0',
  '--js-library',
  path.join(root, 'tools/web-library.js').replaceAll('\\', '/'),
];
if (!process.argv.includes('--frontend-only')) {
  run(process.execPath, ['tools/prepare-native.mjs', '--web']);
  run('cargo', [
    'rustc',
    '--locked',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '-p',
    'arkreader-resource-engine',
    '--features',
    'web',
    '--bin',
    'arkreader-web',
    '--target',
    'wasm32-unknown-emscripten',
    '--profile',
    'web',
    '--',
    ...flags.flatMap((flag) => ['-C', `link-arg=${flag}`]),
  ]);
}
const engine = path.join(root, 'src-tauri/target/wasm32-unknown-emscripten/web');
const engineFiles = ['arkreader-web.js', 'arkreader_web.wasm'];
const engineDigest = createHash('sha256');
for (const name of engineFiles)
  engineDigest.update(name).update(await fs.readFile(path.join(engine, name)));
const enginePath = `engine/${engineDigest.digest('hex')}/`;
env.VITE_ENGINE_PATH = enginePath;
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'web']);
const output = path.join(root, 'web-dist');
await fs.rename(path.join(output, 'web.html'), path.join(output, 'index.html'));
await fs.cp(path.join(root, 'src/web/public'), output, { recursive: true });
await fs.mkdir(path.join(output, enginePath), { recursive: true });
for (const name of engineFiles)
  await fs.copyFile(path.join(engine, name), path.join(output, enginePath, name));
await fs.mkdir(path.join(output, 'licenses'), { recursive: true });
await fs.cp(path.join(root, 'licenses'), path.join(output, 'licenses'), { recursive: true });
for (const name of ['FFmpeg-LICENSE.txt', 'FFmpeg-SOURCE.txt'])
  await fs.copyFile(
    path.join(root, 'src-tauri/resources/web-media', name),
    path.join(output, 'licenses', name),
  );
await fs.writeFile(path.join(output, '.nojekyll'), '');
const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).stdout.trim();
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const metadata = {
  version,
  sourceCommit,
  engine: enginePath,
  ...(preview ? { preview: true } : {}),
};
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(metadata, null, 2) + '\n');
await fs.writeFile(
  path.join(output, 'README.txt'),
  `ArkReader ${version}\n\n将本目录原样部署到静态托管服务，通过 HTTPS 访问（本机 localhost 也可以）。\n入口是 index.html，不需要单独运行后端。请勿使用 file:// 直接打开。\n\n源码：https://github.com/djkcyl/ArkReader/tree/${sourceCommit}\n`,
);
const files = [];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else {
      if ((await fs.stat(file)).size > 25_000_000)
        throw Error(`Static asset exceeds the hosting limit (25 MB): ${file}`);
      if (!file.includes(`${path.sep}licenses${path.sep}`))
        files.push(path.relative(output, file).replaceAll('\\', '/'));
    }
  }
}
await collect(output);
const worker = await fs.readFile(path.join(root, 'src/web/service-worker.js'), 'utf8');
const digest = createHash('sha256').update(worker);
for (const file of files.sort())
  digest.update(file).update(await fs.readFile(path.join(output, file)));
const build = digest.digest('hex').slice(0, 24);
// The document and cached manifest identify the same complete application build.
const indexFile = path.join(output, 'index.html');
await fs.writeFile(
  indexFile,
  (await fs.readFile(indexFile, 'utf8')).replace(
    '</head>',
    `  <meta name="arkreader-build" content="${build}" />\n  </head>`,
  ),
);
await fs.writeFile(
  path.join(output, 'build.json'),
  JSON.stringify({ ...metadata, build }, null, 2) + '\n',
);
const precache = {};
for (const file of files)
  precache[file] =
    'sha256-' +
    createHash('sha256')
      .update(await fs.readFile(path.join(output, file)))
      .digest('base64');
await fs.writeFile(
  path.join(output, 'sw.js'),
  `const PRECACHE=${JSON.stringify(precache)};\nconst BUILD=${JSON.stringify(build)};\n${worker}`,
);
console.log(output);
