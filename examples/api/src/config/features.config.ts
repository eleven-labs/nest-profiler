import { registerAs } from '@nestjs/config';

export const isTypeOrmEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_TYPEORM'] !== 'false';
export const isMongooseEnabled = (env: NodeJS.ProcessEnv) => env['FEATURE_MONGOOSE'] !== 'false';

export default registerAs('features', () => ({
  typeorm: isTypeOrmEnabled(process.env),
  mongoose: isMongooseEnabled(process.env),
}));
