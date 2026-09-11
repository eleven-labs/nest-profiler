import { registerAs } from '@nestjs/config';
import { enabled, labeledCondition, type EnvCondition } from './env-condition.js';

/**
 * Persistence backing the catalog context. Both adapters map the same Postgres `products` table and
 * are mutually exclusive, so the catalog always needs a database — run `docker compose up -d postgres`
 * (or point `DATABASE_*` at a hosted one) before starting the app.
 */
export type SqlOrm = 'typeorm' | 'mikro-orm';

const SQL_ORMS: SqlOrm[] = ['typeorm', 'mikro-orm'];

export const getSqlOrm = (env: NodeJS.ProcessEnv): SqlOrm => {
  const value = (env['SQL_ORM'] ?? 'mikro-orm') as SqlOrm;
  return SQL_ORMS.includes(value) ? value : 'mikro-orm';
};

/** Condition factory for `ConditionalModule.registerWhen` — evaluated after `.env` is loaded. */
export const isSqlOrm = (orm: SqlOrm): EnvCondition =>
  labeledCondition(`SQL_ORM=${orm}`, (env) => getSqlOrm(env) === orm);

/**
 * HTTP client backing the content context's {@link ArticleGateway}. Both talk to the same external
 * API and are profiled the same way — `axios` (via `@nestjs/axios` `HttpService`, the default) or
 * native `fetch` — so switching only changes which profiler adapter captures the calls.
 */
export type HttpClient = 'axios' | 'fetch';

const HTTP_CLIENTS: HttpClient[] = ['axios', 'fetch'];

export const getHttpClient = (env: NodeJS.ProcessEnv): HttpClient => {
  const value = (env['HTTP_CLIENT'] ?? 'axios') as HttpClient;
  return HTTP_CLIENTS.includes(value) ? value : 'axios';
};

/** Condition factory for `ConditionalModule.registerWhen` — evaluated after `.env` is loaded. */
export const isHttpClient = (client: HttpClient): EnvCondition =>
  labeledCondition(`HTTP_CLIENT=${client}`, (env) => getHttpClient(env) === client);

/**
 * Access control guarding the profiler dashboard — selected by env exactly like {@link getSqlOrm},
 * to showcase the pluggable `security` option. `none` (default) leaves /_profiler open; `basic` uses
 * HTTP Basic auth; `token` accepts a bearer or `?token=` credential; and `cookie` reuses the app's
 * `JwtAuthGuard` through the profiler's `security.guards` — the guard reads the JWT from a cookie the
 * browser sends on every link (or a Bearer header for API clients), so the whole UI is navigable.
 * `basic`/`token` read the secret from `PROFILER_BASIC_*` / `PROFILER_TOKEN`. Off by default so the
 * demo dashboard runs open.
 */
export type ProfilerAuth = 'none' | 'basic' | 'token' | 'cookie';

const PROFILER_AUTHS: ProfilerAuth[] = ['none', 'basic', 'token', 'cookie'];

export const getProfilerAuth = (env: NodeJS.ProcessEnv): ProfilerAuth => {
  const value = (env['PROFILER_AUTH'] ?? 'none') as ProfilerAuth;
  return PROFILER_AUTHS.includes(value) ? value : 'none';
};

// The remaining infrastructure-dependent features are opt-in (=== 'true'), so only the catalog's
// database is required to boot. Local dev / e2e turn the flags on explicitly.
export const isMongooseEnabled = enabled('FEATURE_MONGOOSE');
// GraphQL rides on the catalog the app already loads, so it is on by default.
export const isGraphQLEnabled = enabled('FEATURE_GRAPHQL', true);
// JSON logs by default, the shape a deployed app actually ships; set it to `false` for the
// Nest ConsoleLogger.
export const isPinoLoggerEnabled = enabled('FEATURE_PINO_LOGGER', true);
// Needs a RabbitMQ broker (run: docker compose up -d rabbitmq).
export const isRabbitMqEnabled = enabled('FEATURE_RABBITMQ');
// Batches the GraphQL author lookups (`Review.author`) into a single HTTP call. Off by default so
// the demo query keeps its observable N+1; turn it on to compare the two waterfalls.
export const isDataloaderEnabled = enabled('FEATURE_DATALOADER');

export default registerAs('features', () => ({
  sqlOrm: getSqlOrm(process.env),
  httpClient: getHttpClient(process.env),
  profilerAuth: getProfilerAuth(process.env),
  mongoose: isMongooseEnabled(process.env),
  graphql: isGraphQLEnabled(process.env),
  pinoLogger: isPinoLoggerEnabled(process.env),
  rabbitmq: isRabbitMqEnabled(process.env),
  dataloader: isDataloaderEnabled(process.env),
}));
