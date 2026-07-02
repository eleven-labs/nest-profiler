#!/usr/bin/env tsx
// Bundles the HTTP collector's authored client TypeScript (src/client) into a
// single browser IIFE served same-origin via the core ClientAssetRegistry. Run
// after the shared `repo-build`.
import { join } from 'node:path';
import { bundleClient } from '@repo/build/bundle-client';

const src = join(process.cwd(), 'src');
const scriptsDir = join(process.cwd(), 'dist', 'public', 'scripts');

bundleClient({
  entry: join(src, 'client', 'index.ts'),
  outfile: join(scriptsDir, 'http.js'),
}).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
