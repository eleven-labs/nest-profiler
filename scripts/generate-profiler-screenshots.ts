#!/usr/bin/env tsx
/**
 * Fully automated profiler screenshot generation — no LLM in the loop.
 *
 * Flow: start the database containers, run the e2e suite (without the stress
 * spec) so every entrypoint kind and collector gets profiled into `.profiler`
 * (file storage), boot the example API against that same `.profiler`, then
 * derive the per-screenshot URLs from the stored profiles and capture them with
 * headless Chrome at a fixed, uniform size (drops straight into a carousel).
 *
 * Run it directly:
 *   pnpm screenshots
 *   tsx scripts/generate-profiler-screenshots.ts
 *
 * Each phase can be skipped for fast iteration (env vars `=1`):
 *   SKIP_DOCKER  reuse already-running containers
 *   SKIP_TESTS   reuse the profiles already in `.profiler`
 *   SKIP_BUILD   reuse the already-built dist/
 *   SKIP_APP     an instance already serves $API_URL (skip boot/teardown)
 *
 * Other env: API_URL, PORT, OUT_DIR, PROFILER_DIR, CHROME_BIN, WIDTH, HEIGHT,
 * VIRTUAL_TIME_BUDGET, SQL_ORM. `mikro-orm.png` is the SQL "database" tab on the
 * MikroORM stack — regenerate it with SQL_ORM=mikro-orm (the default run uses
 * TypeORM, which produces `database.png`).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Invoked from the repo root via `pnpm screenshots` / `tsx scripts/…` (matches the
// other scripts in this directory, which also resolve paths from `process.cwd()`).
const REPO_ROOT = process.cwd();
const API_DIR = join(REPO_ROOT, 'examples/api');

const PORT = process.env.PORT ?? '3000';
const API_URL = process.env.API_URL ?? `http://localhost:${PORT}`;
const PROFILER_URL = `${API_URL}/_profiler`;
const PROFILER_DIR = resolve(process.env.PROFILER_DIR ?? join(API_DIR, '.profiler'));
const OUT_DIR = resolve(process.env.OUT_DIR ?? join(REPO_ROOT, 'docs/public/screenshots/profiler'));
const CHROME_BIN = process.env.CHROME_BIN ?? 'google-chrome';
// The profiler styles itself with the Tailwind browser CDN, compiled at runtime,
// so each capture must give the page enough virtual time to fetch and compile it.
const VIRTUAL_TIME_BUDGET = process.env.VIRTUAL_TIME_BUDGET ?? '12000';
// Every screenshot is the same fixed size — never fitted/cropped to its content.
// `--headless=new` clips to the window (it does not capture the full page), so
// taller pages keep these exact dimensions.
const WIDTH = process.env.WIDTH ?? '1440';
const HEIGHT = process.env.HEIGHT ?? '1000';

const skip = (name: string): boolean => process.env[name] === '1';

interface Profile {
  token: string;
  createdAt?: number;
  entrypoint?: { type?: string; data?: Record<string, unknown> };
  response?: { statusCode?: number };
  exceptions?: unknown[];
  collectors?: Record<string, unknown>;
}

/** Load every stored profile, most-recent first (stable, deterministic pick). */
function loadProfiles(): Profile[] {
  return readdirSync(PROFILER_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f): Profile | null => {
      try {
        return JSON.parse(readFileSync(join(PROFILER_DIR, f), 'utf8')) as Profile;
      } catch {
        return null;
      }
    })
    .filter((p): p is Profile => !!p && typeof p.token === 'string')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const typeOf = (p: Profile): string | undefined => p.entrypoint?.type;
const isHttp = (p: Profile): boolean => typeOf(p) === 'http';
const dataOf = (p: Profile): Record<string, unknown> => p.entrypoint?.data ?? {};
const urlOf = (p: Profile): string => str(dataOf(p).url);
const methodOf = (p: Profile): string => str(dataOf(p).method).toUpperCase();
const statusOf = (p: Profile): number | undefined => p.response?.statusCode;
const exceptionsOf = (p: Profile): number => p.exceptions?.length ?? 0;
const gqlOpOf = (p: Profile): string =>
  str((dataOf(p).graphql as { operationType?: string })?.operationType);
const commandNameOf = (p: Profile): string => str(dataOf(p).name);
const hasCollector = (p: Profile, key: string): boolean => {
  const value = p.collectors?.[key];
  return Array.isArray(value) ? value.length > 0 : !!value && Object.keys(value).length > 0;
};

type Predicate = (p: Profile) => boolean;
const httpGet =
  (url: string): Predicate =>
  (p) =>
    isHttp(p) && methodOf(p) === 'GET' && urlOf(p) === url;

interface Target {
  file: string;
  tab: string;
  /** Tried in order; first matching profile wins (preferred → fallback). */
  preds: Predicate[];
}

