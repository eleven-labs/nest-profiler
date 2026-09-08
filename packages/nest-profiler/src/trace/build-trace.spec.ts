import { buildTrace, isTraceContributor, TRACE_ROOT_ID } from './build-trace';
import type { RawSpan, TraceContributor } from './build-trace';
import { appendManualSpan } from '../utils/profile-runtime-state';
import { lifecycleMarks } from './build-lifecycle';
import type { Profile, TraceSpan } from '../interfaces/profile.interface';
import type { IProfilerCollector } from '../collectors/collector.interface';

const T0 = 1_000_000;

function makeProfile(duration = 100): Profile {
  return {
    token: 'tok',
    traceId: 'trace-tok',
    createdAt: T0,
    entrypoint: { type: 'http', data: { method: 'GET', url: '/orders', headers: {}, query: {} } },
    performance: { startTime: T0, duration, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

/** A contributor projecting a fixed list of spans, like a collector would. */
function contributor(...spans: RawSpan[]): TraceContributor {
  return { getTraceSpans: () => spans };
}

function byLabel(profile: Profile, label: string): TraceSpan | undefined {
  return profile.trace?.find((span) => span.label === label);
}

/** The assembled trace. `buildTrace` always sets it, so the specs read it without guarding. */
function traceOf(profile: Profile): TraceSpan[] {
  const trace = profile.trace;
  if (!trace) throw new Error('buildTrace left profile.trace unset');
  return trace;
}

/** The root span, which `buildTrace` always emits first. */
function rootOf(profile: Profile): TraceSpan {
  return traceOf(profile)[0] as TraceSpan;
}

describe('buildTrace', () => {
  it('always emits a root naming the entrypoint, even with nothing else to show', () => {
    const profile = makeProfile();
    buildTrace(profile, []);

    expect(profile.trace).toHaveLength(1);
    expect(rootOf(profile)).toMatchObject({
      id: TRACE_ROOT_ID,
      kind: 'entrypoint',
      label: 'GET /orders',
      startedAt: T0,
      duration: 100,
    });
  });

  it('labels the root from a command or message name when there is no URL', () => {
    const profile = makeProfile();
    profile.entrypoint = { type: 'command', data: { name: 'sync:articles' } };
    buildTrace(profile, []);

    expect(rootOf(profile).label).toBe('sync:articles');
  });

  it('reparents an orphan span to the root rather than dropping it', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor({ kind: 'db', label: 'SELECT 1', startedAt: T0 + 10, duration: 5 }),
    ]);

    expect(byLabel(profile, 'SELECT 1')?.parentId).toBe(TRACE_ROOT_ID);
  });

  describe('parenting', () => {
    it('honours a reported parentId over anything the clock suggests', () => {
      const profile = makeProfile();
      // Two containers with identical windows: time alone cannot choose between them, and the
      // reported parent is the only thing that can.
      buildTrace(profile, [
        contributor(
          { id: 'f1', kind: 'graphql-field', label: 'orders', startedAt: T0, duration: 50 },
          { id: 'f2', kind: 'graphql-field', label: 'customers', startedAt: T0, duration: 50 },
          { kind: 'db', label: 'SELECT orders', startedAt: T0 + 5, duration: 5, parentId: 'f2' },
        ),
      ]);

      expect(byLabel(profile, 'SELECT orders')?.parentId).toBe('f2');
    });

    it('ignores a parentId pointing at a span that does not exist', () => {
      const profile = makeProfile();
      buildTrace(profile, [
        contributor({ kind: 'db', label: 'orphan', startedAt: T0, duration: 1, parentId: 'ghost' }),
      ]);

      expect(byLabel(profile, 'orphan')?.parentId).toBe(TRACE_ROOT_ID);
    });

    it('nests by time containment only for spans that report no parent', () => {
      const profile = makeProfile();
      buildTrace(profile, [
        contributor(
          {
            id: 'field',
            kind: 'graphql-field',
            label: 'reviews',
            startedAt: T0 + 10,
            duration: 40,
          },
          { kind: 'db', label: 'inside', startedAt: T0 + 15, duration: 5 },
          { kind: 'db', label: 'outside', startedAt: T0 + 80, duration: 5 },
        ),
      ]);

      expect(byLabel(profile, 'inside')?.parentId).toBe('field');
      expect(byLabel(profile, 'outside')?.parentId).toBe(TRACE_ROOT_ID);
    });

    it('never lets a leaf operation adopt another: two overlapping calls ran concurrently', () => {
      const profile = makeProfile();
      buildTrace(profile, [
        contributor(
          { kind: 'http', label: 'GET /a', startedAt: T0 + 10, duration: 40 },
          { kind: 'http', label: 'GET /b', startedAt: T0 + 12, duration: 30 },
        ),
      ]);

      expect(byLabel(profile, 'GET /a')?.parentId).toBe(TRACE_ROOT_ID);
      expect(byLabel(profile, 'GET /b')?.parentId).toBe(TRACE_ROOT_ID);
    });

    it('picks the tightest enclosing container when several qualify', () => {
      const profile = makeProfile();
      buildTrace(profile, [
        contributor(
          { id: 'wide', kind: 'graphql-field', label: 'wide', startedAt: T0, duration: 90 },
          { id: 'tight', kind: 'graphql-field', label: 'tight', startedAt: T0 + 10, duration: 20 },
          { kind: 'db', label: 'q', startedAt: T0 + 15, duration: 2 },
        ),
      ]);

      expect(byLabel(profile, 'q')?.parentId).toBe('tight');
    });
  });

  describe('manual spans', () => {
    it('merges spans opened through TracerService, keeping their exact parent link', () => {
      const profile = makeProfile();
      appendManualSpan(profile, {
        id: 's1',
        kind: 'custom',
        label: 'outer',
        startedAt: T0 + 5,
        duration: 50,
      });
      appendManualSpan(profile, {
        id: 's2',
        parentId: 's1',
        kind: 'custom',
        label: 'inner',
        startedAt: T0 + 10,
        duration: 5,
      });
      buildTrace(profile, []);

      expect(byLabel(profile, 'outer')?.parentId).toBe(TRACE_ROOT_ID);
      expect(byLabel(profile, 'inner')?.parentId).toBe('s1');
    });
  });

  describe('lifecycle band', () => {
    it('draws framework phases on their own lane and never lets them adopt anything', () => {
      const profile = makeProfile();
      const marks = lifecycleMarks(profile);
      // A guards phase spanning nearly the whole request: in the causal tree it would swallow
      // every operation below it, which is precisely why the band is a separate lane.
      marks.guardsAt = T0 + 1;
      marks.controllerAt = T0 + 90;

      buildTrace(profile, [
        contributor({ kind: 'db', label: 'q', startedAt: T0 + 20, duration: 5 }),
      ]);

      expect(byLabel(profile, 'guards')).toMatchObject({ lane: 'lifecycle', kind: 'phase' });
      expect(byLabel(profile, 'q')?.parentId).toBe(TRACE_ROOT_ID);
      expect(byLabel(profile, 'guards')?.parentId).toBe(TRACE_ROOT_ID);
    });

    it('drops a phase too fast to measure rather than drawing a meaningless bar', () => {
      const profile = makeProfile();
      const marks = lifecycleMarks(profile);
      marks.guardsAt = T0 + 5;
      marks.controllerAt = T0 + 5;

      buildTrace(profile, []);

      expect(byLabel(profile, 'guards')).toBeUndefined();
    });
  });

  describe('window reconciliation', () => {
    it('widens a parent that was timed shorter than the work it triggered', () => {
      const profile = makeProfile();
      buildTrace(profile, [
        contributor(
          // A driver reporting BEGIN as instantaneous, with the real work hanging under it.
          {
            id: 'tx',
            kind: 'db',
            label: 'BEGIN',
            startedAt: T0 + 10,
            duration: 0,
            container: true,
          },
          { kind: 'db', label: 'INSERT', startedAt: T0 + 10, duration: 30, parentId: 'tx' },
        ),
      ]);

      // Left alone the bar would read "this cost nothing" while visibly containing 30ms of work.
      expect(byLabel(profile, 'BEGIN')?.duration).toBe(30);
    });

    it('never shrinks a parent that was already timed correctly', () => {
      const profile = makeProfile();
      buildTrace(profile, [
        contributor(
          { id: 'f', kind: 'graphql-field', label: 'field', startedAt: T0, duration: 50 },
          { kind: 'db', label: 'q', startedAt: T0 + 5, duration: 1, parentId: 'f' },
        ),
      ]);

      expect(byLabel(profile, 'field')?.duration).toBe(50);
    });
  });

  describe('robustness', () => {
    it('isolates a throwing contributor so one bad source cannot drop the trace', () => {
      const profile = makeProfile();
      buildTrace(profile, [
        {
          getTraceSpans: () => {
            throw new Error('collector blew up');
          },
        },
        contributor({ kind: 'db', label: 'survivor', startedAt: T0 + 1, duration: 1 }),
      ]);

      expect(byLabel(profile, 'survivor')).toBeDefined();
    });

    it('deduplicates ids a contributor reports twice, so no span is silently lost', () => {
      const profile = makeProfile();
      buildTrace(profile, [
        contributor(
          { id: 'dup', kind: 'db', label: 'first', startedAt: T0 + 1, duration: 1 },
          { id: 'dup', kind: 'db', label: 'second', startedAt: T0 + 2, duration: 1 },
        ),
      ]);

      const ids = traceOf(profile).map((span) => span.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(profile.trace).toHaveLength(3);
    });

    it('spans the observed children when the entrypoint reports no duration', () => {
      const profile = makeProfile();
      profile.performance.duration = undefined;
      buildTrace(profile, [
        contributor({ kind: 'db', label: 'q', startedAt: T0 + 10, duration: 40 }),
      ]);

      expect(rootOf(profile).duration).toBe(50);
    });
  });

  it('emits spans in chronological order, so the flat array already reads causally', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor(
        { kind: 'db', label: 'third', startedAt: T0 + 30, duration: 1 },
        { kind: 'db', label: 'first', startedAt: T0 + 10, duration: 1 },
        { kind: 'db', label: 'second', startedAt: T0 + 20, duration: 1 },
      ),
    ]);

    expect(traceOf(profile).map((span) => span.label)).toEqual([
      'GET /orders',
      'first',
      'second',
      'third',
    ]);
  });

  it('carries status, tags, source and meta through to the rendered span', () => {
    const profile = makeProfile();
    buildTrace(profile, [
      contributor({
        kind: 'http',
        label: 'GET /upstream',
        startedAt: T0 + 5,
        duration: 10,
        status: 'error',
        tags: [{ id: 'slow', label: 'Slow', severity: 'warning' }],
        source: { collector: 'http-client', index: 0, tab: 'http-client' },
        meta: { statusCode: 500 },
      }),
    ]);

    expect(byLabel(profile, 'GET /upstream')).toMatchObject({
      status: 'error',
      tags: [{ id: 'slow' }],
      source: { collector: 'http-client', index: 0 },
      meta: { statusCode: 500 },
    });
  });
});

describe('isTraceContributor', () => {
  it('narrows a collector exposing getTraceSpans', () => {
    // Built in two steps: `getTraceSpans` is not on `IProfilerCollector`, so an inline literal
    // trips excess-property checking — which is the whole reason this narrowing helper exists.
    const withSpans: IProfilerCollector = Object.assign(
      { name: 'x', collect: () => [] },
      { getTraceSpans: () => [] },
    );
    expect(isTraceContributor(withSpans)).toBe(true);
  });

  it('rejects a collector that contributes nothing to the trace', () => {
    expect(isTraceContributor({ name: 'x', collect: () => [] })).toBe(false);
  });
});
