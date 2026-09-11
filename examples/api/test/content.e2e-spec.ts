import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { HttpRequestEntry } from '@eleven-labs/nest-profiler-http';
import { sumHttpPhases } from '@eleven-labs/nest-profiler-http';
import type { CacheOperationEntry } from '@eleven-labs/nest-profiler-cache';
import type { ValidationEntry } from '@eleven-labs/nest-profiler-validator';
import { activeHttpClient, createE2EApp, profileOf, server } from './helpers/app.js';
import {
  lockNetwork,
  mockJsonPlaceholder,
  unlockNetwork,
  MOCK_POSTS,
} from './helpers/jsonplaceholder.js';

// The suite is client-agnostic: it runs against whichever ArticleGateway `HTTP_CLIENT` selected
// (axios or fetch) and asserts the same outgoing calls in the shared `http-client` panel. nock (v14)
// intercepts both node:http (axios) and global fetch (undici), so a single mock covers both. The
// `test:e2e:http-clients` script re-runs this file for each client.
const httpEntries = (collectors: Record<string, unknown>): HttpRequestEntry[] =>
  (collectors['http-client'] as HttpRequestEntry[] | undefined) ?? [];
const cacheEntries = (collectors: Record<string, unknown>): CacheOperationEntry[] =>
  (collectors['cache'] as CacheOperationEntry[] | undefined) ?? [];
const validatorEntries = (collectors: Record<string, unknown>): ValidationEntry[] =>
  (collectors['validator'] as ValidationEntry[] | undefined) ?? [];

describe(`Content endpoints (e2e) — ${activeHttpClient()} + cache + validator collectors`, () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
    mockJsonPlaceholder();
    lockNetwork();
  });

  afterAll(async () => {
    unlockNetwork();
    await app.close();
  });

  describe('GET /articles', () => {
    it('cold call: records outgoing HTTP requests and a cache MISS + SET', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/articles');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(MOCK_POSTS.length);

      const http = httpEntries(profile.collectors);
      // 1 articles fetch + 1 author fetch per distinct userId in the mock data
      expect(http.length).toBeGreaterThanOrEqual(2);
      expect(http).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'GET',
            url: expect.stringContaining('jsonplaceholder.typicode.com/posts') as string,
            statusCode: 200,
          }),
          expect.objectContaining({
            method: 'GET',
            url: expect.stringContaining('/users/') as string,
            statusCode: 200,
          }),
        ]),
      );

      // The upstream authenticates by query parameter; the collector masks the sensitive ones
      // at capture, so the key never reaches a stored profile. Asserted on the same cold call
      // rather than in its own test, which would warm the cache and leave this one nothing to see.
      const posts = http.find((entry) => entry.url.includes('/posts?'));
      expect(posts?.url).toContain('api_key=%5BREDACTED%5D');
      expect(posts?.url).toContain('_limit='); // the harmless parameter survives
      expect(JSON.stringify(profile)).not.toContain('demo-upstream-key');

      // Phase breakdown, asserted on the same cold call for the reason above. What the e2e pins is
      // the plumbing — collector → stored profile → trace bar — not the measurement, which is
      // covered against real servers and a real `fetch` in the package's own suite. Two reasons a
      // breakdown is legitimately absent here, and both are the documented degradation rather than
      // a failure:
      //  - nock answers from memory with no wire involved, so every phase can round to 0µs and the
      //    entry then carries no breakdown at all;
      //  - on the fetch run there is never one: nock intercepts `fetch` through undici's MockAgent,
      //    which never dispatches through the client publishing the diagnostics channels
      //    `UndiciPhases` subscribes to.
      if (activeHttpClient() === 'fetch') {
        expect(posts?.phases).toBeUndefined();
      } else if (posts?.phases) {
        expect(sumHttpPhases(posts.phases)).toBeGreaterThan(0);
        expect(Object.values(posts.phases).every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(
          true,
        );

        // The same breakdown reaches the waterfall as labelled extras on the bar.
        const bar = (profile.trace ?? []).find((span) => span.label.includes('/posts?'));
        expect(bar?.meta).toEqual(expect.objectContaining({ status: 200 }));
      }

      const cache = cacheEntries(profile.collectors);
      expect(cache.map((c) => c.operation)).toEqual(expect.arrayContaining(['GET_MISS', 'SET']));
      expect(cache.find((c) => c.operation === 'SET')?.key).toBe('external:articles');

      const phases = (profile.trace ?? []).map((s) => s.label);
      expect(phases).toEqual(expect.arrayContaining(['http.articles', 'http.articles.authors']));
    });

    it('warm call: served from cache, no outgoing request', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/articles');

      expect(res.status).toBe(200);
      expect(httpEntries(profile.collectors)).toHaveLength(0);
      expect(cacheEntries(profile.collectors).map((c) => c.operation)).toContain('GET_HIT');
    });
  });

  describe('GET /articles/cache/clear', () => {
    it('records a cache DEL and forces the next call to MISS again', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/articles/cache/clear');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cleared: true });
      const del = cacheEntries(profile.collectors).find((c) => c.operation === 'DEL');
      expect(del).toMatchObject({ key: 'external:articles' });

      const { profile: coldAgain } = await profileOf(app, 'get', '/api/v1/articles');
      expect(cacheEntries(coldAgain.collectors).map((c) => c.operation)).toContain('GET_MISS');
    });
  });

  describe('POST /articles/forward', () => {
    it('valid body: captures the outgoing POST with its request and response bodies', async () => {
      const { res, profile } = await profileOf(app, 'post', '/api/v1/articles/forward', {
        title: 'Forwarded article',
        body: 'This body satisfies the MinLength(20) constraint easily.',
        tags: ['nestjs', 'profiler'],
      });

      expect(res.status).toBe(201);

      const post = httpEntries(profile.collectors).find((e) => e.method === 'POST');
      expect(post).toMatchObject({
        url: 'https://jsonplaceholder.typicode.com/posts',
        statusCode: 201,
      });
      expect(post?.requestBody).toMatchObject({ title: 'Forwarded article', userId: 1 });
      expect(post?.responseBody).toBeDefined(); // captureResponseBody: true in the active adapter module

      const entries = validatorEntries(profile.collectors);
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dtoClass: 'CreateArticleDto',
            status: 'valid',
            violationCount: 0,
          }),
        ]),
      );
    });

    it('invalid body: 400, violations captured and no outgoing call', async () => {
      const { res, profile } = await profileOf(app, 'post', '/api/v1/articles/forward', {
        title: 'abc', // shorter than MinLength(5)
        body: 'too short', // shorter than MinLength(20)
      });

      expect(res.status).toBe(400);
      // The pipe rejects before the handler runs, so the article never reaches the external API.
      expect(httpEntries(profile.collectors)).toHaveLength(0);

      const invalid = validatorEntries(profile.collectors).find((e) => e.status === 'invalid');
      expect(invalid).toBeDefined();
      expect(invalid).toMatchObject({ dtoClass: 'CreateArticleDto' });
      expect(invalid!.violationCount).toBeGreaterThanOrEqual(2);
      const properties = invalid!.violations.map((v) => v.property);
      expect(properties).toEqual(expect.arrayContaining(['title', 'body']));
    });
  });

  it('GET /articles twice produces distinct profiles listed by the profiler', async () => {
    const first = await request(server(app)).get('/api/v1/articles');
    const second = await request(server(app)).get('/api/v1/articles');
    expect(first.headers['x-debug-token']).not.toBe(second.headers['x-debug-token']);
  });
});
