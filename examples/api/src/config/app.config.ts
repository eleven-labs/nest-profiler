import { registerAs } from '@nestjs/config';
import { profilerEnabled } from './profiler-enabled';

export default registerAs('app', () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  env: process.env['NODE_ENV'] ?? 'development',
  profilerEnabled,
  profilerMaxProfiles: parseInt(process.env['PROFILER_MAX_PROFILES'] ?? '200', 10),
}));
