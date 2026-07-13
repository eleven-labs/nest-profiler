/**
 * Stress checks for the profiler under bursts of traffic.
 *
 * Regression guard for the storage races where profiles written during concurrent
 * requests had their files on disk but never appeared in the /_profiler list, and
 * a loose performance check on the list render once profiles are cached.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { createE2EApp, getProfile, server, tokenOf } from './helpers/app.js';

const CONCURRENT_BURST = 25;
const SEQUENTIAL_CHAIN = 10;

const short = (token: string): string => token.slice(0, 8);

const createProduct = (app: INestApplication, name: string) =>
  request(server(app))
    .post('/graphql')
    .send({
      query: `mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) { id name }
      }`,
      variables: { input: { name, price: 20 } },
      operationName: 'CreateProduct',
    });

describe('Profiler stress (e2e) — concurrent bursts and list integrity', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
    // Bind the listening socket before the bursts: supertest's lazy listen() drops
    // connections (ECONNRESET) when dozens of requests race it on the same server.
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists every profile from a concurrent burst of GraphQL mutations and REST calls', async () => {
    const responses = await Promise.all([
      ...Array.from({ length: CONCURRENT_BURST }, (_, i) =>
        createProduct(app, `Burst Product ${i}`),
      ),
      ...Array.from({ length: CONCURRENT_BURST }, () =>
        request(server(app)).get('/api/v1/products'),
      ),
    ]);

    const tokens = responses.map(tokenOf);
    expect(new Set(tokens).size).toBe(CONCURRENT_BURST * 2);

    // Every profile is individually retrievable…
    const profiles = await Promise.all(tokens.map((t) => getProfile(app, t)));
    expect(profiles).toHaveLength(CONCURRENT_BURST * 2);

    // …and the Profiling list shows the whole burst, none lost to storage races.
    await app.get(ProfilerService).flush();
    const list = await request(server(app)).get('/_profiler').query({ view: 'profiling' });
    expect(list.status).toBe(200);
    for (const token of tokens) {
      expect(list.text).toContain(short(token));
    }
  });

  it('lists every profile from a rapid sequential chain of mutations', async () => {
    const tokens: string[] = [];
    for (let i = 0; i < SEQUENTIAL_CHAIN; i++) {
      tokens.push(tokenOf(await createProduct(app, `Chain Product ${i}`)));
    }

    await app.get(ProfilerService).flush();
    const list = await request(server(app)).get('/_profiler').query({ view: 'profiling' });
    for (const token of tokens) {
      expect(list.text).toContain(short(token));
    }
  });

  it('renders the warm list page quickly once profiles are cached', async () => {
    await request(server(app)).get('/_profiler').query({ view: 'profiling' }); // warm the cache

    const startedAt = Date.now();
    const res = await request(server(app)).get('/_profiler').query({ view: 'profiling' });
    const elapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(200);
    // Deliberately generous bound to stay CI-safe; the actual duration is logged.
    expect(elapsedMs).toBeLessThan(2000);
    console.info(`warm /_profiler list rendered in ${elapsedMs}ms`);
  });
});
