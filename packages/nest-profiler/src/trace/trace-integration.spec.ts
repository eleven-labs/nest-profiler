import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { TracerService } from '../services/tracer.service';
import { setProfileContext } from '../services/profiler-context';
import { appendCollectorEntry } from '../utils/collector.utils';
import { createProfilerLogger } from '../services/profiler-logger-adapter';
import { manualSpansOf } from '../utils/profile-runtime-state';
import { buildTrace, TRACE_ROOT_ID } from './build-trace';
import { entriesToSpans } from './entries-to-spans';
import type { TraceContributor } from './build-trace';
import type { Profile, TraceSpan } from '../interfaces/profile.interface';
import type { TaggableEntry } from '../analysis/taggable-collector.interface';

const QUERIES_KEY = 'queries';

interface QueryLike extends TaggableEntry {
  sql: string;
}

/** A collector standing in for TypeORM or Mongoose: it drains a key and projects it. */
const queryCollector: TraceContributor = {
  getTraceSpans: (profile) =>
    entriesToSpans(profile.collectors[QUERIES_KEY] as QueryLike[] | undefined, {
      kind: 'db',
      collector: 'typeorm',
      tab: 'database',
      label: (entry) => entry.sql,
    }),
};

function makeProfile(): Profile {
  return {
    token: 'tok',
    traceId: 'trace-tok',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/orders', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

/**
 * The chain the whole design turns on: a span opened by application code, a query captured by an
 * instrumentation that knows nothing about that span, and a trace that nevertheless nests the two
 * correctly. Each piece is unit-tested on its own; this asserts they actually meet.
 */
describe('trace assembly, end to end', () => {
  let cls: ClsService;
  let tracer: TracerService;
  let profile: Profile;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ middleware: { mount: false } })],
      providers: [TracerService],
    }).compile();
    cls = module.get(ClsService);
    tracer = module.get(TracerService);
    profile = makeProfile();
  });

  function profiled<T>(fn: () => T): T {
    return cls.run(() => {
      setProfileContext(cls, profile, {});
      return fn();
    });
  }

  /** What an instrumentation patch does: build an entry and hand it to the shared funnel. */
  function recordQuery(sql: string, startedAt: number, duration: number): void {
    appendCollectorEntry<QueryLike>(profile, QUERIES_KEY, { sql, startedAt, duration });
  }

  function find(label: string): TraceSpan | undefined {
    return profile.trace?.find((span) => span.label === label);
  }

  it('nests a captured query under the span that issued it', async () => {
    await profiled(async () => {
      await tracer.span('orders.load', async () => {
        recordQuery('SELECT * FROM orders', Date.now(), 5);
        await Promise.resolve();
      });
    });
    profile.performance.duration = 50;
    buildTrace(profile, [queryCollector]);

    const span = find('orders.load');
    const query = find('SELECT * FROM orders');
    // The instrumentation never saw the span, and the span never saw the query: the async context
    // is the only thing that connected them.
    expect(query?.parentId).toBe(span?.id);
    expect(query?.source).toEqual({ collector: 'typeorm', index: 0, tab: 'database' });
  });

  it('files a query issued outside any span at the trace root', () => {
    profiled(() => recordQuery('SELECT 1', Date.now(), 1));
    profile.performance.duration = 50;
    buildTrace(profile, [queryCollector]);

    expect(find('SELECT 1')?.parentId).toBe(TRACE_ROOT_ID);
  });

  it('keeps queries from concurrent spans under their own span', async () => {
    // Both spans are open at the same instant, so time containment could attribute either query to
    // either span. Only the capture-time stamp gets this right.
    await profiled(async () => {
      await Promise.all([
        tracer.span('load.a', async () => {
          await new Promise((r) => setTimeout(r, 5));
          recordQuery('SELECT a', Date.now(), 1);
        }),
        tracer.span('load.b', async () => {
          await new Promise((r) => setTimeout(r, 5));
          recordQuery('SELECT b', Date.now(), 1);
        }),
      ]);
    });
    profile.performance.duration = 50;
    buildTrace(profile, [queryCollector]);

    expect(find('SELECT a')?.parentId).toBe(find('load.a')?.id);
    expect(find('SELECT b')?.parentId).toBe(find('load.b')?.id);
    expect(find('load.a')?.parentId).toBe(TRACE_ROOT_ID);
    expect(find('load.b')?.parentId).toBe(TRACE_ROOT_ID);
  });

  it('nests a query two levels down, under the innermost span open at capture time', async () => {
    await profiled(async () => {
      await tracer.span('outer', async () => {
        await tracer.span('inner', async () => {
          recordQuery('SELECT deep', Date.now(), 1);
          await Promise.resolve();
        });
      });
    });
    profile.performance.duration = 50;
    buildTrace(profile, [queryCollector]);

    expect(find('SELECT deep')?.parentId).toBe(find('inner')?.id);
    expect(find('inner')?.parentId).toBe(find('outer')?.id);
  });

  it('stamps the span on a log line written inside it', () => {
    const emitted: string[] = [];
    const logger = createProfilerLogger({
      log: (message: string) => emitted.push(message),
    });

    profiled(() => {
      logger.log('before any span');
      tracer.span('outer', (span) => {
        logger.log('inside the span');
        expect(span.spanId).not.toBe('');
      });
    });

    const [outside, inside] = profile.logs;
    // A line written outside any span carries none: it belongs to the request, not to a bar.
    expect(outside?.spanId).toBeUndefined();
    expect(inside?.spanId).toBeDefined();
    // And it is the span that was open, so the waterfall can show the line under that bar.
    expect(inside?.spanId).toBe(manualSpansOf(profile)[0]?.id);
    // Both forwarded lines carry the trace id, which is what leads a terminal back to the profile.
    expect(emitted).toEqual(['[trace-tok] before any span', '[trace-tok] inside the span']);
  });

  it('does not stamp a capture made outside a profiled execution', () => {
    // No CLS context at all: the funnel must not throw, and must not invent a parent.
    appendCollectorEntry<QueryLike>(profile, QUERIES_KEY, {
      sql: 'SELECT orphan',
      startedAt: Date.now(),
      duration: 1,
    });

    const entries = profile.collectors[QUERIES_KEY] as QueryLike[];
    expect(entries[0]?.parentSpanId).toBeUndefined();
  });
});
