import { registerAs } from '@nestjs/config';
import { enabled } from './env-condition.js';
import { getProfilerAuth } from './features.config.js';

// Profiler on by default; disable with PROFILER_ENABLED=false.
export const isProfilerEnabled = enabled('PROFILER_ENABLED', true);

export default registerAs('profiler', () => {
  const storageType = (process.env['PROFILER_STORAGE_TYPE'] ?? 'file') as
    'memory' | 'file' | 'sqlite';
  const storageUrl = process.env['PROFILER_STORAGE_URL'] ?? process.env['TURSO_DATABASE_URL'];
  const persistent = (storageType === 'file' || storageType === 'sqlite') && !storageUrl;
  const auth = getProfilerAuth(process.env);
  return {
    enabled: isProfilerEnabled(process.env),
    // Where profiles are persisted — the type and its options travel together, consumed by
    // `resolveStorageOptions` in profiling.module.ts.
    storage: {
      type: storageType,
      ...(persistent && {
        // For `file` this is the profiles directory; for `sqlite` it is the database file.
        path:
          process.env['PROFILER_STORAGE_PATH'] ??
          (storageType === 'sqlite' ? '.profiler/profiler.db' : '.profiler'),
        // Seconds before a stored profile expires (default: 3600).
        ttl: parseInt(process.env['PROFILER_TTL'] ?? '3600', 10),
      }),
      maxProfiles: parseInt(process.env['PROFILER_MAX_PROFILES'] ?? '200', 10),
      // Remote SQLite database for `sqlite` storage. When `url` is set, the SQLite adapter targets
      // it instead of the local `path` file — same adapter, no code change. Falls back to the Vercel
      // Turso integration's TURSO_DATABASE_URL / TURSO_AUTH_TOKEN so the hosted demo runs on Turso
      // without re-aliasing those variables.
      ...(storageUrl && {
        url: process.env['PROFILER_STORAGE_URL'] ?? process.env['TURSO_DATABASE_URL'] ?? '',
        authToken:
          process.env['PROFILER_STORAGE_AUTH_TOKEN'] ?? process.env['TURSO_AUTH_TOKEN'] ?? '',
      }),
    },
    // Who can reach the dashboard. `auth` picks the strategy (mirrors `PROFILER_AUTH`, see
    // features.config.ts); only the secret the active strategy reads is present — `basicAuth` for
    // `basic`, `token` for `token` (`none`/`cookie` need neither). Consumed by
    // `resolveProfilerSecurity` in profiling.module.ts. Empty secrets leave the dashboard open.
    security: {
      auth,
      ...(auth === 'basic' && {
        basicAuth: {
          user: process.env['PROFILER_BASIC_USER'] ?? 'admin',
          password: process.env['PROFILER_BASIC_PASSWORD'] ?? '',
        },
      }),
      ...(auth === 'token' && {
        token: process.env['PROFILER_TOKEN'] ?? '',
      }),
    },
    // Thresholds the query collectors use to tag work in the UI (see `TypeOrmCollectorModule`).
    performance: {
      // Queries at or above this duration (ms) are tagged `slow`.
      slowThreshold: parseInt(process.env['PROFILER_SLOW_QUERY_MS'] ?? '50', 10),
      // Identical queries repeated at least this many times in one request are tagged `n-plus-one`.
      nPlusOneThreshold: parseInt(process.env['PROFILER_N_PLUS_ONE_THRESHOLD'] ?? '2', 10),
      // A request running at least this many queries is tagged `chatty`.
      chattyThreshold: parseInt(process.env['PROFILER_CHATTY_THRESHOLD'] ?? '20', 10),
    },
    // Collector option driven from config to showcase the collectors' `forRootAsync` (see AuthModule).
    maskUserFields: (process.env['PROFILER_MASK_USER_FIELDS'] ?? 'password,refreshToken')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean),
  };
});
