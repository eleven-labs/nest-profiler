import { registerAs } from '@nestjs/config';

export default registerAs('pubsub', () => ({
  projectId: process.env['PUBSUB_PROJECT_ID'] ?? 'profiler-demo',
  // A non-Google endpoint switches the client to emulator mode (plain-text gRPC, no credentials).
  apiEndpoint: process.env['PUBSUB_EMULATOR_HOST'] ?? 'localhost:8085',
}));
