import type { INestApplication } from '@nestjs/common';
import type { QueryEntry } from '@eleven-labs/nest-profiler';
import type { ValidationEntry } from '@eleven-labs/nest-profiler-validator';
import { activeSqlOrm, createE2EApp, inactiveSqlOrm, profileOf } from './helpers/app.js';

const ormKey = activeSqlOrm();

const sqlEntries = (collectors: Record<string, unknown>): QueryEntry[] =>
  (collectors[ormKey] as QueryEntry[] | undefined) ?? [];
const validatorEntries = (collectors: Record<string, unknown>): ValidationEntry[] =>
  (collectors['validator'] as ValidationEntry[] | undefined) ?? [];

describe(`Products endpoints (e2e) — ${ormKey} collector`, () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /products returns the seeded products and records SELECT queries', async () => {
    const { res, profile } = await profileOf(app, 'get', '/api/v1/products');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4); // seeded on bootstrap

    const entries = sqlEntries(profile.collectors);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.every((e) => typeof e.sql === 'string' && e.duration >= 0)).toBe(true);
    expect(entries.some((e) => e.type === 'SELECT')).toBe(true);

    // The other ORM's collector must not be registered in this run.
    expect(profile.collectors[inactiveSqlOrm()]).toBeUndefined();

    const phases = (profile.spans ?? []).map((s) => s.phase);
    expect(phases).toContain('db.products.findAll');
  });

  it('GET /products/export streams every row into a CSV and records the streaming read', async () => {
    // Anti-regression: every row must reach the CSV — no rows lost to the streaming instrumentation.
    const list = await profileOf(app, 'get', '/api/v1/products');
    const expected = (list.res.body as unknown[]).length;

    const { res, profile } = await profileOf(app, 'get', '/api/v1/products/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('id,name,price');
    expect(lines).toHaveLength(expected + 1); // header + one line per row

    // Both ORMs flag the streamed SELECT: TypeORM via QueryRunner.stream(), MikroORM via a SELECT
    // logged without `took`. TypeORM measures the duration; MikroORM keeps it at 0 (documented).
    const streamed = sqlEntries(profile.collectors).find((e) => e.streaming === true);
    expect(streamed?.type).toBe('SELECT');
    if (ormKey === 'mikro-orm') expect(streamed?.duration).toBe(0);
  });

  it('GET /products/:id records the lookup query', async () => {
    const list = await profileOf(app, 'get', '/api/v1/products');
    const firstId = (list.res.body as Array<{ id: number }>)[0]!.id;

    const { res, profile } = await profileOf(app, 'get', `/api/v1/products/${firstId}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: firstId });
    expect(sqlEntries(profile.collectors).some((e) => e.type === 'SELECT')).toBe(true);
  });

  it('GET /products/:id with an unknown id captures the NotFoundException', async () => {
    const { res, profile } = await profileOf(app, 'get', '/api/v1/products/999999');

    expect(res.status).toBe(404);
    expect(profile.exceptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'NotFoundException' })]),
    );
  });

  it('POST /products inserts the product and validates the DTO', async () => {
    const { res, profile } = await profileOf(app, 'post', '/api/v1/products', {
      name: 'E2E Keyboard',
      price: 49.99,
      description: 'Created by the e2e suite',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'E2E Keyboard' });

    expect(sqlEntries(profile.collectors).some((e) => e.type === 'INSERT')).toBe(true);
    expect(validatorEntries(profile.collectors)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dtoClass: 'CreateProductDto', status: 'valid' }),
      ]),
    );
  });

  it('POST /products with a negative price is rejected with captured violations', async () => {
    const { res, profile } = await profileOf(app, 'post', '/api/v1/products', {
      name: 'Broken product',
      price: -5,
    });

    expect(res.status).toBe(400);

    const invalid = validatorEntries(profile.collectors).find((e) => e.status === 'invalid');
    expect(invalid).toMatchObject({ dtoClass: 'CreateProductDto' });
    expect(invalid?.violations.map((v) => v.property)).toContain('price');
  });

  it('PATCH /products/:id updates one row and records the affected rowCount', async () => {
    const created = await profileOf(app, 'post', '/api/v1/products', {
      name: 'Updatable product',
      price: 10,
    });
    const id = (created.res.body as { id: number }).id;

    const { res, profile } = await profileOf(app, 'patch', `/api/v1/products/${id}`, {
      price: 12,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });

    const update = sqlEntries(profile.collectors).find((e) => e.type === 'UPDATE');
    expect(update?.rowCount).toBe(1);
    // Every captured query carries the connection metadata derived from the DataSource / ORM config.
    const anyEntry = sqlEntries(profile.collectors)[0];
    expect(anyEntry).toBeDefined();
    expect('database' in anyEntry! || 'connection' in anyEntry!).toBe(true);
    // A successful single-row update is not a silent failure.
    expect((update?.tags ?? []).some((t) => t.id === 'zero-rows')).toBe(false);
  });

  it('PATCH /products/:id with an unknown id affects 0 rows and is flagged zero-rows', async () => {
    const { res, profile } = await profileOf(app, 'patch', '/api/v1/products/999999', {
      price: 99,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });

    const update = sqlEntries(profile.collectors).find((e) => e.type === 'UPDATE');
    expect(update?.rowCount).toBe(0);
    expect((update?.tags ?? []).some((t) => t.id === 'zero-rows')).toBe(true);
    // The tag carries its (default) severity, which drives the UI colouring.
    expect((update?.tags ?? []).find((t) => t.id === 'zero-rows')?.severity).toBe('warning');
    // The silent-failure tag also aggregates onto the profile (drives the list filter).
    expect((profile.tags ?? []).some((t) => t.id === 'zero-rows')).toBe(true);
    expect((profile.tags ?? []).find((t) => t.id === 'zero-rows')?.severity).toBe('warning');
  });

  it('DELETE /products/:id records the DELETE query', async () => {
    const created = await profileOf(app, 'post', '/api/v1/products', {
      name: 'Disposable product',
      price: 1,
    });
    const id = (created.res.body as { id: number }).id;

    const { res, profile } = await profileOf(app, 'delete', `/api/v1/products/${id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(sqlEntries(profile.collectors).some((e) => e.type === 'DELETE')).toBe(true);
  });
});
