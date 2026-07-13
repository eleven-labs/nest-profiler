import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { activeSqlOrm, createE2EApp, server, tokenOf } from './helpers/app.js';

const short = (token: string): string => token.slice(0, 8);

describe('Profiler UI (e2e) — list page, filters and detail tabs', () => {
  let app: INestApplication;
  let healthToken: string;
  let slowToken: string;
  let errorToken: string;
  let productsToken: string;
  let createToken: string;
  let graphqlToken: string;

  beforeAll(async () => {
    app = await createE2EApp();

    // Generate one profile per shape the filters discriminate on.
    healthToken = tokenOf(await request(server(app)).get('/health'));
    slowToken = tokenOf(await request(server(app)).get('/api/v1/slow'));
    errorToken = tokenOf(await request(server(app)).get('/api/v1/error'));
    productsToken = tokenOf(await request(server(app)).get('/api/v1/products'));
    createToken = tokenOf(
      await request(server(app)).post('/api/v1/products').send({ name: 'UI fixture', price: 10 }),
    );
    graphqlToken = tokenOf(
      await request(server(app)).post('/graphql').send({ query: '{ products { id } }' }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /_profiler (list page)', () => {
    it('renders the recent profiles', async () => {
      const res = await request(server(app)).get('/_profiler').query({ view: 'profiling' });

      expect(res.status).toBe(200);
      expect(res.text).toContain('<!DOCTYPE html>');
      expect(res.text).toContain('Recent Profiles');
      expect(res.text).toContain(short(healthToken));
      expect(res.text).toContain(short(graphqlToken));
    });

    it('defaults to the Summary view with an aggregated overview', async () => {
      const res = await request(server(app)).get('/_profiler');

      expect(res.status).toBe(200);
      // The sidebar lists Summary (default) and Profiling; the Summary pane shows its cards.
      expect(res.text).toContain('>Summary<');
      expect(res.text).toContain('>Profiling<');
      expect(res.text).toContain('Error rate');
      expect(res.text).toContain('slowest endpoints');
    });

    // The global-scope Schema collector contributes its own sidebar view; the home page
    // lists it, and the view renders the registered entities and their columns/relations.
    it('renders the global Schema panel in its sidebar view for the active ORM', async () => {
      const isMikro = activeSqlOrm() === 'mikro-orm';
      const label = isMikro ? 'Schema · MikroORM' : 'Schema · TypeORM';
      const viewKey = isMikro ? 'mikro-orm-schema' : 'typeorm-schema';

      // The sidebar on the home page links to the Schema view.
      const home = await request(server(app)).get('/_profiler');
      expect(home.text).toContain(label);
      expect(home.text).toContain(`view=${viewKey}`);

      // The view itself renders the panel: the Product entity and its backing table.
      const res = await request(server(app)).get('/_profiler').query({ view: viewKey });
      expect(res.text).toContain(label);
      expect(res.text).toContain('Product');
      expect(res.text).toContain('products');
    });

    // Each list has its own filter bar, so filter params are namespaced by the
    // section key (`http_…` for the HTTP list, `graphql_…` for the GraphQL list).
    it('filters by HTTP method', async () => {
      const res = await request(server(app))
        .get('/_profiler')
        .query({ view: 'profiling', http_method: 'POST' });

      expect(res.text).toContain(short(createToken));
      expect(res.text).not.toContain(short(healthToken));
    });

    it('filters by status code and status class', async () => {
      const byExact = await request(server(app))
        .get('/_profiler')
        .query({ view: 'profiling', http_status: '400' });
      expect(byExact.text).toContain(short(errorToken));
      expect(byExact.text).not.toContain(short(healthToken));

      const byClass = await request(server(app))
        .get('/_profiler')
        .query({ view: 'profiling', http_statusClass: '4' });
      expect(byClass.text).toContain(short(errorToken));
      expect(byClass.text).not.toContain(short(productsToken));
    });

    it('filters by free-text search', async () => {
      const res = await request(server(app))
        .get('/_profiler')
        .query({ view: 'profiling', http_q: 'health' });

      expect(res.text).toContain(short(healthToken));
      expect(res.text).not.toContain(short(errorToken));
    });

    it('filters by the errors checkbox', async () => {
      // The engine tags a profile carrying an unhandled exception `error`; the dedicated
      // "errors" checkbox replaces the former "exceptions" filter.
      const res = await request(server(app))
        .get('/_profiler')
        .query({ view: 'profiling', http_error: '1' });

      expect(res.text).toContain(short(errorToken));
      expect(res.text).not.toContain(short(healthToken));
    });

    it('filters by minimum duration', async () => {
      // /slow sleeps 60ms — /health responds in a few ms.
      const res = await request(server(app))
        .get('/_profiler')
        .query({ view: 'profiling', http_minDuration: '55' });

      expect(res.text).toContain(short(slowToken));
      expect(res.text).not.toContain(short(healthToken));
    });

    it('lists each entrypoint kind in its own section with independent filters', async () => {
      // Both kinds show on the unfiltered Profiling view, each in its own section.
      const all = await request(server(app)).get('/_profiler').query({ view: 'profiling' });
      expect(all.text).toContain(short(healthToken));
      expect(all.text).toContain(short(graphqlToken));

      // Filters are scoped to a single section: narrowing the HTTP list to POST
      // drops the GET health profile while leaving the GraphQL section untouched.
      const httpPost = await request(server(app))
        .get('/_profiler')
        .query({ view: 'profiling', http_method: 'POST' });
      expect(httpPost.text).toContain(short(graphqlToken));
      expect(httpPost.text).not.toContain(short(healthToken));
    });
  });

  describe('GET /_profiler/:token (detail page)', () => {
    it('renders the default request tab', async () => {
      const res = await request(server(app)).get(`/_profiler/${healthToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('<!DOCTYPE html>');
      expect(res.text).toContain(short(healthToken));
    });

    it('renders built-in tabs (performance, logs, exceptions)', async () => {
      for (const tab of ['performance', 'logs', 'exceptions']) {
        const res = await request(server(app)).get(`/_profiler/${errorToken}`).query({ tab });
        expect(res.status).toBe(200);
        expect(res.text).toContain('<!DOCTYPE html>');
      }
    });

    it(`renders the grouped database tab backed by the ${activeSqlOrm()} collector`, async () => {
      const res = await request(server(app))
        .get(`/_profiler/${productsToken}`)
        .query({ tab: 'database' });

      expect(res.status).toBe(200);
      expect(res.text).toContain('<!DOCTYPE html>');
    });

    it('renders the validator tab for a profiled POST', async () => {
      const res = await request(server(app))
        .get(`/_profiler/${createToken}`)
        .query({ tab: 'validator' });

      expect(res.status).toBe(200);
      expect(res.text).toContain('<!DOCTYPE html>');
    });

    it('returns 404 for an unknown profile', async () => {
      const res = await request(server(app)).get('/_profiler/ffffffff-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });
  });
});
