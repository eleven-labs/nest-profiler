import { registerAs } from '@nestjs/config';

const firstDefined = (...values: Array<string | undefined>): string | undefined =>
  values.find((value) => value !== undefined && value !== '');

const isSslEnabled = (value: string | undefined): boolean =>
  value === 'true' || value === 'require' || value === 'verify-full';

// Reads a boolean env override, falling back to the default when unset/empty.
const boolEnv = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : value === 'true';

export default registerAs('database', () => {
  const sslMode = firstDefined(process.env['DATABASE_SSL'], process.env['PGSSLMODE']);
  const isProduction = process.env['NODE_ENV'] === 'production';

  return {
    host:
      firstDefined(
        process.env['DATABASE_HOST'],
        process.env['POSTGRES_HOST'],
        process.env['PGHOST'],
      ) ?? 'localhost',
    port: parseInt(
      firstDefined(
        process.env['DATABASE_PORT'],
        process.env['POSTGRES_PORT'],
        process.env['PGPORT'],
      ) ?? '5432',
      10,
    ),
    username:
      firstDefined(
        process.env['DATABASE_USER'],
        process.env['POSTGRES_USER'],
        process.env['PGUSER'],
      ) ?? 'profiler',
    password:
      firstDefined(
        process.env['DATABASE_PASSWORD'],
        process.env['POSTGRES_PASSWORD'],
        process.env['PGPASSWORD'],
      ) ?? 'profiler',
    name:
      firstDefined(
        process.env['DATABASE_NAME'],
        process.env['POSTGRES_DATABASE'],
        process.env['PGDATABASE'],
      ) ?? 'profiler_example',
    ssl: isSslEnabled(sslMode),
    // Schema management for the demo (which ships no migrations). Defaults preserve the original
    // behavior — create + destructive drop-and-recreate outside production, neither in production —
    // but each is overridable, so a hosted deploy (Vercel + Neon) can create the schema with
    // `DATABASE_SYNCHRONIZE=true` while leaving the drop off to keep data across cold starts.
    synchronize: boolEnv(process.env['DATABASE_SYNCHRONIZE'], !isProduction),
    dropSchema: boolEnv(process.env['DATABASE_DROP_SCHEMA'], !isProduction),
  };
});
