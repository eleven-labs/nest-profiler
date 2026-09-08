import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { TracerService } from './tracer.service';
import { setProfileContext } from './profiler-context';
import { manualSpansOf } from '../utils/profile-runtime-state';
import type { RawSpan } from '../trace/build-trace';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(token = 't-1'): Profile {
  return {
    token,
    traceId: `trace-${token}`,
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('TracerService', () => {
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

  /** Runs `fn` as if inside a profiled request. */
  function profiled<T>(fn: () => T): T {
    return cls.run(() => {
      setProfileContext(cls, profile, { url: '/x' });
      return fn();
    });
  }

  function spans(): RawSpan[] {
    return manualSpansOf(profile);
  }

  describe('span()', () => {
    it('returns the callback value and records one span', () => {
      const result = profiled(() => tracer.span('work', () => 42));

      expect(result).toBe(42);
      expect(spans()).toHaveLength(1);
      expect(spans()[0]!).toMatchObject({ label: 'work', kind: 'custom' });
    });

    it('awaits an async callback before closing, so the span times the work not the first await', async () => {
      const result = await profiled(() =>
        tracer.span('async-work', async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return 'done';
        }),
      );

      expect(result).toBe('done');
      expect(spans()).toHaveLength(1);
      // Closing on the synchronous return would have measured the time to reach the first
      // `await` — a fraction of a millisecond — rather than the 20ms actually spent.
      expect(spans()[0]!.duration).toBeGreaterThanOrEqual(15);
    });

    it('closes the span and marks it failed when the callback throws', () => {
      expect(() =>
        profiled(() =>
          tracer.span('boom', () => {
            throw new Error('nope');
          }),
        ),
      ).toThrow('nope');

      expect(spans()).toHaveLength(1);
      expect(spans()[0]!.status).toBe('error');
    });

    it('closes the span and marks it failed when the callback rejects', async () => {
      await expect(
        profiled(() => tracer.span('boom', () => Promise.reject(new Error('nope')))),
      ).rejects.toThrow('nope');

      expect(spans()).toHaveLength(1);
      expect(spans()[0]!.status).toBe('error');
    });

    it('nests a span opened inside another under it, exactly', () => {
      profiled(() =>
        tracer.span('outer', () => {
          tracer.span('inner', () => undefined);
        }),
      );

      const inner = spans().find((s) => s.label === 'inner');
      const outer = spans().find((s) => s.label === 'outer');
      expect(inner?.parentId).toBe(outer?.id);
      expect(outer?.parentId).toBeUndefined();
    });

    it('does not nest concurrent spans under each other, however much they overlap in time', async () => {
      // The case time-containment inference gets wrong: two operations started together enclose
      // one another by accident, and only the async context knows neither caused the other.
      //
      // Also the regression guard for `PROFILER_CLS_KEYS.activeSpanId` being a *flat* key: as a
      // dotted path it lands in a nested store object that `ifNested: 'inherit'` shares by
      // reference, so span "a" leaked its id back to this scope and "b" was recorded as its child.
      await profiled(() =>
        Promise.all([
          tracer.span('a', () => new Promise((r) => setTimeout(r, 10))),
          tracer.span('b', () => new Promise((r) => setTimeout(r, 10))),
        ]),
      );

      expect(spans().map((s) => s.parentId)).toEqual([undefined, undefined]);
    });

    it('keeps the profile reachable inside the span scope', () => {
      // `cls.run()` without `ifNested: 'inherit'` would start an empty store here, and every
      // collector running underneath would silently record nothing.
      profiled(() =>
        tracer.span('scoped', () => {
          expect(tracer.currentToken()).toBe('t-1');
          expect(tracer.currentTraceId()).toBe('trace-t-1');
        }),
      );
    });

    it('records the tags set on the span', () => {
      profiled(() =>
        tracer.span('tagged', (span) => span.setTag('rows', 3).addTags({ hit: true })),
      );

      expect(spans()[0]!.meta).toEqual({ rows: 3, hit: true });
    });
  });

  describe('startSpan()', () => {
    it('records the span when the delegate is ended', () => {
      profiled(() => {
        const span = tracer.startSpan('manual');
        expect(spans()).toHaveLength(0);
        span.end();
      });

      expect(spans()).toHaveLength(1);
      expect(spans()[0]!.label).toBe('manual');
    });

    it('is idempotent, so a second end() does not record the span twice', () => {
      profiled(() => {
        const span = tracer.startSpan('manual');
        span.end();
        span.end();
      });

      expect(spans()).toHaveLength(1);
    });

    it('does not become the active span — work started after it is a sibling, not a child', () => {
      profiled(() => {
        const manual = tracer.startSpan('manual');
        tracer.span('after', () => undefined);
        manual.end();
      });

      expect(spans().every((s) => s.parentId === undefined)).toBe(true);
    });
  });

  describe('activeSpan()', () => {
    it('resolves the span currently open, so unrelated code can annotate it', () => {
      profiled(() =>
        tracer.span('outer', (span) => {
          tracer.activeSpan().setTag('annotated', true);
          expect(tracer.activeSpan().spanId).toBe(span.spanId);
        }),
      );

      expect(spans()[0]!.meta).toEqual({ annotated: true });
    });

    it('hands back an inert delegate outside any span rather than throwing', () => {
      profiled(() => {
        expect(() => tracer.activeSpan().setTag('k', 1)).not.toThrow();
        expect(tracer.activeSpan().spanId).toBe('');
      });
    });
  });

  describe('captureError()', () => {
    it('records a handled exception and fails the active span', () => {
      profiled(() =>
        tracer.span('degraded', () => {
          tracer.captureError(new Error('upstream down'), { retryable: true });
        }),
      );

      expect(profile.exceptions).toHaveLength(1);
      expect(profile.exceptions[0]!).toMatchObject({ message: 'upstream down', handled: true });
      expect(spans()[0]!).toMatchObject({ status: 'error', meta: { retryable: true } });
    });

    it('marks the entry handled, so a request that recovered is not filed as a failure', () => {
      profiled(() => tracer.captureError(new Error('caught')));

      // The distinction the whole feature turns on: the exception is visible, the profile is not
      // a failure. `unhandledExceptions` is what every error verdict reads.
      expect(profile.exceptions[0]!.handled).toBe(true);
    });
  });

  describe('attributes', () => {
    it('writes into profile.attributes, which is what the list indexes and filters on', () => {
      profiled(() => {
        tracer.setAttribute('tenant', 'acme');
        expect(tracer.getAttribute('tenant')).toBe('acme');
      });

      expect(profile.attributes).toEqual({ tenant: 'acme' });
    });
  });

  describe('outside a profiled execution', () => {
    it('runs the callback and returns its value without recording anything', () => {
      expect(tracer.span('orphan', () => 'value')).toBe('value');
      expect(spans()).toHaveLength(0);
    });

    it('lets an error through unchanged', () => {
      expect(() =>
        tracer.span('orphan', () => {
          throw new Error('real failure');
        }),
      ).toThrow('real failure');
    });

    it('answers undefined instead of throwing', () => {
      expect(tracer.currentToken()).toBeUndefined();
      expect(tracer.currentTraceId()).toBeUndefined();
      expect(tracer.getAttribute('anything')).toBeUndefined();
      expect(() => tracer.captureError(new Error('x'))).not.toThrow();
      expect(() => tracer.setAttribute('k', 'v')).not.toThrow();
    });
  });
});
