#!/usr/bin/env node
// Shared build for publishable packages: clean dist, compile with tsc, then
// copy non-TS assets (.ejs templates) into dist preserving their structure.
//
// A CommonJS package also gets an ESM build in dist/esm, so an ESM application
// imports ESM throughout and never `require()`s an ES module (NestJS 12's
// packages are ESM). A CommonJS application keeps the CommonJS build: the
// exports map points `import` at dist/esm and `require` at dist.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, sep } from 'node:path';

const cwd = process.cwd();
const src = join(cwd, 'src');
const dist = join(cwd, 'dist');
const esmDist = join(dist, 'esm');

rmSync(dist, { recursive: true, force: true });

const tscBin = createRequire(join(cwd, 'package.json')).resolve('typescript/bin/tsc');
const tsc = (...args) => {
  const run = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json', ...args], {
    stdio: 'inherit',
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
};

tsc();

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

const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
if (manifest.type !== 'module') {
  tsc('--module', 'es2022', '--moduleResolution', 'bundler', '--outDir', esmDist);
  writeFileSync(join(esmDist, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
  for (const file of jsFiles(esmDist)) addCommonJsGlobals(file);
}

function* jsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

// ESM has no `__dirname`, `__filename` or `require`. A file that uses them gets them back, pointed
// at its CommonJS twin in dist: the .ejs templates, the client bundles and `require('../package.json')`
// then resolve to the same files from both builds, which are shipped once.
function addCommonJsGlobals(file) {
  const code = readFileSync(file, 'utf8');
  if (!/\b(__dirname|__filename|require)\b/.test(code)) return;
  const twinDir = relative(dirname(file), join(dist, relative(esmDist, dirname(file))));
  const shim =
    "import { createRequire as __createRequire } from 'node:module';" +
    " import { dirname as __pathDirname, join as __pathJoin } from 'node:path';" +
    " import { fileURLToPath as __fileURLToPath } from 'node:url';" +
    ` const __dirname = __pathJoin(__pathDirname(__fileURLToPath(import.meta.url)), ${JSON.stringify(twinDir.split(sep).join('/'))});` +
    ` const __filename = __pathJoin(__dirname, ${JSON.stringify(basename(file))});` +
    ' const require = __createRequire(__filename);';
  writeFileSync(file, `${shim}\n${code}`);
  // The shim takes one line: shift the source map by one generated line to keep it aligned.
  const mapFile = `${file}.map`;
  if (existsSync(mapFile)) {
    const map = JSON.parse(readFileSync(mapFile, 'utf8'));
    map.mappings = `;${map.mappings}`;
    writeFileSync(mapFile, JSON.stringify(map));
  }
}
