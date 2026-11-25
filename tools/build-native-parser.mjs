import { build } from 'esbuild';

const outfile = process.argv[2];
if (!outfile) throw new Error('Missing parser output path');
await build({
  entryPoints: ['tools/desktop-parser.ts'],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
});
