#!/usr/bin/env node
// Profiler-specific asset build, run after the shared `repo-build`:
//   1. Compile Tailwind (source CSS + scanned templates) into a static stylesheet.
//   2. Vendor highlight.js (core + graphql language + github themes) from npm.
// The output lands in dist/public and is shipped in the npm tarball, so consumers
// need no Tailwind/highlight.js at runtime and the UI makes zero external requests.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
const src = join(process.cwd(), 'src');
const publicDir = join(process.cwd(), 'dist', 'public');
const stylesDir = join(publicDir, 'styles');
const scriptsDir = join(publicDir, 'scripts');

mkdirSync(stylesDir, { recursive: true });
mkdirSync(scriptsDir, { recursive: true });

// 1. Compile Tailwind ───────────────────────────────────────────────────────
const cliPkg = require('@tailwindcss/cli/package.json');
const bin = typeof cliPkg.bin === 'string' ? cliPkg.bin : cliPkg.bin.tailwindcss;
const cliBin = join(dirname(require.resolve('@tailwindcss/cli/package.json')), bin);

const tw = spawnSync(
  process.execPath,
  [
    cliBin,
    '-i',
    join(src, 'public', 'profiler.css'),
    '-o',
    join(stylesDir, 'profiler.css'),
    '--minify',
  ],
  { stdio: 'inherit' },
);
if (tw.status !== 0) process.exit(tw.status ?? 1);

// 2. Vendor highlight.js ─────────────────────────────────────────────────────
const hljsDir = dirname(require.resolve('@highlightjs/cdn-assets/package.json'));
const copy = (from, to) => copyFileSync(join(hljsDir, from), to);

copy('highlight.min.js', join(scriptsDir, 'highlight.min.js'));
copy('languages/graphql.min.js', join(scriptsDir, 'graphql.min.js'));
copy('styles/github.min.css', join(stylesDir, 'github.min.css'));
copy('styles/github-dark.min.css', join(stylesDir, 'github-dark.min.css'));
