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
 * Two views can't share the main pass and get their own reboots afterwards:
 * `mikro-orm.png` (the catalog binds one SQL adapter per boot, so MikroORM runs
 * with SQL_ORM=mikro-orm) and the RabbitMQ shots (`rabbitmq.png` /
 * `rabbitmq-list.png`, which need the broker on and a consumed message). Each
 * boots with its own flags + storage and drives a single request.
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
 * VIRTUAL_TIME_BUDGET, SQL_ORM. The main pass uses TypeORM (`database.png`); the
 * MikroORM and RabbitMQ passes run automatically after it whenever this script
 * manages the app (they need the Postgres/RabbitMQ containers up).
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
  tags?: Array<{ id?: string }>;
}

/** Load every stored profile in `dir`, most-recent first (stable, deterministic pick). */
function loadProfilesFrom(dir: string): Profile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f): Profile | null => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8')) as Profile;
      } catch {
        return null;
      }
    })
    .filter((p): p is Profile => !!p && typeof p.token === 'string')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** The default run reads the shared `.profiler` populated by the e2e suite. */
const loadProfiles = (): Profile[] => loadProfilesFrom(PROFILER_DIR);

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
const hasTag = (p: Profile, id: string): boolean => (p.tags ?? []).some((t) => t.id === id);

