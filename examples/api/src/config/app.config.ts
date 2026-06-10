import { registerAs } from '@nestjs/config';

export const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] !== 'false';

export default registerAs('app', () => {
  const profilerStorageType = (process.env['PROFILER_STORAGE_TYPE'] ?? 'file') as 'memory' | 'file';
  return {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    env: process.env['NODE_ENV'] ?? 'development',
    profilerEnabled: isProfilerEnabled(process.env),
    profilerStorageType,
    ...(profilerStorageType === 'file' && {
      profilerStoragePath: process.env['PROFILER_STORAGE_PATH'] ?? '.profiler',
      // Seconds before a stored profile expires (FileStorageAdapter default: 3600).
      profilerTtl: parseInt(process.env['PROFILER_TTL'] ?? '3600', 10),
    }),
    profilerMaxProfiles: parseInt(process.env['PROFILER_MAX_PROFILES'] ?? '200', 10),
  };
});
