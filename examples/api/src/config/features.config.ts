import { registerAs } from '@nestjs/config';

export const isTypeOrmEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_TYPEORM'] !== 'false';
export const isMongooseEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_MONGOOSE'] !== 'false';
export const isGraphQLEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_GRAPHQL'] !== 'false';
// Opt-in (=== 'true') — off by default unlike FEATURE_TYPEORM/FEATURE_MONGOOSE.
export const isPinoLoggerEnabled = (env: NodeJS.ProcessEnv) =>
  env['FEATURE_PINO_LOGGER'] === 'true';

export default registerAs('features', () => ({
  typeorm: isTypeOrmEnabled(process.env),
  mongoose: isMongooseEnabled(process.env),
  graphql: isGraphQLEnabled(process.env),
  pinoLogger: isPinoLoggerEnabled(process.env),
}));
