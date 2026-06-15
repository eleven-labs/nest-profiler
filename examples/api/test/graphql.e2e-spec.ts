import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { HttpRequestData } from '@eleven-labs/nest-profiler';
import type { ValidationEntry } from '@eleven-labs/nest-profiler-validator';
import { createE2EApp, getProfile, server, tokenOf } from './helpers/app.js';

const validatorEntries = (collectors: Record<string, unknown>): ValidationEntry[] =>
  (collectors['validator'] as ValidationEntry[] | undefined) ?? [];

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
    const res = await gql(app, { query: '{ books { id title author } }' });

    expect(res.status).toBe(200);
    const { data } = res.body as { data: { books: unknown[] } };
    expect(data.books.length).toBeGreaterThanOrEqual(3);

    const profile = await getProfile<HttpRequestData>(app, tokenOf(res));
    expect(profile.entrypoint.data.graphql).toMatchObject({
      operationType: 'query',
      fieldName: 'books',
    });
    expect((profile.spans ?? []).map((s) => s.phase)).toContain('books.findAll');
  });

  it('named query with variables: captures operationName and variables', async () => {
    const res = await gql(app, {
      query: 'query GetBook($id: ID!) { book(id: $id) { id title } }',
      variables: { id: '1' },
      operationName: 'GetBook',
    });

    expect(res.status).toBe(200);
    const { data } = res.body as { data: { book: unknown } };
    expect(data.book).toMatchObject({ id: '1', title: 'Clean Code' });

    const profile = await getProfile<HttpRequestData>(app, tokenOf(res));
    expect(profile.entrypoint.data.graphql).toMatchObject({
      operationType: 'query',
      operationName: 'GetBook',
      fieldName: 'book',
      variables: { id: '1' },
    });
    expect(profile.entrypoint.data.graphql?.query).toContain('GetBook');
  });

  it('mutation: creates a book and validates the input type', async () => {
    const res = await gql(app, {
      query: `mutation CreateBook($input: CreateBookInput!) {
        createBook(input: $input) { id title author publishedYear }
      }`,
      variables: { input: { title: 'E2E Book', author: 'Profiler Bot', publishedYear: 2024 } },
      operationName: 'CreateBook',
    });

    expect(res.status).toBe(200);
    const { data } = res.body as { data: { createBook: unknown } };
    expect(data.createBook).toMatchObject({ title: 'E2E Book' });

    const profile = await getProfile<HttpRequestData>(app, tokenOf(res));
    expect(profile.entrypoint.data.graphql).toMatchObject({
      operationType: 'mutation',
      operationName: 'CreateBook',
      fieldName: 'createBook',
    });
    expect(validatorEntries(profile.collectors)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dtoClass: 'CreateBookInput', status: 'valid' }),
      ]),
    );
  });

  it('invalid mutation input: GraphQL errors out and the violations are captured', async () => {
    const res = await gql(app, {
      query: `mutation CreateBook($input: CreateBookInput!) {
        createBook(input: $input) { id }
      }`,
      variables: { input: { title: 'Bad year', author: 'X', publishedYear: 5 } }, // below Min(1000)
      operationName: 'CreateBook',
    });

    const body = res.body as GqlBody;
    expect(body.errors).toBeDefined();
    expect(body.data ?? null).toBeNull();

    const profile = await getProfile(app, tokenOf(res));
    const invalid = validatorEntries(profile.collectors).find((e) => e.status === 'invalid');
    expect(invalid).toMatchObject({ dtoClass: 'CreateBookInput' });
    expect(invalid?.violations.map((v) => v.property)).toContain('publishedYear');
  });

  it('introspection query is not profiled (ignoreGraphQLIntrospection)', async () => {
    const res = await gql(app, { query: '{ __schema { queryType { name } } }' });

    expect(res.status).toBe(200);
    expect(res.headers['x-debug-token']).toBeUndefined();
  });
});
