import { buildTrace, isTraceContributor, TRACE_ROOT_ID } from './build-trace';
import type { RawSpan, TraceContributor } from './build-trace';
import type { IProfilerCollector } from '../collectors/collector.interface';
import type { Profile, TraceSpan } from '../interfaces/profile.interface';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 't',
    createdAt: 0,
    entrypoint: { type: 'http', data: { method: 'GET', url: '/users', headers: {}, query: {} } },
    performance: { startTime: 1000, duration: 100, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

/** A contributor returning a fixed set of raw spans. */
function contributor(spans: RawSpan[]): TraceContributor {
  return { getTraceSpans: () => spans };
}

function byId(trace: TraceSpan[]): Map<string, TraceSpan> {
  return new Map(trace.map((s) => [s.id, s]));
}

describe('buildTrace', () => {
  it('always emits the entrypoint root, even with no child spans', () => {
    const profile = makeProfile();
    buildTrace(profile, []);
    expect(profile.trace).toEqual([
      {
        id: TRACE_ROOT_ID,
        kind: 'entrypoint',
        label: 'GET /users',
        startedAt: 1000,
        duration: 100,
      },
    ]);
  });

  it('synthesizes a root span from the entrypoint and performance window', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor([{ kind: 'http', label: 'GET /a', startedAt: 1010, duration: 5 }]),
    ]);
    const root = byId(profile.trace!).get(TRACE_ROOT_ID)!;
    expect(root).toMatchObject({
      id: TRACE_ROOT_ID,
      kind: 'entrypoint',
      label: 'GET /users',
      startedAt: 1000,
      duration: 100,
    });
    expect(root.parentId).toBeUndefined();
  });

  it('parents contributor spans to the root by time containment', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor([
        {
          kind: 'http',
          label: 'GET /a',
          startedAt: 1010,
          duration: 5,
          source: { collector: 'http-client', index: 0 },
        },
        { kind: 'db', label: 'SELECT 1', startedAt: 1020, duration: 3 },
      ]),
    ]);
    const trace = profile.trace!;
    expect(trace).toHaveLength(3);
    for (const span of trace) {
      if (span.id === TRACE_ROOT_ID) continue;
      expect(span.parentId).toBe(TRACE_ROOT_ID);
    }
  });

  it('nests a span inside the tightest enclosing container', () => {
    const profile = makeProfile({
      spans: [
        { phase: 'outer', startedAt: 1005, duration: 60 },
        { phase: 'inner', startedAt: 1010, duration: 40 },
      ],
    });
    buildTrace(profile, [
      contributor([{ kind: 'db', label: 'SELECT inner', startedAt: 1015, duration: 5 }]),
    ]);
    const trace = profile.trace!;
    const outer = trace.find((s) => s.label === 'outer')!;
    const inner = trace.find((s) => s.label === 'inner')!;
    const query = trace.find((s) => s.label === 'SELECT inner')!;
    expect(query.parentId).toBe(inner.id);
    expect(inner.parentId).toBe(outer.id);
    expect(outer.parentId).toBe(TRACE_ROOT_ID);
  });

  it('keeps overlapping leaf calls as siblings instead of chaining them', () => {
    const profile = makeProfile({ spans: [{ phase: 'authors', startedAt: 1005, duration: 20 }] });
    buildTrace(profile, [
      contributor([
        // Two calls fired concurrently: one merely outlasts the other, it does not cause it.
        { kind: 'http', label: 'GET /users/1', startedAt: 1010, duration: 9 },
        { kind: 'http', label: 'GET /users/2', startedAt: 1010, duration: 10 },
      ]),
    ]);
    const trace = profile.trace!;
    const phase = trace.find((s) => s.label === 'authors')!;
    expect(trace.find((s) => s.label === 'GET /users/1')!.parentId).toBe(phase.id);
    expect(trace.find((s) => s.label === 'GET /users/2')!.parentId).toBe(phase.id);
  });

  it('lets a producer mark its own span as a container', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor([
        { kind: 'db', label: 'transaction', startedAt: 1010, duration: 10, container: true },
        { kind: 'db', label: 'INSERT', startedAt: 1011, duration: 2 },
      ]),
    ]);
    const trace = profile.trace!;
    const tx = trace.find((s) => s.label === 'transaction')!;
    expect(trace.find((s) => s.label === 'INSERT')!.parentId).toBe(tx.id);
  });

  it('emits spans chronologically, keeping emission order on identical starts', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor([
        { kind: 'db', label: 'START TRANSACTION', startedAt: 1010, duration: 0 },
        { kind: 'db', label: 'INSERT', startedAt: 1010, duration: 0.4 },
        { kind: 'db', label: 'COMMIT', startedAt: 1010, duration: 1 },
      ]),
    ]);
    expect(profile.trace!.map((s) => s.label)).toEqual([
      'GET /users',
      'START TRANSACTION',
      'INSERT',
      'COMMIT',
    ]);
  });

  it('maps lifecycle spans as phase spans', () => {
    const profile = makeProfile({
      spans: [{ phase: 'controller', startedAt: 1005, duration: 10 }],
    });
    buildTrace(profile, []);
    const phase = profile.trace!.find((s) => s.kind === 'phase')!;
    expect(phase).toMatchObject({
      label: 'controller',
      startedAt: 1005,
      duration: 10,
      parentId: TRACE_ROOT_ID,
    });
  });

  it('honours an explicit parentId over containment', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor([
        {
          id: 'field-1',
          kind: 'graphql-field',
          label: 'User.posts',
          startedAt: 1010,
          duration: 30,
        },
        // Starts before the field but is explicitly attached to it.
        {
          id: 'q-1',
          parentId: 'field-1',
          kind: 'db',
          label: 'SELECT posts',
          startedAt: 1005,
          duration: 3,
        },
      ]),
    ]);
    const q = byId(profile.trace!).get('q-1')!;
    expect(q.parentId).toBe('field-1');
  });

  it('keeps concurrent containers as siblings, however they overlap in time', () => {
    // Fields resolved in parallel finish together, so each encloses the next by accident.
    // Only what they report about themselves can keep them apart.
    const profile = makeProfile();
    buildTrace(profile, [
      contributor([
        {
          id: 'field-1',
          parentId: TRACE_ROOT_ID,
          kind: 'graphql-field',
          label: 'Product.reviews',
          startedAt: 1010,
          duration: 10,
        },
        {
          id: 'field-2',
          parentId: TRACE_ROOT_ID,
          kind: 'graphql-field',
          label: 'Product.reviews',
          startedAt: 1011,
          duration: 9,
        },
      ]),
    ]);
    const trace = byId(profile.trace!);
    expect(trace.get('field-1')!.parentId).toBe(TRACE_ROOT_ID);
    expect(trace.get('field-2')!.parentId).toBe(TRACE_ROOT_ID);
  });

  it('never re-parents above the explicit parent', () => {
    const profile = makeProfile({
      spans: [{ phase: 'controller', startedAt: 1000, duration: 90 }],
    });
    buildTrace(profile, [
      contributor([
        {
          id: 'field-1',
          kind: 'graphql-field',
          label: 'Query.products',
          startedAt: 1010,
          duration: 5,
        },
        // Reported as a child of the field although its window overflows it (clock skew).
        { parentId: 'field-1', kind: 'db', label: 'SELECT products', startedAt: 1010, duration: 8 },
      ]),
    ]);
    expect(profile.trace!.find((s) => s.label === 'SELECT products')!.parentId).toBe('field-1');
  });

  it('widens a parent whose children outlive its own measured window', () => {
    // The phase stopped being timed before its query resolved: reported 0ms, yet it holds 6ms of work.
    const profile = makeProfile({
      spans: [{ phase: 'db.products', startedAt: 1010, duration: 0 }],
    });
    buildTrace(profile, [
      contributor([{ kind: 'db', label: 'SELECT 1', startedAt: 1010, duration: 6 }]),
    ]);
    const phase = profile.trace!.find((s) => s.label === 'db.products')!;
    expect(phase.duration).toBe(6);
  });

  it('never shrinks a parent that already covers its children', () => {
    const profile = makeProfile({
      spans: [{ phase: 'controller', startedAt: 1000, duration: 50 }],
    });
    buildTrace(profile, [
      contributor([{ kind: 'db', label: 'SELECT 1', startedAt: 1010, duration: 2 }]),
    ]);
    expect(profile.trace!.find((s) => s.label === 'controller')!.duration).toBe(50);
  });

  it('propagates the widening up through every ancestor', () => {
    const profile = makeProfile({
      performance: { startTime: 1000, duration: 1, heapUsed: 0 },
      spans: [
        { phase: 'outer', startedAt: 1000, duration: 0 },
        { phase: 'inner', startedAt: 1000, duration: 0 },
      ],
    });
    buildTrace(profile, [
      contributor([{ kind: 'db', label: 'SELECT 1', startedAt: 1000, duration: 9 }]),
    ]);
    const trace = byId(profile.trace!);
    expect(profile.trace!.find((s) => s.label === 'inner')!.duration).toBe(9);
    expect(profile.trace!.find((s) => s.label === 'outer')!.duration).toBe(9);
    expect(trace.get(TRACE_ROOT_ID)!.duration).toBe(9);
  });

  it('falls back to the root when an explicit parentId does not resolve', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor([
        { parentId: 'missing', kind: 'db', label: 'SELECT 1', startedAt: 1010, duration: 2 },
      ]),
    ]);
    const span = profile.trace!.find((s) => s.label === 'SELECT 1')!;
    expect(span.parentId).toBe(TRACE_ROOT_ID);
  });

  it('keeps sub-millisecond (0ms) spans and places them by start time', () => {
    const profile = makeProfile({ spans: [{ phase: 'outer', startedAt: 1010, duration: 10 }] });
    buildTrace(profile, [
      contributor([{ kind: 'db', label: 'PING', startedAt: 1012, duration: 0 }]),
    ]);
    const ping = profile.trace!.find((s) => s.label === 'PING')!;
    expect(ping.duration).toBe(0);
    expect(ping.parentId).toBe(profile.trace!.find((s) => s.label === 'outer')!.id);
  });

  it('synthesizes globally-unique ids so two db sources never collide', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor([{ kind: 'db', label: 'a', startedAt: 1010, duration: 1 }]),
      contributor([{ kind: 'db', label: 'b', startedAt: 1011, duration: 1 }]),
    ]);
    const ids = profile.trace!.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('derives the root duration from children when performance.duration is absent', () => {
    const profile = makeProfile({ performance: { startTime: 1000, heapUsed: 0 } });
    buildTrace(profile, [
      contributor([{ kind: 'http', label: 'GET /a', startedAt: 1010, duration: 25 }]),
    ]);
    const root = byId(profile.trace!).get(TRACE_ROOT_ID)!;
    // observed end (1035) - startTime (1000)
    expect(root.duration).toBe(35);
  });

  it('isolates a throwing contributor without dropping the trace', () => {
    const profile = makeProfile();
    const boom: TraceContributor = {
      getTraceSpans: () => {
        throw new Error('boom');
      },
    };
    buildTrace(profile, [
      boom,
      contributor([{ kind: 'http', label: 'GET /a', startedAt: 1010, duration: 5 }]),
    ]);
    expect(profile.trace!.some((s) => s.label === 'GET /a')).toBe(true);
  });

  it('carries a contributor span’s performance tags onto the assembled span', () => {
    const profile = makeProfile();
    const tag = { id: 'n-plus-one', label: 'N+1 ×4', severity: 'danger' as const };
    buildTrace(profile, [
      contributor([{ kind: 'db', label: 'SELECT 1', startedAt: 1010, duration: 2, tags: [tag] }]),
    ]);
    expect(profile.trace!.find((s) => s.label === 'SELECT 1')!.tags).toEqual([tag]);
  });

  it('labels the root from the entrypoint name (command, message) when there is no method/url', () => {
    const profile = makeProfile({ entrypoint: { type: 'command', data: { name: 'seed' } } });
    buildTrace(profile, [
      contributor([{ kind: 'db', label: 'INSERT', startedAt: 1010, duration: 2 }]),
    ]);
    expect(byId(profile.trace!).get(TRACE_ROOT_ID)!.label).toBe('seed');
  });

  it('falls back to the entrypoint type when the data carries no method/url/name', () => {
    const profile = makeProfile({ entrypoint: { type: 'rabbitmq', data: {} } });
    buildTrace(profile, [
      contributor([{ kind: 'db', label: 'INSERT', startedAt: 1010, duration: 2 }]),
    ]);
    expect(byId(profile.trace!).get(TRACE_ROOT_ID)!.label).toBe('rabbitmq');
  });
});

describe('isTraceContributor', () => {
  it('detects a collector exposing getTraceSpans', () => {
    const collector: IProfilerCollector = Object.assign(
      { name: 'x', collect: () => null },
      { getTraceSpans: () => [] },
    );
    expect(isTraceContributor(collector)).toBe(true);
  });

  it('rejects a collector without getTraceSpans', () => {
    const collector: IProfilerCollector = { name: 'x', collect: () => null };
    expect(isTraceContributor(collector)).toBe(false);
  });
});
