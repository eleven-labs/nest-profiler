import type { INestApplication } from '@nestjs/common';
import type { MongooseQueryEntry } from '@eleven-labs/nest-profiler-mongoose';
import type { ValidationEntry } from '@eleven-labs/nest-profiler-validator';
import { createE2EApp, profileOf } from './helpers/app.js';

const mongooseEntries = (collectors: Record<string, unknown>): MongooseQueryEntry[] =>
  (collectors['mongoose'] as MongooseQueryEntry[] | undefined) ?? [];
const validatorEntries = (collectors: Record<string, unknown>): ValidationEntry[] =>
  (collectors['validator'] as ValidationEntry[] | undefined) ?? [];

describe('Reviews endpoints (e2e) — mongoose collector', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /reviews returns the seeded reviews and records the find query', async () => {
    const { res, profile } = await profileOf(app, 'get', '/api/v1/reviews');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5); // seeded on bootstrap

    const find = mongooseEntries(profile.collectors).find((e) => e.operation === 'find');
    expect(find).toMatchObject({ collection: 'reviews', count: 5 });
    expect(find?.duration).toBeGreaterThanOrEqual(0);
  });

  it('GET /reviews/export streams every document into a CSV and records the streaming cursor', async () => {
    // Anti-regression: every document must reach the CSV — none lost to the cursor instrumentation.
    const list = await profileOf(app, 'get', '/api/v1/reviews');
    const expected = (list.res.body as unknown[]).length;

    const { res, profile } = await profileOf(app, 'get', '/api/v1/reviews/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('id,productId,rating,author');
    expect(lines).toHaveLength(expected + 1); // header + one line per document

    const streamed = mongooseEntries(profile.collectors).find((e) => e.streaming);
    expect(streamed).toMatchObject({ collection: 'reviews', operation: 'find', streaming: true });
    expect(streamed?.duration).toBeGreaterThanOrEqual(0);
  });

  it('GET /reviews/stats records an aggregate query', async () => {
    const { res, profile } = await profileOf(app, 'get', '/api/v1/reviews/stats');

    expect(res.status).toBe(200);
    const stats = res.body as Array<{ productId: string; avgRating: number; count: number }>;
    expect(stats.length).toBeGreaterThanOrEqual(1);
    expect(stats[0]).toMatchObject({
      productId: expect.any(String) as string,
      avgRating: expect.any(Number) as number,
      count: expect.any(Number) as number,
    });

    const aggregate = mongooseEntries(profile.collectors).find((e) => e.operation === 'aggregate');
    expect(aggregate).toMatchObject({ collection: 'reviews' });
  });

  it('GET /reviews/product/:productId records the find with its filter', async () => {
    const { res, profile } = await profileOf(app, 'get', '/api/v1/reviews/product/1');

    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(1);

    const find = mongooseEntries(profile.collectors).find((e) => e.operation === 'find');
    expect(find?.filter).toMatchObject({ productId: '1' });
  });

  it('POST /reviews with a valid body creates the review and validates the DTO', async () => {
    const { res, profile } = await profileOf(app, 'post', '/api/v1/reviews', {
      productId: '9',
      rating: 5,
      comment: 'E2E review',
      author: 'e2e-bot',
      status: 'approved',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ productId: '9', rating: 5 });

    expect(validatorEntries(profile.collectors)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dtoClass: 'CreateReviewDto', status: 'valid' }),
      ]),
    );
  });

  it('POST /reviews with an invalid rating is rejected with captured violations', async () => {
    const { res, profile } = await profileOf(app, 'post', '/api/v1/reviews', {
      productId: '9',
      rating: 42, // above Max(5)
      comment: 'bad rating',
      author: 'e2e-bot',
    });

    expect(res.status).toBe(400);

    const invalid = validatorEntries(profile.collectors).find((e) => e.status === 'invalid');
    expect(invalid).toMatchObject({ dtoClass: 'CreateReviewDto' });
    expect(invalid?.violations.map((v) => v.property)).toContain('rating');
  });

  it('DELETE /reviews/:id records the findOne and delete queries', async () => {
    const created = await profileOf(app, 'post', '/api/v1/reviews', {
      productId: '9',
      rating: 1,
      comment: 'to be deleted',
      author: 'e2e-bot',
    });
    const id = (created.res.body as { id: string }).id;

    const { res, profile } = await profileOf(app, 'delete', `/api/v1/reviews/${id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });

    const operations = mongooseEntries(profile.collectors).map((e) => e.operation);
    expect(operations).toContain('findOne');
    expect(operations.some((op) => /delete/i.test(op))).toBe(true);
  });

  it('GET /reviews/:id with an unknown id captures the NotFoundException', async () => {
    const { res, profile } = await profileOf(
      app,
      'get',
      '/api/v1/reviews/64a1b2c3d4e5f6789abcdef0',
    );

    expect(res.status).toBe(404);
    expect(profile.exceptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'NotFoundException' })]),
    );
  });
});
