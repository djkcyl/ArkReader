import fs from 'node:fs';
const output = new URL('./dist/', import.meta.url);
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(new URL('./site/', import.meta.url), output, { recursive: true });
