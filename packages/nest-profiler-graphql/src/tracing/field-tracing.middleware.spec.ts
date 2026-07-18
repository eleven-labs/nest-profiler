import {
  GraphQLObjectType,
  GraphQLString,
  GraphQLList,
  GraphQLSchema,
  type GraphQLResolveInfo,
} from 'graphql';
import type { ClsService } from 'nestjs-cls';
import { PROFILER_CLS_KEYS, TRACE_ROOT_ID, type Profile } from '@eleven-labs/nest-profiler';
import type { MiddlewareContext } from '@nestjs/graphql';
import { createProfilerFieldMiddleware } from './field-tracing.middleware';
import { GRAPHQL_FIELD_SPANS_KEY, type GraphqlFieldSpan } from './graphql-field-span';

const Review = new GraphQLObjectType({ name: 'Review', fields: { id: { type: GraphQLString } } });
const Product = new GraphQLObjectType({
  name: 'Product',
  fields: { name: { type: GraphQLString }, reviews: { type: new GraphQLList(Review) } },
});
const Query = new GraphQLObjectType({
  name: 'Query',
  fields: { products: { type: new GraphQLList(Product) } },
});
const schema = new GraphQLSchema({ query: Query });

function info(parent: GraphQLObjectType, fieldName: string): GraphQLResolveInfo {
  const returnType = parent.getFields()[fieldName]!.type;
  return { parentType: parent, fieldName, returnType, schema } as GraphQLResolveInfo;
}

/** Minimal CLS stub: `run` opens an inherited child store for the async callback. */
function makeCls(initial: Record<string, unknown> = {}): ClsService {
  let store: Record<string, unknown> = { ...initial };
  return {
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => {
      store[key] = value;
    },
    run: async (_opts: unknown, cb: () => unknown) => {
      const parent = store;
      store = { ...parent };
      try {
        return await cb();
      } finally {
        store = parent;
      }
    },
  } as unknown as ClsService;
}

function makeProfile(): Profile {
  return {
    token: 't',
    createdAt: 0,
    entrypoint: { type: 'graphql', data: {} },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

function fieldSpans(profile: Profile): GraphqlFieldSpan[] {
  return (profile.collectors[GRAPHQL_FIELD_SPANS_KEY] as GraphqlFieldSpan[] | undefined) ?? [];
}

const ctx = (i: GraphQLResolveInfo): MiddlewareContext =>
  ({ info: i }) as unknown as MiddlewareContext;

describe('createProfilerFieldMiddleware', () => {
  it('passes through and records nothing when no profile is active', async () => {
    const cls = makeCls();
    const mw = createProfilerFieldMiddleware(cls);
    const next = jest.fn().mockResolvedValue('v');
    await expect(mw(ctx(info(Product, 'reviews')), next)).resolves.toBe('v');
    expect(next).toHaveBeenCalled();
  });

  it('records a span for a composite field and nests its DB/HTTP under it via activeSpanId', async () => {
    const profile = makeProfile();
    const cls = makeCls({ [PROFILER_CLS_KEYS.profile]: profile });
    const mw = createProfilerFieldMiddleware(cls);
    let seenActive: unknown;
    const next = jest.fn(() => {
      seenActive = cls.get(PROFILER_CLS_KEYS.activeSpanId);
      return Promise.resolve('ok');
    });
    await mw(ctx(info(Product, 'reviews')), next);
    const spans = fieldSpans(profile);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      label: 'Product.reviews',
      parentId: TRACE_ROOT_ID,
      status: 'ok',
    });
    // Children resolving inside the field read its span id as the active span.
    expect(seenActive).toBe(spans[0]!.id);
  });

  it('skips scalar leaf fields under the default filter', async () => {
    const profile = makeProfile();
    const cls = makeCls({ [PROFILER_CLS_KEYS.profile]: profile });
    const mw = createProfilerFieldMiddleware(cls);
    await mw(ctx(info(Product, 'name')), jest.fn().mockResolvedValue('n'));
    expect(fieldSpans(profile)).toHaveLength(0);
  });

  it('traces a root operation field even when it returns a list of objects', async () => {
    const profile = makeProfile();
    const cls = makeCls({ [PROFILER_CLS_KEYS.profile]: profile });
    const mw = createProfilerFieldMiddleware(cls);
    await mw(ctx(info(Query, 'products')), jest.fn().mockResolvedValue([]));
    expect(fieldSpans(profile).map((s) => s.label)).toEqual(['Query.products']);
  });

  it('traces every field (except introspection) with traceFields: "all"', async () => {
    const profile = makeProfile();
    const cls = makeCls({ [PROFILER_CLS_KEYS.profile]: profile });
    const mw = createProfilerFieldMiddleware(cls, { traceFields: 'all' });
    await mw(ctx(info(Product, 'name')), jest.fn().mockResolvedValue('n'));
    expect(fieldSpans(profile).map((s) => s.label)).toEqual(['Product.name']);
  });

  it('honours a custom predicate', async () => {
    const profile = makeProfile();
    const cls = makeCls({ [PROFILER_CLS_KEYS.profile]: profile });
    const mw = createProfilerFieldMiddleware(cls, { traceFields: (i) => i.fieldName === 'name' });
    await mw(ctx(info(Product, 'reviews')), jest.fn().mockResolvedValue([]));
    expect(fieldSpans(profile)).toHaveLength(0);
    await mw(ctx(info(Product, 'name')), jest.fn().mockResolvedValue('n'));
    expect(fieldSpans(profile)).toHaveLength(1);
  });

  it('marks a throwing resolver as an error span and rethrows', async () => {
    const profile = makeProfile();
    const cls = makeCls({ [PROFILER_CLS_KEYS.profile]: profile });
    const mw = createProfilerFieldMiddleware(cls);
    const boom = new Error('boom');
    await expect(mw(ctx(info(Product, 'reviews')), jest.fn().mockRejectedValue(boom))).rejects.toBe(
      boom,
    );
    expect(fieldSpans(profile)[0]!.status).toBe('error');
  });

  it('drops field spans shorter than minFieldMs', async () => {
    const profile = makeProfile();
    const cls = makeCls({ [PROFILER_CLS_KEYS.profile]: profile });
    const mw = createProfilerFieldMiddleware(cls, { minFieldMs: 10_000 });
    await mw(ctx(info(Product, 'reviews')), jest.fn().mockResolvedValue([]));
    expect(fieldSpans(profile)).toHaveLength(0);
  });
});
