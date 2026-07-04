#!/usr/bin/env tsx
// Profiler-specific asset build, run after the shared `repo-build`:
//   1. Compile Tailwind (source CSS + scanned templates/TS) into a static stylesheet.
//   2. Vendor highlight.js (core + graphql language + github themes) from npm.
//   3. Bundle the authored client TypeScript (src/client) into a single browser IIFE.
// The output lands in dist/public and is shipped in the npm tarball, so consumers
// need no Tailwind/highlight.js/build tooling at runtime and the UI makes zero
// external requests.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { bundleClient } from '@repo/build/bundle-client';

const require = createRequire(join(process.cwd(), 'package.json'));
const src = join(process.cwd(), 'src');
const publicDir = join(process.cwd(), 'dist', 'public');
const stylesDir = join(publicDir, 'styles');
const scriptsDir = join(publicDir, 'scripts');

mkdirSync(stylesDir, { recursive: true });
mkdirSync(scriptsDir, { recursive: true });

// 1. Compile Tailwind ───────────────────────────────────────────────────────
const cliPkg = require('@tailwindcss/cli/package.json') as { bin: string | Record<string, string> };
const bin = typeof cliPkg.bin === 'string' ? cliPkg.bin : cliPkg.bin.tailwindcss;
const cliBin = join(dirname(require.resolve('@tailwindcss/cli/package.json')), bin);

const compileCss = (input: string, output: string): void => {
  const result = spawnSync(
    process.execPath,
    [cliBin, '-i', join(src, 'public', input), '-o', join(stylesDir, output), '--minify'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// Full dashboard stylesheet (includes Tailwind preflight — only loaded by profiler pages).
compileCss('profiler.css', 'profiler.css');
// Toolbar stylesheet (no preflight, scoped reset — injected into host application pages).
compileCss('toolbar.css', 'toolbar.css');

// 2. Vendor highlight.js ─────────────────────────────────────────────────────
const hljsDir = dirname(require.resolve('@highlightjs/cdn-assets/package.json'));
const copy = (from: string, to: string): void => copyFileSync(join(hljsDir, from), to);

copy('highlight.min.js', join(scriptsDir, 'highlight.min.js'));
copy('languages/graphql.min.js', join(scriptsDir, 'graphql.min.js'));
copy('styles/github.min.css', join(stylesDir, 'github.min.css'));
copy('styles/github-dark.min.css', join(stylesDir, 'github-dark.min.css'));

// 3. Bundle the client TypeScript ─────────────────────────────────────────────
bundleClient({
  entry: join(src, 'client', 'index.ts'),
  outfile: join(scriptsDir, 'profiler.js'),
}).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
