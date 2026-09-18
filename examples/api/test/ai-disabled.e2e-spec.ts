import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * The AI context off, which is how the app is deployed to Vercel.
 *
 * `ConditionalModule.registerWhen` evaluates its condition when `AppModule` is first loaded, so
 * the flag has to be set before the import — hence a suite of its own, with a dynamic import,
 * rather than another case in the AI suite.
 */
describe('FEATURE_AI=false (e2e)', () => {
  let app: INestApplication;
  let server: (app: INestApplication) => Parameters<typeof request>[0];

  beforeAll(async () => {
    process.env['FEATURE_AI'] = 'false';
    const helpers = await import('./helpers/app.js');
    server = helpers.server;
    app = await helpers.createE2EApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['FEATURE_AI'] = 'true';
  });

  it('serves neither the assistant nor the MCP endpoint it feeds', async () => {
    await request(server(app)).post('/api/v1/ai/ask').send({ prompt: 'hi' }).expect(404);
    await request(server(app))
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      .expect(404);
  });

  it('still serves the rest of the application', async () => {
    await request(server(app)).get('/health').expect(200);
  });
});
