import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createE2EApp } from './helpers/app.js';

describe('Swagger document (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('leaves the profiler routes out without the app excluding them', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const paths = Object.keys(document.paths);

    expect(paths).toContain('/health');
    expect(paths.filter((path) => path.startsWith('/_profiler'))).toEqual([]);
  });
});
