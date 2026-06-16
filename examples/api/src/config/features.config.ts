import { registerAs } from '@nestjs/config';

/** SQL ORM backing the products context. Mutually exclusive — they share the same Postgres table. */
export type SqlOrm = 'typeorm' | 'mikro-orm' | 'none';

const SQL_ORMS: SqlOrm[] = ['typeorm', 'mikro-orm', 'none'];

export const getSqlOrm = (env: NodeJS.ProcessEnv): SqlOrm => {
  const value = (env['SQL_ORM'] ?? 'none') as SqlOrm;
  return SQL_ORMS.includes(value) ? value : 'typeorm';
};

/** Condition factory for `ConditionalModule.registerWhen` — evaluated after `.env` is loaded. */
export const isSqlOrm = (orm: SqlOrm) => (env: NodeJS.ProcessEnv) => getSqlOrm(env) === orm;

/** True when a SQL ORM adapter is selected (anything but `none`). */
export const isSqlOrmEnabled = (env: NodeJS.ProcessEnv) => getSqlOrm(env) !== 'none';

export const isMongooseEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_MONGOOSE'] !== 'false';
export const isGraphQLEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_GRAPHQL'] !== 'false';
// Opt-in (=== 'true') — off by default unlike FEATURE_TYPEORM/FEATURE_MONGOOSE.
export const isPinoLoggerEnabled = (env: NodeJS.ProcessEnv) =>
  env['FEATURE_PINO_LOGGER'] === 'true';
// Opt-in (=== 'true') — off by default; needs a RabbitMQ broker (run: docker compose up -d rabbitmq).
export const isRabbitMqEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_RABBITMQ'] === 'true';

export default registerAs('features', () => ({
  sqlOrm: getSqlOrm(process.env),
  mongoose: isMongooseEnabled(process.env),
  graphql: isGraphQLEnabled(process.env),
  pinoLogger: isPinoLoggerEnabled(process.env),
  rabbitmq: isRabbitMqEnabled(process.env),
}));