// When ONLY is set (comma-separated file names), capture just those files and skip
// the rest (including the extra MikroORM/RabbitMQ reboots) — used to refresh a single
// view without regenerating the whole carousel.
const ONLY = (process.env.ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const wanted = (file: string): boolean => ONLY.length === 0 || ONLY.includes(file);

const isPost = (p: Profile): boolean => isHttp(p) && methodOf(p) === 'POST';
const bodyOf = (p: Profile): unknown => dataOf(p).body;

type Predicate = (p: Profile) => boolean;
const httpGet =
  (url: string): Predicate =>
  (p) =>
    isHttp(p) && methodOf(p) === 'GET' && urlOf(p) === url;

// Business routes are served under the app's global prefix; `/health` and the
// profiler UI are excluded, so they keep their bare paths.
const api = (path: string): string => `/api/v1${path}`;

interface Target {
  file: string;
  tab: string;
  /** Optional grouped-panel sub-tab to activate (e.g. `mongoose` within Database). */
  subtab?: string;
  /** Tried in order; first matching profile wins (preferred → fallback). */
  preds: Predicate[];
}

// One target per documented view. `tab` is the detail-page query (`?tab=…`); the
// list/global views are captured separately as they need no token lookup.
const TARGETS: Target[] = [
  {
    // A create with a rich JSON body — the Request tab shows the method, headers
    // and the full body, far more telling than a bare GET /health.
    file: 'request.png',
    tab: 'request',
    preds: [
      (p) => isPost(p) && urlOf(p) === api('/reviews') && statusOf(p) === 201,
      (p) => isPost(p) && urlOf(p) === api('/products') && statusOf(p) === 201,
      (p) => isPost(p) && bodyOf(p) !== undefined && (statusOf(p) ?? 0) < 400,
    ],
  },
  {
    file: 'response.png',
    tab: 'response',
    preds: [(p) => httpGet('/health')(p) && statusOf(p) === 200, httpGet('/health')],
  },
  {
    // /slow has a real, colored duration (nested spans + artificial delay);
    // /health is ~0ms, so its Performance tab is empty of signal.
    file: 'performance.png',
    tab: 'performance',
    preds: [httpGet(api('/slow'))],
  },
  {
    // The cold /articles call logs a structured payload (author/cache counts)
    // alongside plain messages. The MISS profile made the axios author calls, so
    // it carries the http-client collector — that distinguishes it from a HIT.
    file: 'logs.png',
    tab: 'logs',
    preds: [
      (p) => httpGet(api('/articles'))(p) && hasCollector(p, 'http-client'),
      httpGet(api('/articles')),
    ],
  },
  { file: 'timeline.png', tab: 'timeline', preds: [httpGet(api('/slow'))] },
  {
    file: 'database.png',
    tab: 'database',
    preds: [(p) => httpGet(api('/products'))(p) && statusOf(p) === 200],
  },
  {
    // A silent zero-row write — PATCH /products/:id with a non-matching id issues an
    // UPDATE that affects 0 rows, flagged by the `zero-rows` tag. The Database panel
    // shows the Performance banner ("No rows"), the amber `0 rows` metadata and the
    // connection chip.
    file: 'database-zero-rows.png',
    tab: 'database',
    preds: [
      (p) => isHttp(p) && methodOf(p) === 'PATCH' && hasTag(p, 'zero-rows'),
      (p) => hasTag(p, 'zero-rows'),
    ],
  },
  {
    file: 'mongodb.png',
    tab: 'database',
    preds: [
      (p) => isHttp(p) && urlOf(p) === api('/reviews') && hasCollector(p, 'mongoose'),
      (p) => isHttp(p) && methodOf(p) === 'GET' && hasCollector(p, 'mongoose'),
    ],
  },
  {
    file: 'http-client.png',
    tab: 'http-client',
    preds: [(p) => isHttp(p) && urlOf(p) === api('/articles') && hasCollector(p, 'http-client')],
  },
  {
    file: 'cache.png',
    tab: 'cache',
    preds: [(p) => isHttp(p) && urlOf(p) === api('/articles') && hasCollector(p, 'cache')],
  },
  {
    file: 'security.png',
    tab: 'auth',
    preds: [(p) => httpGet(api('/auth/me'))(p) && statusOf(p) === 200, httpGet(api('/auth/me'))],
  },
  {
    file: 'validator.png',
    tab: 'validator',
    preds: [
      (p) =>
        isHttp(p) &&
        methodOf(p) === 'POST' &&
        urlOf(p) === api('/articles') &&
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
      (p) => httpGet(api('/error'))(p) && exceptionsOf(p) > 0,
      (p) => isHttp(p) && exceptionsOf(p) > 0,
    ],
  },
  // CLI command (commander entrypoint) — prefer content:sync, which also exercises the HTTP client + cache.
  {
    file: 'command.png',
    tab: 'command',
    preds: [
      (p) => typeOf(p) === 'command' && commandNameOf(p) === 'content:sync' && statusOf(p) === 200,
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
  // Performance tags — the `{ products { reviews } }` query lists products (SQL root
  // resolver) then resolves each product's reviews from MongoDB (field resolver), an
  // N+1 pattern. The Database tab shows the Performance banner, the severity-coloured
  // Database sub-tabs and the N+1 pills; captured on the tagged graphql profile.
  {
    file: 'performance-tags-detail.png',
    tab: 'database',
    // Land on the MongoDB sub-tab, where the per-row N+1 pills live.
    subtab: 'mongoose',
    preds: [
      (p) =>
        typeOf(p) === 'graphql' &&
        gqlOpOf(p) === 'query' &&
        hasTag(p, 'n-plus-one') &&
        hasCollector(p, 'mongoose'),
      (p) => typeOf(p) === 'graphql' && hasTag(p, 'n-plus-one'),
      (p) => hasTag(p, 'n-plus-one'),
    ],
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
 * The profiler serves its CSS/JS from same-origin absolute paths
 * (`/_profiler/__assets/…`), so a saved `file://` copy would load unstyled. Inject
 * a `<base href="${API_URL}/">` so every relative asset resolves against the
 * running app instead. (The app is up throughout capture.)
 */
const withBase = (html: string): string =>
  html.replace('<head>', `<head><base href="${API_URL}/">`);

/**
 * Capture a single list-page section on its own. The list renders every section
 * (and the global panels) as sibling, non-nested `<details>` blocks, so we fetch
 * the page, drop every block except the one whose summary holds `title`, force it
 * open, rewrite asset URLs with a `<base>`, and shoot the local copy. Used for the
 * GraphQL and Commands section views.
 */
async function captureSection(
  filename: string,
  title: string,
  workDir: string,
  query = '',
): Promise<void> {
  const html = withBase(
    (await (await fetch(`${PROFILER_URL}${query}`)).text()).replace(
      /<details\b[\s\S]*?<\/details>/g,
      (block) => (block.includes(`>${title}<`) ? block.replace('<details', '<details open') : ''),
    ),
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

/**
 * Boot the compiled example API on $PORT with the profiler on (file storage at
 * `storagePath`) and wait for the UI to answer. `extraEnv` carries the per-pass
 * feature flags (SQL_ORM, FEATURE_*). Passes run sequentially on the same port,
 * so stop the previous app before booting the next.
 */
async function bootApp(
  logFile: string,
  storagePath: string,
  extraEnv: Record<string, string>,
): Promise<ChildProcess> {
  writeFileSync(logFile, ''); // ensure the file exists before we append to it
  const app = spawn('node', ['dist/main.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      PORT,
      PROFILER_ENABLED: 'true',
      PROFILER_STORAGE_TYPE: 'file',
      PROFILER_STORAGE_PATH: storagePath,
      PROFILER_TTL: '86400',
      LOG_LEVEL: 'silent',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logStream = (chunk: Buffer): void => writeFileSync(logFile, chunk, { flag: 'a' });
  app.stdout?.on('data', logStream);
  app.stderr?.on('data', logStream);
  console.log(`▶ Waiting for ${PROFILER_URL} …`);
  await waitForProfiler(app, logFile);
  return app;
}

function stopApp(app: ChildProcess | undefined): void {
  if (app?.exitCode === null) app.kill();
}

/**
 * Poll `dir` until a stored profile matches `pred`. Profiler persistence is
 * deferred, so a just-triggered request lands a moment later; the MikroORM and
 * RabbitMQ passes drive one request into their own storage, then wait for it.
 */
async function waitForProfileIn(dir: string, pred: Predicate): Promise<Profile> {
  for (let i = 0; i < 30; i += 1) {
    const match = loadProfilesFrom(dir).find(pred);
    if (match) return match;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for a matching profile in ${dir}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'profiler-shots-'));
  const logFile = join(workDir, 'app.log');
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
      app = await bootApp(logFile, PROFILER_DIR, {
        SQL_ORM: process.env.SQL_ORM ?? 'typeorm',
        FEATURE_MONGOOSE: 'true',
        FEATURE_GRAPHQL: 'true',
        FEATURE_PINO_LOGGER: 'true',
      });
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
      if (!wanted(target.file)) continue;
      const profile = target.preds.reduce<Profile | undefined>(
        (found, pred) => found ?? profiles.find(pred),
        undefined,
      );
      if (!profile) {
        console.warn(`  ⚠ MISSING ${target.file} (no stored profile matched)`);
        continue;
      }
      console.log(`  • ${target.file}`);
      const subtab = target.subtab ? `&subtab=${target.subtab}` : '';
      capture(target.file, `${PROFILER_URL}/${profile.token}?tab=${target.tab}${subtab}`);
      resolved += 1;
    }

    // 5. List page — `?http_method=DELETE` shows the method filter active over the
    //    DELETE profiles, exercising the per-section filter bar.
    if (wanted('profiles-list.png')) {
      console.log('  • profiles-list.png');
      capture('profiles-list.png', `${PROFILER_URL}?http_method=DELETE`);
    }

    // 6. Per-section list views — each entrypoint kind's table on its own.
    if (wanted('graphql-list.png')) {
      console.log('  • graphql-list.png');
      await captureSection('graphql-list.png', 'GraphQL', workDir);
    }
    if (wanted('command-list.png')) {
      console.log('  • command-list.png');
      await captureSection('command-list.png', 'Commands', workDir);
    }

    // Performance-tag filter — the GraphQL list narrowed to the profiles carrying the
    // `n-plus-one` tag, showing the tag select active and the N+1 pills on rows.
    if (wanted('performance-tags-filter.png')) {
      console.log('  • performance-tags-filter.png');
      await captureSection(
        'performance-tags-filter.png',
        'GraphQL',
        workDir,
        '?graphql_tag=n-plus-one',
      );
    }

    // 7. Config — a collapsed-by-default global panel. Headless Chrome cannot open a
    //    <details>, so fetch the rendered page, force every disclosure open, rewrite
    //    asset URLs with a <base>, and shoot the local copy.
    if (wanted('config.png')) {
      console.log('  • config.png');
      const html = withBase(
        (await (await fetch(PROFILER_URL)).text()).replace(/<details/g, '<details open'),
      );
      const configHtml = join(workDir, 'config.html');
      writeFileSync(configHtml, html);
      capture('config.png', `file://${configHtml}`);
    }

    // The next two passes reboot the app with different feature flags, so they
    // only run when this script manages the app (not under SKIP_APP) and when their
    // views are wanted (an ONLY run for other files skips these costly reboots).
    if (!skip('SKIP_APP') && wanted('mikro-orm.png')) {
      // 8. MikroORM Database panel — the catalog binds exactly one SQL adapter
      //    per boot, so the MikroORM query panel needs its own run
      //    (SQL_ORM=mikro-orm) against fresh storage. Drive one GET /products
      //    and shoot the Database tab as `mikro-orm.png` (mirrors database.png,
      //    which the TypeORM main pass produces).
      console.log('  • mikro-orm.png (SQL_ORM=mikro-orm pass)');
      stopApp(app);
      app = undefined;
      const mikroDir = mkdtempSync(join(tmpdir(), 'profiler-mikro-'));
      try {
        app = await bootApp(logFile, mikroDir, {
          SQL_ORM: 'mikro-orm',
          FEATURE_MONGOOSE: 'false',
          FEATURE_GRAPHQL: 'false',
          FEATURE_PINO_LOGGER: 'false',
        });
        await fetch(`${API_URL}${api('/products')}`);
        const mikro = await waitForProfileIn(
          mikroDir,
          (p) => httpGet(api('/products'))(p) && hasCollector(p, 'mikro-orm'),
        );
        capture('mikro-orm.png', `${PROFILER_URL}/${mikro.token}?tab=database`);
      } catch (error) {
        console.warn(
          `  ⚠ SKIPPED mikro-orm.png (${error instanceof Error ? error.message : String(error)})`,
        );
      } finally {
        stopApp(app);
        app = undefined;
        rmSync(mikroDir, { recursive: true, force: true });
      }
    }

    // 9. RabbitMQ delivery — @RabbitSubscribe messages become their own
    //    profiles (the `rabbitmq` entrypoint). Boot with the broker on, POST a
    //    review to publish `review.created`, wait for the consumer's delivery
    //    profile, then shoot its Message detail tab and the RabbitMQ list
    //    section (mirrors command.png / command-list.png).
    if (!skip('SKIP_APP') && (wanted('rabbitmq.png') || wanted('rabbitmq-list.png'))) {
      console.log('  • rabbitmq.png + rabbitmq-list.png (FEATURE_RABBITMQ pass)');
      const rmqDir = mkdtempSync(join(tmpdir(), 'profiler-rmq-'));
      try {
        app = await bootApp(logFile, rmqDir, {
          SQL_ORM: 'in-memory',
          FEATURE_MONGOOSE: 'true',
          FEATURE_RABBITMQ: 'true',
          FEATURE_GRAPHQL: 'false',
          FEATURE_PINO_LOGGER: 'false',
        });
        await fetch(`${API_URL}${api('/reviews')}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            productId: '64a1b2c3d4e5f6789abcdef0',
            rating: 5,
            comment: 'Great product, highly recommended!',
            author: 'Jane Doe',
            status: 'approved',
          }),
        });
        const delivery = await waitForProfileIn(rmqDir, (p) => typeOf(p) === 'rabbitmq');
        capture('rabbitmq.png', `${PROFILER_URL}/${delivery.token}?tab=message`);
        await captureSection('rabbitmq-list.png', 'RabbitMQ', workDir);
      } catch (error) {
        console.warn(
          `  ⚠ SKIPPED rabbitmq shots (${error instanceof Error ? error.message : String(error)})`,
        );
      } finally {
        stopApp(app);
        app = undefined;
        rmSync(rmqDir, { recursive: true, force: true });
      }
    }

    console.log(
      `▶ Done. ${resolved}/${TARGETS.length} detail targets + list/section/config + MikroORM/RabbitMQ passes → ${OUT_DIR}`,
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
