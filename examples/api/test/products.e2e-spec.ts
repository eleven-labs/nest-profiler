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
