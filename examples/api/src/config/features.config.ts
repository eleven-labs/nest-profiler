import { registerAs } from '@nestjs/config';

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
export const isSqlOrm = (orm: SqlOrm) => (env: NodeJS.ProcessEnv) => getSqlOrm(env) === orm;

// All infrastructure-dependent features are opt-in (=== 'true') so a bare deploy with no
// database/broker (Vercel) still boots on the minimal set: catalog (in-memory), content (HTTP),
// auth, health, diagnostics and GraphQL. Local dev / e2e turn the flags on explicitly.
export const isMongooseEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_MONGOOSE'] === 'true';
// GraphQL needs no infrastructure (served over the in-memory catalog), so it is on by default.
export const isGraphQLEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_GRAPHQL'] !== 'false';
export const isPinoLoggerEnabled = (env: NodeJS.ProcessEnv) =>
  env['FEATURE_PINO_LOGGER'] === 'true';
// Needs a RabbitMQ broker (run: docker compose up -d rabbitmq).
export const isRabbitMqEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_RABBITMQ'] === 'true';

export default registerAs('features', () => ({
  sqlOrm: getSqlOrm(process.env),
  mongoose: isMongooseEnabled(process.env),
  graphql: isGraphQLEnabled(process.env),
  pinoLogger: isPinoLoggerEnabled(process.env),
  rabbitmq: isRabbitMqEnabled(process.env),
}));
