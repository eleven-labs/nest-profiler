/**
 * Runs before each spec file's imports (jest `setupFiles`). This is the only safe place to set
 * feature env vars: the `ConditionalModule.registerWhen` predicates (profiler included) read
 * `process.env` when `app.module.ts` / `cli.module.ts` are imported or compiled.
 */
import * as path from 'node:path';

process.env['NODE_ENV'] = 'test';

// Every feature flag on — the suite exercises all collectors.
process.env['PROFILER_ENABLED'] = 'true';
process.env['SQL_ORM'] ??= 'typeorm'; // CI matrix overrides with mikro-orm
// Content HTTP client backing the ArticleGateway. Default axios; the `test:e2e:http-clients` script
// re-runs the content suite with HTTP_CLIENT=fetch. nock (v14) intercepts both node:http (axios) and
// global fetch (undici), so the exact same suite validates either adapter — only this var changes.
process.env['HTTP_CLIENT'] ??= 'axios';
process.env['FEATURE_MONGOOSE'] = 'true';
process.env['FEATURE_GRAPHQL'] = 'true';
process.env['FEATURE_PINO_LOGGER'] = 'true';
// Mute pino's stdout in tests; the profiler's logger adapter records entries before
// pino applies its level filter, so `profile.logs` assertions still work.
process.env['LOG_LEVEL'] = 'silent';

// Persistent storage in the example's own `.profiler` dir — emptied once per run
// (test/global-setup.ts) and kept afterwards so the recorded profiles can be browsed by starting
// the server. The HTTP apps and the CLI module all share it (cross-process). The backend is
// chosen with `PROFILER_STORAGE_TYPE` (default `file`; the `test:e2e:sqlite` script sets
// `sqlite`) so the exact same suite runs against both — only this env var changes.
const storageType = (process.env['PROFILER_STORAGE_TYPE'] ??= 'file');
process.env['PROFILER_STORAGE_PATH'] ??=
  storageType === 'sqlite'
    ? path.resolve(__dirname, '..', '.profiler', 'profiler.db') // sqlite: the database file
    : path.resolve(__dirname, '..', '.profiler'); // file: the profiles directory
// Long TTL so the recorded profiles stay browsable well after the run (server default is 1h).
process.env['PROFILER_TTL'] = '86400';

// Keep the /_profiler UI open in tests, whatever a local `.env` selects.
process.env['PROFILER_AUTH'] = 'none';
delete process.env['PROFILER_TOKEN'];

// Infra defaults match docker-compose.yml and the CI service containers; `??=` keeps them
// overridable. A local `.env` cannot leak: dotenv never overrides already-set values.
process.env['DATABASE_HOST'] ??= 'localhost';
process.env['DATABASE_PORT'] ??= '5432';
process.env['DATABASE_USER'] ??= 'profiler';
process.env['DATABASE_PASSWORD'] ??= 'profiler';
process.env['DATABASE_NAME'] ??= 'profiler_example';
process.env['MONGODB_URI'] ??= 'mongodb://localhost:27017/profiler_example';