// One target per documented view. `tab` is the detail-page query (`?tab=…`); the
// list/global views are captured separately as they need no token lookup.
const TARGETS: Target[] = [
  {
    file: 'request.png',
    tab: 'request',
    preds: [(p) => httpGet('/health')(p) && statusOf(p) === 200, httpGet('/health')],
  },
  {
    file: 'response.png',
    tab: 'response',
    preds: [(p) => httpGet('/health')(p) && statusOf(p) === 200, httpGet('/health')],
  },
  {
    file: 'performance.png',
    tab: 'performance',
    preds: [(p) => httpGet('/health')(p) && statusOf(p) === 200, httpGet('/health')],
  },
  {
    file: 'logs.png',
    tab: 'logs',
    preds: [
      httpGet('/reviews/product/1'),
      (p) => isHttp(p) && urlOf(p).startsWith('/reviews/product/'),
    ],
  },
  { file: 'timeline.png', tab: 'timeline', preds: [httpGet('/slow')] },
  {
    file: 'database.png',
    tab: 'database',
    preds: [(p) => httpGet('/products')(p) && statusOf(p) === 200],
  },
  {
    file: 'mongodb.png',
    tab: 'database',
    preds: [
      (p) => isHttp(p) && urlOf(p) === '/reviews' && hasCollector(p, 'mongoose'),
      (p) => isHttp(p) && methodOf(p) === 'GET' && hasCollector(p, 'mongoose'),
    ],
  },
  {
    file: 'http-client.png',
    tab: 'axios',
    preds: [(p) => isHttp(p) && urlOf(p) === '/posts' && hasCollector(p, 'axios')],
  },
  {
    file: 'cache.png',
    tab: 'cache',
    preds: [(p) => isHttp(p) && urlOf(p) === '/posts' && hasCollector(p, 'cache')],
  },
  {
    file: 'security.png',
    tab: 'auth',
    preds: [(p) => httpGet('/auth/me')(p) && statusOf(p) === 200, httpGet('/auth/me')],
  },
  {
    file: 'validator.png',
    tab: 'validator',
    preds: [
      (p) =>
        isHttp(p) &&
        methodOf(p) === 'POST' &&
        urlOf(p) === '/posts' &&
        statusOf(p) === 400 &&
        hasCollector(p, 'validator'),
      (p) =>
        isHttp(p) && methodOf(p) === 'POST' && statusOf(p) === 400 && hasCollector(p, 'validator'),
    ],
  },
  {
    file: 'exceptions.png',
    tab: 'exceptions',
    preds: [
      (p) => httpGet('/error')(p) && exceptionsOf(p) > 0,
      (p) => isHttp(p) && exceptionsOf(p) > 0,
    ],
  },
  // CLI command (commander entrypoint) — prefer sync:posts, which also exercises axios + cache.
  {
    file: 'command.png',
    tab: 'command',
    preds: [
      (p) => typeOf(p) === 'command' && commandNameOf(p) === 'sync:posts' && statusOf(p) === 200,
      (p) => typeOf(p) === 'command' && statusOf(p) === 200,
    ],
  },
  // GraphQL operations (graphql entrypoint) — query, mutation, and an errored operation.
  {
    file: 'graphql-request.png',
    tab: 'graphql',
    preds: [
      (p) => typeOf(p) === 'graphql' && gqlOpOf(p) === 'query' && exceptionsOf(p) === 0,
      (p) => typeOf(p) === 'graphql' && gqlOpOf(p) === 'query',
    ],
  },
  {
    file: 'graphql-mutation.png',
    tab: 'graphql',
    preds: [
      (p) => typeOf(p) === 'graphql' && gqlOpOf(p) === 'mutation' && exceptionsOf(p) === 0,
      (p) => typeOf(p) === 'graphql' && gqlOpOf(p) === 'mutation',
    ],
  },
  {
    file: 'graphql-error.png',
    tab: 'exceptions',
    preds: [(p) => typeOf(p) === 'graphql' && exceptionsOf(p) > 0],
  },
];

function run(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  execFileSync(command, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? REPO_ROOT,
    env: opts.env ?? process.env,
  });
}

