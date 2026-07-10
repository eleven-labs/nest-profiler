import { registerAs } from '@nestjs/config';
import { enabled } from './env-condition.js';

// Profiler on by default; disable with PROFILER_ENABLED=false.
export const isProfilerEnabled = enabled('PROFILER_ENABLED', true);

export default registerAs('profiler', () => {
  const storageType = (process.env['PROFILER_STORAGE_TYPE'] ?? 'file') as
    'memory' | 'file' | 'sqlite';
  const persistent = storageType === 'file' || storageType === 'sqlite';
  return {
    enabled: isProfilerEnabled(process.env),
    storageType,
    ...(persistent && {
      // For `file` this is the profiles directory; for `sqlite` it is the database file.
      storagePath:
        process.env['PROFILER_STORAGE_PATH'] ??
        (storageType === 'sqlite' ? '.profiler/profiler.db' : '.profiler'),
      // Seconds before a stored profile expires (default: 3600).
      ttl: parseInt(process.env['PROFILER_TTL'] ?? '3600', 10),
    }),
    maxProfiles: parseInt(process.env['PROFILER_MAX_PROFILES'] ?? '200', 10),
    // Remote SQLite database for `sqlite` storage. When `storageUrl` is set, the SQLite adapter
    // targets it instead of the local `storagePath` file — same adapter, no code change.
    storageUrl: process.env['PROFILER_STORAGE_URL'] ?? '',
    storageAuthToken: process.env['PROFILER_STORAGE_AUTH_TOKEN'] ?? '',
    // Collector options driven from config to showcase the collectors' `forRootAsync`
    // (see AuthModule and ProductTypeOrmModule).
    maskUserFields: (process.env['PROFILER_MASK_USER_FIELDS'] ?? 'password,refreshToken')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean),
    slowThreshold: parseInt(process.env['PROFILER_SLOW_QUERY_MS'] ?? '50', 10),
    // Demo access-control credentials, consumed by `resolveProfilerSecurity` (profiling.module.ts)
    // according to the `PROFILER_AUTH` strategy. `basic` uses the user/password pair; `token` uses
    // the token. Empty values leave the dashboard open.
    basicAuth: {
      user: process.env['PROFILER_BASIC_USER'] ?? 'admin',
      password: process.env['PROFILER_BASIC_PASSWORD'] ?? '',
    },
    token: process.env['PROFILER_TOKEN'] ?? '',
  };
});
