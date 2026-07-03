import { registerAs } from '@nestjs/config';
import { enabledUnlessFalse } from './env-condition.js';

// Profiler on by default; disable with PROFILER_ENABLED=false.
export const isProfilerEnabled = enabledUnlessFalse('PROFILER_ENABLED');

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
  };
});
