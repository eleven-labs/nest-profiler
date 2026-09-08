import { entriesToSpans } from './entries-to-spans';
import type { TaggableEntry } from '../analysis/taggable-collector.interface';

interface Entry extends TaggableEntry {
  label: string;
  statusCode?: number;
}

const base = { kind: 'http' as const, collector: 'http-client', label: (e: Entry) => e.label };

describe('entriesToSpans', () => {
  it('projects an entry without re-timing it', () => {
    const spans = entriesToSpans<Entry>([{ label: 'GET /a', startedAt: 1000, duration: 12 }], base);

    expect(spans).toEqual([
      {
        kind: 'http',
        label: 'GET /a',
        startedAt: 1000,
        duration: 12,
        parentId: undefined,
        source: { collector: 'http-client', index: 0, tab: 'http-client' },
      },
    ]);
  });

  it('carries the stamped parent through, which is what nests the call under its caller', () => {
    const spans = entriesToSpans<Entry>(
      [{ label: 'GET /a', startedAt: 1000, duration: 12, parentSpanId: 's3' }],
      base,
    );

    expect(spans[0]?.parentId).toBe('s3');
  });

  it('skips an entry with no start rather than drawing it at the origin', () => {
    // A bar at the start of the request, when nobody knows when the call ran, is worse than none.
    expect(entriesToSpans<Entry>([{ label: 'GET /a', duration: 12 }], base)).toEqual([]);
  });

  it('indexes spans against the entry list, so a bar links back to its row', () => {
    const spans = entriesToSpans<Entry>(
      [
        { label: 'GET /a', startedAt: 1, duration: 1 },
        { label: 'GET /b', startedAt: 2, duration: 1 },
      ],
      base,
    );

    expect(spans.map((s) => s.source?.index)).toEqual([0, 1]);
  });

  it('links to the group panel when the collector shares one', () => {
    const spans = entriesToSpans<Entry>([{ label: 'SELECT 1', startedAt: 1, duration: 1 }], {
      ...base,
      kind: 'db',
      collector: 'typeorm',
      tab: 'database',
    });

    expect(spans[0]?.source).toEqual({ collector: 'typeorm', index: 0, tab: 'database' });
  });

  it('surfaces the tags the rule engine already applied to the entry', () => {
    const spans = entriesToSpans<Entry>(
      [
        {
          label: 'GET /a',
          startedAt: 1,
          duration: 900,
          tags: [{ id: 'slow', label: 'Slow', severity: 'warning' }],
        },
      ],
      base,
    );

    expect(spans[0]?.tags).toEqual([{ id: 'slow', label: 'Slow', severity: 'warning' }]);
  });

  describe('failure', () => {
    it('marks an entry carrying an error by default', () => {
      const spans = entriesToSpans<Entry>(
        [{ label: 'GET /a', startedAt: 1, duration: 1, error: 'ECONNREFUSED' }],
        base,
      );

      expect(spans[0]?.status).toBe('error');
    });

    it('defers to the collector when it classifies failure itself', () => {
      // A 404 from an upstream is an answer for some applications and a failure for others; the
      // collector's own `error` option is what already decides, so the trace must not second-guess.
      const spans = entriesToSpans<Entry>(
        [{ label: 'GET /a', startedAt: 1, duration: 1, statusCode: 404 }],
        { ...base, isError: (entry) => (entry.statusCode ?? 0) >= 400 },
      );

      expect(spans[0]?.status).toBe('error');
    });
  });

  it('omits meta when the collector produces none', () => {
    const spans = entriesToSpans<Entry>([{ label: 'GET /a', startedAt: 1, duration: 1 }], {
      ...base,
      meta: () => ({}),
    });

    expect(spans[0]).not.toHaveProperty('meta');
  });

  it('returns nothing for a collector that captured nothing', () => {
    expect(entriesToSpans<Entry>(undefined, base)).toEqual([]);
    expect(entriesToSpans<Entry>([], base)).toEqual([]);
  });
});
