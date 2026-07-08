import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { HttpRequestData } from '@eleven-labs/nest-profiler';
import type { MongooseQueryEntry } from '@eleven-labs/nest-profiler-mongoose';
import type { ValidationEntry } from '@eleven-labs/nest-profiler-validator';
import { activeSqlOrm, createE2EApp, getProfile, server, tokenOf } from './helpers/app.js';

const validatorEntries = (collectors: Record<string, unknown>): ValidationEntry[] =>
  (collectors['validator'] as ValidationEntry[] | undefined) ?? [];
const mongooseEntries = (collectors: Record<string, unknown>): MongooseQueryEntry[] =>
  (collectors['mongoose'] as MongooseQueryEntry[] | undefined) ?? [];

interface GqlBody {
  data?: Record<string, unknown> | null;
  errors?: unknown[];
}

const gql = (
  app: INestApplication,
  body: { query: string; variables?: Record<string, unknown>; operationName?: string },
) => request(server(app)).post('/graphql').send(body);

describe('GraphQL endpoint (e2e) — graphql + validator collectors', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('anonymous query: captures operation type, field name and resolver spans', async () => {
    const res = await gql(app, { query: '{ products { id name price } }' });

    expect(res.status).toBe(200);
    const { data } = res.body as { data: { products: unknown[] } };
    expect(data.products.length).toBeGreaterThanOrEqual(4);

    const profile = await getProfile<HttpRequestData>(app, tokenOf(res));
    expect(profile.entrypoint.data.graphql).toMatchObject({
      operationType: 'query',
      fieldName: 'products',
    });
    expect((profile.spans ?? []).map((s) => s.phase)).toContain('db.products.findAll');
  });

  it('resolving Product.reviews (field resolver) captures SQL and MongoDB in one profile', async () => {
    // A single GraphQL query lists products (SQL ORM, root resolver) and resolves each product's
    // reviews from MongoDB (field resolver). Field resolvers run after the root resolver returns, so
    // this exercises the deferred-collection fix: both database collectors must appear in one profile.
    const res = await gql(app, { query: '{ products { id reviews { rating author } } }' });

    expect(res.status).toBe(200);
    const { data } = res.body as {
      data: { products: Array<{ id: string; reviews: Array<{ rating: number }> }> };
    };
    // Products 1-3 are seeded with reviews; at least one product resolves a non-empty list.
    expect(data.products.some((p) => p.reviews.length > 0)).toBe(true);

    const profile = await getProfile<HttpRequestData>(app, tokenOf(res));

    // SQL side: the catalog list query ran under the active ORM (root resolver).
    expect((profile.spans ?? []).map((s) => s.phase)).toContain('db.products.findAll');
    expect(
      (profile.collectors[activeSqlOrm()] as unknown[] | undefined)?.length ?? 0,
    ).toBeGreaterThan(0);

    // Mongo side: one `find({ productId })` per resolved product, captured by the mongoose collector
    // even though it runs in a field resolver.
    const finds = mongooseEntries(profile.collectors).filter((e) => e.operation === 'find');
    expect(finds.length).toBeGreaterThan(0);
    expect(finds[0]).toMatchObject({ collection: 'reviews' });
    expect(finds.some((e) => e.filter && 'productId' in e.filter)).toBe(true);
  });

  it('named query with variables: captures operationName and variables', async () => {
    const res = await gql(app, {
      query: 'query GetProduct($id: Int!) { product(id: $id) { id name } }',
      variables: { id: 1 },
      operationName: 'GetProduct',
    });

    expect(res.status).toBe(200);
    const { data } = res.body as { data: { product: { id: string; name: string } } };
    expect(data.product).toMatchObject({ id: '1', name: 'NestJS Pro License' });

    const profile = await getProfile<HttpRequestData>(app, tokenOf(res));
    expect(profile.entrypoint.data.graphql).toMatchObject({
      operationType: 'query',
      operationName: 'GetProduct',
      fieldName: 'product',
      variables: { id: 1 },
    });
    expect(profile.entrypoint.data.graphql?.query).toContain('GetProduct');
  });

  it('mutation: creates a product and validates the input type', async () => {
    const res = await gql(app, {
      query: `mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) { id name price }
      }`,
      variables: { input: { name: 'E2E Product', price: 42 } },
      operationName: 'CreateProduct',
    });

    expect(res.status).toBe(200);
    const { data } = res.body as { data: { createProduct: unknown } };
    expect(data.createProduct).toMatchObject({ name: 'E2E Product' });

    const profile = await getProfile<HttpRequestData>(app, tokenOf(res));
    expect(profile.entrypoint.data.graphql).toMatchObject({
      operationType: 'mutation',
      operationName: 'CreateProduct',
      fieldName: 'createProduct',
    });
    expect(validatorEntries(profile.collectors)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dtoClass: 'CreateProductInput', status: 'valid' }),
      ]),
    );
  });

  it('invalid mutation input: GraphQL errors out and the violations are captured', async () => {
    const res = await gql(app, {
      query: `mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) { id }
      }`,
      variables: { input: { name: 'Bad price', price: -5 } }, // below Min(0)
      operationName: 'CreateProduct',
    });

    const body = res.body as GqlBody;
    expect(body.errors).toBeDefined();
    expect(body.data ?? null).toBeNull();

    const profile = await getProfile(app, tokenOf(res));
    const invalid = validatorEntries(profile.collectors).find((e) => e.status === 'invalid');
    expect(invalid).toMatchObject({ dtoClass: 'CreateProductInput' });
    expect(invalid?.violations.map((v) => v.property)).toContain('price');
  });

  it('introspection query is not profiled (ignoreGraphQLIntrospection)', async () => {
    const res = await gql(app, { query: '{ __schema { queryType { name } } }' });

    expect(res.status).toBe(200);
    expect(res.headers['x-debug-token']).toBeUndefined();
  });
});
