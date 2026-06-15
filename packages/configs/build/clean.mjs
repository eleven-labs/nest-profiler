#!/usr/bin/env node
// Cross-platform `rm -rf` for the paths passed as arguments, resolved from cwd.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

for (const arg of process.argv.slice(2)) {
  rmSync(resolve(process.cwd(), arg), { recursive: true, force: true });
}
