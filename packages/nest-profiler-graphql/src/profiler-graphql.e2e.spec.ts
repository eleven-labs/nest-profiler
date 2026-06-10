/**
 * End-to-end integration tests for the profiler with real GraphQL drivers.
 *
 * Tests run against two drivers to cover the different context shapes that the
 * GraphQLContextAdapter must handle:
 *
 *  - Apollo Server (Express): context factory exposes `req` → adapter uses gqlCtx.req
 *  - Mercurius (Fastify):     context factory exposes `request` → adapter uses gqlCtx.request
 *
 * Unlike the unit tests (which mock the execution context), these tests bootstrap
 * real NestJS applications and send actual HTTP requests, catching regressions that
 * only surface with the genuine Apollo / Mercurius async context behaviour.
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { Args, Field, ID, InputType, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import { MercuriusDriver } from '@nestjs/mercurius';
import type { MercuriusDriverConfig } from '@nestjs/mercurius';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import type { FastifyRequest } from 'fastify';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { ProfilerGraphQLModule } from './profiler-graphql.module';

interface FastifyReady {
  ready(): Promise<void>;
}

// ── Minimal GraphQL schema (shared across both driver suites) ─────────────────

@ObjectType()
class Book {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;
}

@InputType()
class CreateBookInput {
  @Field()
  title!: string;
}

@Resolver(() => Book)
class BooksResolver {
  private readonly store: Book[] = [{ id: '1', title: 'Clean Code' }];

  @Query(() => [Book])
  books(): Book[] {
    return this.store;
  }

  @Query(() => Book, { nullable: true })
  book(@Args('id', { type: () => ID }) id: string): Book | undefined {
    return this.store.find((b) => b.id === id);
  }

  @Mutation(() => Book)
  createBook(@Args('input') input: CreateBookInput): Book {
    const newBook: Book = { id: String(this.store.length + 1), title: input.title };
    this.store.push(newBook);
    return newBook;
  }

  @Query(() => Book, { nullable: true })
  brokenBook(): Book {
    throw new Error('Intentional resolver failure');
  }
}

@Controller()
class AppController {
  @Get('/health')
  health(): { ok: boolean } {
    return { ok: true };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type GqlBody = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

type GqlResult = {
  status: number;
  body: { data?: Record<string, unknown>; errors?: unknown[] };
  token: string | undefined;
};

async function gql(server: Server, body: GqlBody): Promise<GqlResult> {
  const res = await request(server)
    .post('/graphql')
    .set('Content-Type', 'application/json')
    .send(body);
  return {
    status: res.status,
    body: res.body as GqlResult['body'],
    token: res.headers['x-debug-token'],
  };
}

async function getProfile(server: Server, token: string): Promise<Profile> {
  const res = await request(server).get(`/_profiler/${token}/data`);
  return res.body as Profile;
}

// ── Shared assertions run against both drivers ────────────────────────────────

function sharedGraphQLAssertions(getServer: () => Server, driverLabel: string): void {
  describe(`regression guard — no "res.getHeaders is not a function" [${driverLabel}]`, () => {
    it('profiles a query without throwing', async () => {
      const { status, body, token } = await gql(getServer(), {
        query: '{ books { id title } }',
      });

      expect(status).toBe(200);
      expect(body.errors).toBeUndefined();
      expect(token).toBeDefined();
    });

    it('profiles a named query with variables without throwing', async () => {
      const { status, body, token } = await gql(getServer(), {
        operationName: 'GetBook',
        query: 'query GetBook($id: ID!) { book(id: $id) { id title } }',
        variables: { id: '1' },
      });

      expect(status).toBe(200);
      expect(body.errors).toBeUndefined();
      expect(token).toBeDefined();
    });

    it('profiles a mutation without throwing', async () => {
      const { status, body, token } = await gql(getServer(), {
        operationName: 'CreateBook',
        query:
          'mutation CreateBook($input: CreateBookInput!) { createBook(input: $input) { id title } }',
        variables: { input: { title: 'Driver Test Book' } },
      });

      expect(status).toBe(200);
      expect(body.errors).toBeUndefined();
      expect(token).toBeDefined();
    });

    it('returns the correct resolver data (profiler does not corrupt the response)', async () => {
      const { body } = await gql(getServer(), {
        operationName: 'GetBook',
        query: 'query GetBook($id: ID!) { book(id: $id) { id title } }',
        variables: { id: '1' },
      });

      expect(body.data).toEqual({ book: { id: '1', title: 'Clean Code' } });
    });
  });

  describe(`profile data — GraphQL metadata captured [${driverLabel}]`, () => {
    it('captures operationType and fieldName for a query', async () => {
      const { token } = await gql(getServer(), {
        operationName: 'GetBooks',
        query: 'query GetBooks { books { id title } }',
      });
      expect(token).toBeDefined();

      const profile = await getProfile(getServer(), token!);

      expect(profile.request.graphql?.operationType).toBe('query');
      expect(profile.request.graphql?.fieldName).toBe('books');
    });

    it('captures operationName', async () => {
      const { token } = await gql(getServer(), {
        operationName: 'GetBooks',
        query: 'query GetBooks { books { id title } }',
      });

      const profile = await getProfile(getServer(), token!);

      expect(profile.request.graphql?.operationName).toBe('GetBooks');
    });

    it('captures variables', async () => {
      const { token } = await gql(getServer(), {
        operationName: 'GetBook',
        query: 'query GetBook($id: ID!) { book(id: $id) { id title } }',
        variables: { id: '1' },
      });

      const profile = await getProfile(getServer(), token!);

      expect(profile.request.graphql?.variables).toEqual({ id: '1' });
    });

    it('captures the query document', async () => {
      const query = 'query GetBooks { books { id title } }';
      const { token } = await gql(getServer(), { operationName: 'GetBooks', query });

      const profile = await getProfile(getServer(), token!);

      // query is formatted by tryFormatQuery — check it contains the key identifiers
      expect(profile.request.graphql?.query).toContain('GetBooks');
      expect(profile.request.graphql?.query).toContain('books');
    });

    it('captures mutation operationType and fieldName', async () => {
      const { token } = await gql(getServer(), {
        operationName: 'CreateBook',
        query:
          'mutation CreateBook($input: CreateBookInput!) { createBook(input: $input) { id title } }',
        variables: { input: { title: 'Mutation Test' } },
      });

      const profile = await getProfile(getServer(), token!);

      expect(profile.request.graphql?.operationType).toBe('mutation');
      expect(profile.request.graphql?.fieldName).toBe('createBook');
    });

    it('captures the resolver result as response body (statusCode 200)', async () => {
      const { token } = await gql(getServer(), {
        operationName: 'GetBooks',
        query: 'query GetBooks { books { id title } }',
      });

      const profile = await getProfile(getServer(), token!);

      expect(profile.response?.statusCode).toBe(200);
      expect(profile.response?.body).toBeDefined();
    });
  });

  describe(`error handling — GraphQL errors surfaced [${driverLabel}]`, () => {
    const messagesOf = (errors: unknown[] | undefined): string[] =>
      (errors ?? []).map((e) => (e as { message?: string }).message ?? '');

    it('returns the real resolver error and not the profiler filter crash', async () => {
      const { body, token } = await gql(getServer(), { query: '{ brokenBook { id } }' });

      const messages = messagesOf(body.errors);
      expect(messages).toContain('Intentional resolver failure');
      // Regression guard: the profiler exception filter must not mask the error with its
      // own HTTP-only crash ("response.status is not a function") in a GraphQL context.
      expect(messages).not.toContain('response.status is not a function');
      expect(token).toBeDefined();
    });

    it('captures the { errors } envelope as the profile response body', async () => {
      const { token } = await gql(getServer(), { query: '{ brokenBook { id } }' });

      const profile = await getProfile(getServer(), token!);
      const responseBody = profile.response?.body as { errors?: unknown[] } | undefined;

      expect(Array.isArray(responseBody?.errors)).toBe(true);
      expect(messagesOf(responseBody?.errors)).toContain('Intentional resolver failure');
    });

    it('records the resolver error in the exceptions tab', async () => {
      const { token } = await gql(getServer(), { query: '{ brokenBook { id } }' });

      const profile = await getProfile(getServer(), token!);

      expect(
        profile.exceptions.some((e) => e.message.includes('Intentional resolver failure')),
      ).toBe(true);
    });
  });
}

// ── Apollo + Express suite ────────────────────────────────────────────────────

describe('ProfilerModule + Apollo Server (Express) — e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRoot({ isGlobal: true, collectBody: true }),
        ProfilerGraphQLModule.forRoot(),
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          // Exposes req to the GraphQL context — required for the profiler adapter (gqlCtx.req)
          context: ({ req }: { req: Record<string, unknown> }) => ({ req }),
        }),
      ],
      controllers: [AppController],
      providers: [BooksResolver],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  sharedGraphQLAssertions(() => app.getHttpServer() as Server, 'Apollo/Express');

  it('profiles plain HTTP requests alongside GraphQL (non-regression)', async () => {
    const res = await request(app.getHttpServer() as Server).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-debug-token']).toBeDefined();
  });

  describe('without ProfilerGraphQLModule — profiler silently passes through', () => {
    let appNoCtx: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ProfilerModule.forRoot({ isGlobal: true }),
          // ProfilerGraphQLModule intentionally omitted — no GraphQL profiling
          GraphQLModule.forRoot<ApolloDriverConfig>({
            driver: ApolloDriver,
            autoSchemaFile: true,
          }),
        ],
        providers: [BooksResolver],
      }).compile();

      appNoCtx = moduleRef.createNestApplication();
      await appNoCtx.init();
    });

    afterAll(() => appNoCtx.close());

    it('does not throw — returns a valid resolver response', async () => {
      const { status, body } = await gql(appNoCtx.getHttpServer() as Server, {
        operationName: 'GetBook',
        query: 'query GetBook($id: ID!) { book(id: $id) { id title } }',
        variables: { id: '1' },
      });

      expect(status).toBe(200);
      expect(body.errors).toBeUndefined();
      expect(body.data).toEqual({ book: { id: '1', title: 'Clean Code' } });
    });
  });
});

// ── Mercurius + Fastify suite ─────────────────────────────────────────────────

describe('ProfilerModule + Mercurius (Fastify) — e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ProfilerModule.forRoot({ isGlobal: true, collectBody: true }),
        ProfilerGraphQLModule.forRoot(),
        GraphQLModule.forRoot<MercuriusDriverConfig>({
          driver: MercuriusDriver,
          autoSchemaFile: true,
          // Mercurius context factory receives (request, reply) — uses `request`, not `req`.
          // The profiler adapter locates the profile via gqlCtx.request (Mercurius path).
          context: (req: FastifyRequest) => ({ request: req as unknown }),
        }),
      ],
      controllers: [AppController],
      providers: [BooksResolver],
    }).compile();

    app = moduleRef.createNestApplication(new FastifyAdapter());
    await app.init();
    // Fastify requires waiting for the instance to be ready before accepting requests
    await (app.getHttpAdapter().getInstance() as FastifyReady).ready();
  });

  afterAll(() => app.close());

  sharedGraphQLAssertions(() => app.getHttpServer() as Server, 'Mercurius/Fastify');

  it('profiles plain HTTP requests alongside GraphQL (non-regression)', async () => {
    const res = await request(app.getHttpServer() as Server).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-debug-token']).toBeDefined();
  });

  describe('without ProfilerGraphQLModule — profiler silently passes through', () => {
    let appNoCtx: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ProfilerModule.forRoot({ isGlobal: true }),
          // ProfilerGraphQLModule intentionally omitted — no GraphQL profiling
          GraphQLModule.forRoot<MercuriusDriverConfig>({
            driver: MercuriusDriver,
            autoSchemaFile: true,
          }),
        ],
        providers: [BooksResolver],
      }).compile();

      appNoCtx = moduleRef.createNestApplication(new FastifyAdapter());
      await appNoCtx.init();
      await (appNoCtx.getHttpAdapter().getInstance() as FastifyReady).ready();
    });

    afterAll(() => appNoCtx.close());

    it('does not throw — returns a valid resolver response', async () => {
      const { status, body } = await gql(appNoCtx.getHttpServer() as Server, {
        operationName: 'GetBook',
        query: 'query GetBook($id: ID!) { book(id: $id) { id title } }',
        variables: { id: '1' },
      });

      expect(status).toBe(200);
      expect(body.errors).toBeUndefined();
      expect(body.data).toEqual({ book: { id: '1', title: 'Clean Code' } });
    });
  });
});
