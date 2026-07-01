import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { HttpRequestEntry } from '@eleven-labs/nest-profiler-http';
import type { CacheOperationEntry } from '@eleven-labs/nest-profiler-cache';
import type { ValidationEntry } from '@eleven-labs/nest-profiler-validator';
import { createE2EApp, profileOf, server } from './helpers/app.js';
import {
  lockNetwork,
  mockJsonPlaceholder,
  unlockNetwork,
  MOCK_POSTS,
} from './helpers/jsonplaceholder.js';

const axiosEntries = (collectors: Record<string, unknown>): HttpRequestEntry[] =>
  (collectors['http-client'] as HttpRequestEntry[] | undefined) ?? [];
const cacheEntries = (collectors: Record<string, unknown>): CacheOperationEntry[] =>
  (collectors['cache'] as CacheOperationEntry[] | undefined) ?? [];
const validatorEntries = (collectors: Record<string, unknown>): ValidationEntry[] =>
  (collectors['validator'] as ValidationEntry[] | undefined) ?? [];

describe('Content endpoints (e2e) — axios + cache + validator collectors', () => {
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
    it('cold call: records outgoing axios requests and a cache MISS + SET', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/articles');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(MOCK_POSTS.length);

      const axios = axiosEntries(profile.collectors);
      // 1 articles fetch + 1 author fetch per distinct userId in the mock data
      expect(axios.length).toBeGreaterThanOrEqual(2);
      expect(axios).toEqual(
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

      const cache = cacheEntries(profile.collectors);
      expect(cache.map((c) => c.operation)).toEqual(expect.arrayContaining(['GET_MISS', 'SET']));
      expect(cache.find((c) => c.operation === 'SET')?.key).toBe('external:articles');

      const phases = (profile.spans ?? []).map((s) => s.phase);
      expect(phases).toEqual(expect.arrayContaining(['http.articles', 'http.articles.authors']));
    });

    it('warm call: served from cache, no axios request', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/articles');

      expect(res.status).toBe(200);
      expect(axiosEntries(profile.collectors)).toHaveLength(0);
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

  describe('POST /articles', () => {
    it('valid body: 201 and a valid validation entry', async () => {
      const { res, profile } = await profileOf(app, 'post', '/api/v1/articles', {
        title: 'A valid article title',
        body: 'A body that is definitely longer than twenty characters.',
        tags: ['nestjs', 'profiler'],
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ title: 'A valid article title' });

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

    it('invalid body: 400 and the violations are captured', async () => {
      const { res, profile } = await profileOf(app, 'post', '/api/v1/articles', {
        title: 'abc', // shorter than MinLength(5)
        body: 'too short', // shorter than MinLength(20)
      });

      expect(res.status).toBe(400);

      const invalid = validatorEntries(profile.collectors).find((e) => e.status === 'invalid');
      expect(invalid).toBeDefined();
      expect(invalid).toMatchObject({ dtoClass: 'CreateArticleDto' });
      expect(invalid!.violationCount).toBeGreaterThanOrEqual(2);
      const properties = invalid!.violations.map((v) => v.property);
      expect(properties).toEqual(expect.arrayContaining(['title', 'body']));
    });
  });

  describe('POST /articles/forward', () => {
    it('captures the outgoing POST with its request and response bodies', async () => {
      const { res, profile } = await profileOf(app, 'post', '/api/v1/articles/forward', {
        title: 'Forwarded article',
        body: 'This body satisfies the MinLength(20) constraint easily.',
      });

      expect(res.status).toBe(201);

      const post = axiosEntries(profile.collectors).find((e) => e.method === 'POST');
      expect(post).toMatchObject({
        url: 'https://jsonplaceholder.typicode.com/posts',
        statusCode: 201,
      });
      expect(post?.requestBody).toMatchObject({ title: 'Forwarded article', userId: 1 });
      expect(post?.responseBody).toBeDefined(); // captureResponseBody: true in ArticleHttpModule
    });
  });

  describe('GET /articles/via-fetch — bring-your-own client (native fetch, no axios)', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    it('records the native fetch call in the HTTP Client panel via HttpProfilerRecorder', async () => {
      const headers = new Headers({ 'content-type': 'application/json', 'x-served-by': 'mock' });
      globalThis.fetch = jest.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 1, title: 'fetched via fetch' }), {
            status: 200,
            headers,
          }),
        ),
      );

      const { res, profile } = await profileOf(app, 'get', '/api/v1/articles/via-fetch');
      expect(res.status).toBe(200);

      const fetched = axiosEntries(profile.collectors).find((e) => e.url.endsWith('/posts/1'));
      expect(fetched).toMatchObject({ method: 'GET', statusCode: 200 });
      expect(fetched?.requestHeaders).toMatchObject({ accept: 'application/json' });
      expect(fetched?.responseHeaders?.['content-type']).toBe('application/json');
      expect(fetched?.responseBody).toEqual({ id: 1, title: 'fetched via fetch' });
    });
  });

  describe('GET /articles/todos/:id', () => {
    it('records the two concurrent axios calls, then a HIT on the second request', async () => {
      const { res, profile } = await profileOf(app, 'get', '/api/v1/articles/todos/7');

      expect(res.status).toBe(200);
      const urls = axiosEntries(profile.collectors).map((e) => e.url);
      expect(urls).toEqual(
        expect.arrayContaining([
          'https://jsonplaceholder.typicode.com/todos/7',
          'https://jsonplaceholder.typicode.com/users/7',
        ]),
      );

      const { profile: warm } = await profileOf(app, 'get', '/api/v1/articles/todos/7');
      expect(axiosEntries(warm.collectors)).toHaveLength(0);
      expect(cacheEntries(warm.collectors).map((c) => c.operation)).toContain('GET_HIT');
    });
  });

  it('GET /articles twice produces distinct profiles listed by the profiler', async () => {
    const first = await request(server(app)).get('/api/v1/articles');
    const second = await request(server(app)).get('/api/v1/articles');
    expect(first.headers['x-debug-token']).not.toBe(second.headers['x-debug-token']);
  });
});
