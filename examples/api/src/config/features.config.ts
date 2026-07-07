import { registerAs } from '@nestjs/config';
import {
  enabledUnlessFalse,
  enabledWhenTrue,
  labeledCondition,
  type EnvCondition,
} from './env-condition.js';

/**
 * Persistence backing the catalog context. `typeorm`/`mikro-orm` share the same Postgres table;
 * `in-memory` needs no infrastructure and is the default so the app runs out of the box (and on
 * serverless deploys like Vercel, where there is no database).
 */
export type SqlOrm = 'typeorm' | 'mikro-orm' | 'in-memory';

const SQL_ORMS: SqlOrm[] = ['typeorm', 'mikro-orm', 'in-memory'];

export const getSqlOrm = (env: NodeJS.ProcessEnv): SqlOrm => {
  const value = (env['SQL_ORM'] ?? 'in-memory') as SqlOrm;
  return SQL_ORMS.includes(value) ? value : 'in-memory';
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

// All infrastructure-dependent features are opt-in (=== 'true') so a bare deploy with no
// database/broker (Vercel) still boots on the minimal set: catalog (in-memory), content (HTTP),
// auth, health, diagnostics and GraphQL. Local dev / e2e turn the flags on explicitly.
export const isMongooseEnabled = enabledWhenTrue('FEATURE_MONGOOSE');
// GraphQL needs no infrastructure (served over the in-memory catalog), so it is on by default.
export const isGraphQLEnabled = enabledUnlessFalse('FEATURE_GRAPHQL');
export const isPinoLoggerEnabled = enabledWhenTrue('FEATURE_PINO_LOGGER');
// Needs a RabbitMQ broker (run: docker compose up -d rabbitmq).
export const isRabbitMqEnabled = enabledWhenTrue('FEATURE_RABBITMQ');

export default registerAs('features', () => ({
  sqlOrm: getSqlOrm(process.env),
  httpClient: getHttpClient(process.env),
  mongoose: isMongooseEnabled(process.env),
  graphql: isGraphQLEnabled(process.env),
  pinoLogger: isPinoLoggerEnabled(process.env),
  rabbitmq: isRabbitMqEnabled(process.env),
}));
