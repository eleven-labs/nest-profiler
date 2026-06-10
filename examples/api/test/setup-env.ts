/**
 * Runs before each spec file's imports (jest `setupFiles`). This is the only safe place to set
 * feature env vars: `ProfilerModule.forRootAsync({ enabled })` and the `ConditionalModule`
 * predicates read `process.env` when `app.module.ts` / `cli.module.ts` are imported or compiled.
 */
import * as path from 'node:path';

process.env['NODE_ENV'] = 'test';

// Every feature flag on — the suite exercises all collectors.
process.env['PROFILER_ENABLED'] = 'true';
process.env['SQL_ORM'] ??= 'typeorm'; // CI matrix overrides with mikro-orm
process.env['FEATURE_MONGOOSE'] = 'true';
process.env['FEATURE_GRAPHQL'] = 'true';
process.env['FEATURE_PINO_LOGGER'] = 'true';
// Mute pino's stdout in tests; the profiler's logger adapter records entries before
// pino applies its level filter, so `profile.logs` assertions still work.
process.env['LOG_LEVEL'] = 'silent';

// File storage in the example's own `.profiler` dir — emptied once per run (test/global-setup.ts)
// and kept afterwards so the recorded profiles can be browsed by starting the server. The HTTP
// apps and the CLI module all share it (cross-process FileStorageAdapter).
process.env['PROFILER_STORAGE_TYPE'] = 'file';
process.env['PROFILER_STORAGE_PATH'] = path.resolve(__dirname, '..', '.profiler');
// Long TTL so the recorded profiles stay browsable well after the run (server default is 1h).
process.env['PROFILER_TTL'] = '86400';

// Keep the /_profiler UI open in tests.
delete process.env['PROFILER_TOKEN'];

// Infra defaults match docker-compose.yml and the CI service containers; `??=` keeps them
// overridable. A local `.env` cannot leak: dotenv never overrides already-set values.
process.env['DATABASE_HOST'] ??= 'localhost';
process.env['DATABASE_PORT'] ??= '5432';
process.env['DATABASE_USER'] ??= 'profiler';
process.env['DATABASE_PASSWORD'] ??= 'profiler';
process.env['DATABASE_NAME'] ??= 'profiler_example';
process.env['MONGODB_URI'] ??= 'mongodb://localhost:27017/profiler_example';