function capture(filename: string, url: string): void {
  execFileSync(
    CHROME_BIN,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--virtual-time-budget=${VIRTUAL_TIME_BUDGET}`,
      `--screenshot=${join(OUT_DIR, filename)}`,
      url,
    ],
    { stdio: 'ignore' },
  );
}

/**
 * Capture a single list-page section on its own. The list renders every section
 * (and the global panels) as sibling, non-nested `<details>` blocks, so we fetch
 * the page, drop every block except the one whose summary holds `title`, force it
 * open, and shoot the local copy (assets are absolute CDN URLs, so file:// renders
 * identically). Used for the GraphQL and Commands section views.
 */
async function captureSection(filename: string, title: string, workDir: string): Promise<void> {
  const html = (await (await fetch(PROFILER_URL)).text()).replace(
    /<details\b[\s\S]*?<\/details>/g,
    (block) => (block.includes(`>${title}<`) ? block.replace('<details', '<details open') : ''),
  );
  const file = join(workDir, filename.replace(/\.png$/, '.html'));
  writeFileSync(file, html);
  capture(filename, `file://${file}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForProfiler(child: ChildProcess, logFile: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(PROFILER_URL);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) {
      throw new Error(`Example API exited during startup:\n${readFileSync(logFile, 'utf8')}`);
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${PROFILER_URL}:\n${readFileSync(logFile, 'utf8')}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'profiler-shots-'));
  let app: ChildProcess | undefined;

  try {
    // 1. Database containers (Postgres/Mongo) the example API and its e2e suite need.
    if (!skip('SKIP_DOCKER')) {
      console.log('▶ Starting database containers (docker compose up -d)…');
      run('docker', ['compose', 'up', '-d']);
    }

    // 2. Populate `.profiler` by running the e2e suite without the stress spec. The
    //    suite empties `.profiler` once at the start and keeps the profiles after.
    if (!skip('SKIP_TESTS')) {
      console.log('▶ Running e2e suite (no stress) to generate profiles…');
      run('pnpm', ['--filter=example-api', 'test:e2e:no-stress']);
    }

    // 3. Boot the compiled example API against the same `.profiler` with the UI open.
    if (!skip('SKIP_APP')) {
      if (!skip('SKIP_BUILD')) {
        console.log('▶ Building packages and the example API…');
        run('pnpm', ['build']);
      }

      console.log(`▶ Starting the example API on port ${PORT}…`);
      const logFile = join(workDir, 'app.log');
      writeFileSync(logFile, ''); // ensure the file exists before we append to it
      app = spawn('node', ['dist/main.js'], {
        cwd: API_DIR,
        env: {
          ...process.env,
          PORT,
          PROFILER_ENABLED: 'true',
          PROFILER_STORAGE_TYPE: 'file',
          PROFILER_STORAGE_PATH: PROFILER_DIR,
          PROFILER_TTL: '86400',
          SQL_ORM: process.env.SQL_ORM ?? 'typeorm',
          FEATURE_MONGOOSE: 'true',
          FEATURE_GRAPHQL: 'true',
          FEATURE_PINO_LOGGER: 'true',
          LOG_LEVEL: 'silent',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const logStream = (chunk: Buffer): void => writeFileSync(logFile, chunk, { flag: 'a' });
      app.stdout?.on('data', logStream);
      app.stderr?.on('data', logStream);

      console.log(`▶ Waiting for ${PROFILER_URL} …`);
      await waitForProfiler(app, logFile);
    }

    // 4. Detail-tab screenshots — tokens derived from the stored profiles.
    console.log('▶ Resolving screenshot targets from stored profiles…');
    const profiles = loadProfiles();
    if (profiles.length === 0) {
      throw new Error(
        `No profiles in ${PROFILER_DIR}. Run \`pnpm --filter=example-api test:e2e:no-stress\` first.`,
      );
    }

    let resolved = 0;
    for (const target of TARGETS) {
      const profile = target.preds.reduce<Profile | undefined>(
        (found, pred) => found ?? profiles.find(pred),
        undefined,
      );
      if (!profile) {
        console.warn(`  ⚠ MISSING ${target.file} (no stored profile matched)`);
        continue;
      }
      console.log(`  • ${target.file}`);
      capture(target.file, `${PROFILER_URL}/${profile.token}?tab=${target.tab}`);
      resolved += 1;
    }

    // 5. List page — `?http_method=DELETE` shows the method filter active over the
    //    DELETE profiles, exercising the per-section filter bar.
    console.log('  • profiles-list.png');
    capture('profiles-list.png', `${PROFILER_URL}?http_method=DELETE`);

    // 6. Per-section list views — each entrypoint kind's table on its own.
    console.log('  • graphql-list.png');
    await captureSection('graphql-list.png', 'GraphQL', workDir);
    console.log('  • command-list.png');
    await captureSection('command-list.png', 'Commands', workDir);

    // 7. Config — a collapsed-by-default global panel. Headless Chrome cannot open a
    //    <details>, so fetch the rendered page, force every disclosure open, and shoot
    //    the local copy (all assets are absolute CDN URLs, so file:// renders identically).
    console.log('  • config.png');
    const html = (await (await fetch(PROFILER_URL)).text()).replace(/<details/g, '<details open');
    const configHtml = join(workDir, 'config.html');
    writeFileSync(configHtml, html);
    capture('config.png', `file://${configHtml}`);

    console.log(
      `▶ Done. ${resolved}/${TARGETS.length} detail targets + list/section/config views → ${OUT_DIR}`,
    );
  } finally {
    if (app?.exitCode === null) {
      app.kill();
    }
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
