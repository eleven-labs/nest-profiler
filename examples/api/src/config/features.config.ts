import { registerAs } from '@nestjs/config';

export const isTypeOrmEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_TYPEORM'] !== 'false';
export const isMongooseEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_MONGOOSE'] !== 'false';
export const isGraphQLEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_GRAPHQL'] !== 'false';

export default registerAs('features', () => ({
  typeorm: isTypeOrmEnabled(process.env),
  mongoose: isMongooseEnabled(process.env),
  graphql: isGraphQLEnabled(process.env),
}));
