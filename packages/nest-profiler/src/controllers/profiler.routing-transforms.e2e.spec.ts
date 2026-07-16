import type { Server } from 'node:http';
import { Controller, Get, RequestMethod, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProfilerModule } from '../nest-profiler.module';
import { ProfilerService } from '../services/nest-profiler.service';
import { ProfilerStorageService } from '../services/profiler-storage.service';
import type { HttpRequestData, Profile } from '../interfaces/profile.interface';

/**
 * The profiler must stay reachable at `/_profiler` whatever the host does to its own routing, and
 * without the host configuring anything. URI versioning used to move it to `/v1/_profiler`; a
 * global prefix used to move it to `/api/v1/_profiler`. Both left the UI's asset links, the
 * injected toolbar and the `X-Debug-Token-Link` header pointing at a path that no longer served it.
 *
 * These tests pin the guarantee from the outside — the entry route, the emitted header, the
 * rendered links, the app's own routes still being transformed, and the profiler declining to
 * profile itself.
 *
 * Regression coverage for #197.
 */

@Controller()
class DummyController {
  @Get('/hello')
  hello(): { message: string } {
    return { message: 'world' };
  }
}

/** Boots an app with the profiler plus a business route, applying `configure` before `init()`. */
async function bootstrap(configure: (app: INestApplication) => void): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ProfilerModule.forRoot({})],
    controllers: [DummyController],
  }).compile();
  const app = moduleRef.createNestApplication();
  configure(app);
  await app.init();
  return app;
}

/** Issues a profiled business request and returns its `X-Debug-Token-Link` header. */
async function profiledRequestLink(app: INestApplication, path: string): Promise<string> {
  const res = await request(app.getHttpServer() as Server).get(path);
  expect(res.status).toBe(200);
  // Persistence is deferred off the response path — drain it before asserting on stored profiles.
  await app.get(ProfilerService).flush();
  const link = res.headers['x-debug-token-link'];
  if (typeof link !== 'string') throw new Error('expected the x-debug-token-link header to be set');
  return link;
}

/** Every stylesheet/script URL the rendered profiler page points at. */
function assetHrefs(html: string): string[] {
  return [...html.matchAll(/(?:href|src)="([^"]*\/__assets\/[^"]*)"/g)]
    .map((m) => m[1])
    .filter((href): href is string => href !== undefined);
}

/**
 * Asserts an asset URL still reaches the profiler's asset route.
 *
 * Deliberately "not 404" rather than 200: the stylesheets are Tailwind-built into `dist/public`,
 * so a suite running against `src` cannot serve their bytes. What is under test here is routing —
 * whether the URL the page emits still lands on the controller once the host has moved the mount
 * point — and a 404 is exactly the failure mode being pinned. Reaching the handler proves it.
 */
async function expectAssetRouteMatches(app: INestApplication, href: string): Promise<void> {
  const res = await request(app.getHttpServer() as Server).get(href);
  expect(res.status).not.toBe(404);
}

describe('ProfilerController routing transforms (#197)', () => {
  describe('with no routing transform', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootstrap(() => {});
    });
    afterAll(async () => await app.close());

    it('serves the UI at /_profiler', async () => {
      await request(app.getHttpServer() as Server)
        .get('/_profiler')
        .expect(200);
    });

    it('points the debug-token link at /_profiler', async () => {
      const link = await profiledRequestLink(app, '/hello');
      expect(link).toMatch(/^\/_profiler\/[0-9a-f-]+$/);
      await request(app.getHttpServer() as Server)
        .get(link)
        .expect(200);
    });
  });

  describe('under URI versioning', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootstrap((a) =>
        a.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' }),
      );
    });
    afterAll(async () => await app.close());

    it('keeps the host app versioning its own routes', async () => {
      await request(app.getHttpServer() as Server)
        .get('/v1/hello')
        .expect(200);
    });

    it('serves the UI at /_profiler, unversioned', async () => {
      await request(app.getHttpServer() as Server)
        .get('/_profiler')
        .expect(200);
    });

    it('does not mount the UI under the default version', async () => {
      await request(app.getHttpServer() as Server)
        .get('/v1/_profiler')
        .expect(404);
    });

    it('emits a debug-token link that resolves', async () => {
      const link = await profiledRequestLink(app, '/v1/hello');
      expect(link).toMatch(/^\/_profiler\/[0-9a-f-]+$/);
      await request(app.getHttpServer() as Server)
        .get(link)
        .expect(200);
    });

    it('renders asset links that stay unversioned and still route', async () => {
      const page = await request(app.getHttpServer() as Server).get('/_profiler');
      const hrefs = assetHrefs(page.text);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href.startsWith('/_profiler/__assets/')).toBe(true);
        await expectAssetRouteMatches(app, href);
      }
    });
  });

  describe('under a global prefix', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootstrap((a) => a.setGlobalPrefix('api/v1'));
    });
    afterAll(async () => await app.close());

    it('keeps the host app prefixing its own routes', async () => {
      await request(app.getHttpServer() as Server)
        .get('/api/v1/hello')
        .expect(200);
    });

    it('serves the UI at /_profiler, outside the prefix', async () => {
      await request(app.getHttpServer() as Server)
        .get('/_profiler')
        .expect(200);
    });

    it('does not mount the UI under the prefix', async () => {
      await request(app.getHttpServer() as Server)
        .get('/api/v1/_profiler')
        .expect(404);
    });

    it('emits a debug-token link outside the prefix that resolves', async () => {
      const link = await profiledRequestLink(app, '/api/v1/hello');
      expect(link).toMatch(/^\/_profiler\/[0-9a-f-]+$/);
      await request(app.getHttpServer() as Server)
        .get(link)
        .expect(200);
    });

    it('renders asset links outside the prefix that still route', async () => {
      const page = await request(app.getHttpServer() as Server).get('/_profiler');
      const hrefs = assetHrefs(page.text);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href.startsWith('/_profiler/__assets/')).toBe(true);
        await expectAssetRouteMatches(app, href);
      }
    });

    it('does not profile its own UI requests', async () => {
      const storage = app.get(ProfilerStorageService);
      await storage.clear();

      await request(app.getHttpServer() as Server)
        .get('/_profiler')
        .expect(200);
      await app.get(ProfilerService).flush();

      const { items } = await storage.query({ filters: [], page: 1, pageSize: 50 });
      const urls = items.map((p) => (p as Profile<HttpRequestData>).entrypoint.data.url);
      expect(urls.filter((u) => u?.includes('_profiler'))).toEqual([]);
    });
  });

  // The profiler excludes itself, but an app may still list it explicitly (as the bundled
  // example app does). The two must not fight: no duplicate entry, same resulting URL.
  describe('under a global prefix that already excludes the profiler', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootstrap((a) =>
        a.setGlobalPrefix('api/v1', {
          exclude: [
            { path: '_profiler', method: RequestMethod.ALL },
            { path: '_profiler/*path', method: RequestMethod.ALL },
          ],
        }),
      );
    });
    afterAll(async () => await app.close());

    it('keeps the UI at the root', async () => {
      await request(app.getHttpServer() as Server)
        .get('/_profiler')
        .expect(200);
    });

    it('emits a debug-token link at the root that resolves', async () => {
      const link = await profiledRequestLink(app, '/api/v1/hello');
      expect(link).toMatch(/^\/_profiler\/[0-9a-f-]+$/);
      await request(app.getHttpServer() as Server)
        .get(link)
        .expect(200);
    });
  });
});
