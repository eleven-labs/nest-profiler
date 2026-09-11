import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { HttpRequestData } from '@eleven-labs/nest-profiler';
import type { MongooseQueryEntry } from '@eleven-labs/nest-profiler-mongoose';
import type { HttpRequestEntry } from '@eleven-labs/nest-profiler-http';
import type { ValidationEntry } from '@eleven-labs/nest-profiler-validator';
import {
  activeSqlOrm,
  createE2EApp,
  getProfile,
  isDataLoaderRun,
  server,
  tokenOf,
} from './helpers/app.js';
import { lockNetwork, mockJsonPlaceholder, unlockNetwork } from './helpers/jsonplaceholder.js';

const validatorEntries = (collectors: Record<string, unknown>): ValidationEntry[] =>
  (collectors['validator'] as ValidationEntry[] | undefined) ?? [];
const mongooseEntries = (collectors: Record<string, unknown>): MongooseQueryEntry[] =>
  (collectors['mongoose'] as MongooseQueryEntry[] | undefined) ?? [];
const httpEntries = (collectors: Record<string, unknown>): HttpRequestEntry[] =>
  (collectors['http-client'] as HttpRequestEntry[] | undefined) ?? [];

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
    // Review authors are resolved from the external user directory; mock it like the content suite.
    mockJsonPlaceholder();
    lockNetwork();
  });

  afterAll(async () => {
    unlockNetwork();
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
    expect((profile.trace ?? []).map((s) => s.label)).toContain('db.products.findAll');
  });

  it('resolving Product.reviews.author captures SQL, MongoDB and HTTP in one profile', async () => {
    // A single GraphQL query walks three sources: products from the SQL ORM (root resolver), their
    // reviews from MongoDB (field resolver), then each review's author from the external user
    // directory over HTTP (nested field resolver). Field resolvers run after the root resolver
    // returns, so this also exercises the deferred-collection fix: all three collectors must appear
    // in one profile.
    const res = await gql(app, {
      query: '{ products { id reviews { rating authorId author { id name company } } } }',
    });

    expect(res.status).toBe(200);
    const { data } = res.body as {
      data: {
        products: Array<{
          id: string;
          reviews: Array<{ rating: number; authorId: number; author: { id: number } | null }>;
        }>;
      };
    };
    // Products 1-3 are seeded with reviews; at least one product resolves a non-empty list.
    const reviews = data.products.flatMap((p) => p.reviews);
    expect(reviews.length).toBeGreaterThan(0);
    // Every author was resolved, and each one against its own review's id.
    expect(reviews.every((review) => review.author?.id === review.authorId)).toBe(true);

    const profile = await getProfile<HttpRequestData>(app, tokenOf(res));

    // SQL side: the catalog list query ran under the active ORM (root resolver).
    expect((profile.trace ?? []).map((s) => s.label)).toContain('db.products.findAll');
    expect(
      (profile.collectors[activeSqlOrm()] as unknown[] | undefined)?.length ?? 0,
    ).toBeGreaterThan(0);

    // Mongo side: the reviews were read from MongoDB by a field resolver, captured by the mongoose
    // collector even though it runs after the root resolver returned.
    const finds = mongooseEntries(profile.collectors).filter((e) => e.operation === 'find');
    expect(finds.length).toBeGreaterThan(0);
    expect(finds[0]).toMatchObject({ collection: 'reviews' });

    // HTTP side: the author lookups, captured by whichever instrumentation HTTP_CLIENT selected.
    const authorCalls = httpEntries(profile.collectors).filter((e) => e.url.includes('/users'));
    expect(authorCalls.length).toBeGreaterThan(0);
    expect(authorCalls[0]).toMatchObject({ method: 'GET', statusCode: 200 });

    const labels = (profile.trace ?? []).map((span) => span.label);
    if (isDataLoaderRun()) {
      // Batched: one `$in` query for every product's reviews, which in turn lets every author be
      // resolved in the same tick — so the whole operation needs exactly one call per source.
      expect(finds).toHaveLength(1);
      expect(finds[0]?.filter?.['productId']).toMatchObject({
        $in: expect.arrayContaining(['1']) as string[],
      });
      expect(authorCalls).toHaveLength(1);
      expect(authorCalls[0]?.url).toContain('/users?id=');
      expect(labels).toEqual(
        expect.arrayContaining(['db.reviews.findByProducts', 'http.reviews.authors.batch']),
      );
    } else {
      // Unbatched: one `find({ productId })` per product and one `GET /users/:id` per review —
      // including a repeat for the author who reviewed two products. That is the N+1 the DataLoader
      // adapters exist to collapse.
      expect(finds.length).toBeGreaterThan(1);
      expect(finds.some((e) => typeof e.filter?.['productId'] === 'string')).toBe(true);
      expect(authorCalls).toHaveLength(reviews.length);
      expect(authorCalls.every((call) => /\/users\/\d+$/.test(call.url))).toBe(true);
      expect(labels).toEqual(
        expect.arrayContaining(['db.reviews.findByProduct', 'http.reviews.author']),
      );
    }
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
