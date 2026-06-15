#!/usr/bin/env node
// Shared build for publishable packages: clean dist, compile with tsc, then
// copy non-TS assets (.ejs templates) into dist preserving their structure.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

const cwd = process.cwd();
const src = join(cwd, 'src');
const dist = join(cwd, 'dist');

rmSync(dist, { recursive: true, force: true });

const tscBin = createRequire(join(cwd, 'package.json')).resolve('typescript/bin/tsc');
const tsc = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json'], {
  stdio: 'inherit',
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const copyAssets = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      copyAssets(full);
    } else if (entry.name.endsWith('.ejs')) {
      const dest = join(dist, relative(src, full));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(full, dest);
    }
  }
};

try {
  copyAssets(src);
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
