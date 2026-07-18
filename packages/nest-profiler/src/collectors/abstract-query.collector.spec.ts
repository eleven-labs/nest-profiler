import { AbstractQueryCollector } from './abstract-query.collector';
import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerTag } from '../analysis/profiler-tag.interface';

interface TestEntry {
  id: number;
  duration: number;
  fingerprint?: string;
  tags?: ProfilerTag[];
  command?: string;
}

const QUERIES_KEY = '__test_query_entries';

class PlainCollector extends AbstractQueryCollector<TestEntry> {
  readonly name = 'plain';
  protected readonly queriesKey = QUERIES_KEY;
  getTemplatePath(): string {
    return '/tmp/plain-panel.ejs';
  }
}

/** Overrides `transform` to attach a derived field, like MongooseCollector does. */
class TransformingCollector extends AbstractQueryCollector<TestEntry> {
  readonly name = 'transforming';
  protected readonly queriesKey = QUERIES_KEY;
  getTemplatePath(): string {
    return '/tmp/transforming-panel.ejs';
  }
  protected transform(queries: TestEntry[]): TestEntry[] {
    return queries.map((q) => ({ ...q, command: `run-${q.id}` }));
  }
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function makeEntry(overrides: Partial<TestEntry> = {}): TestEntry {
  return { id: 1, duration: 5, ...overrides };
}

const slowTag: ProfilerTag = { id: 'slow', label: 'Slow', severity: 'warning' };
const dupTag: ProfilerTag = { id: 'n-plus-one', label: 'N+1 ×2', severity: 'danger', count: 2 };

describe('AbstractQueryCollector', () => {
  describe('collect', () => {
    it('drains the private queries key and removes it from collectors', () => {
      const collector = new PlainCollector();
      const entry = makeEntry();
      const profile = makeProfile({ collectors: { [QUERIES_KEY]: [entry] } });
      expect(collector.collect(profile)).toEqual([entry]);
      expect(profile.collectors[QUERIES_KEY]).toBeUndefined();
    });

    it('returns an empty array when no queries were recorded', () => {
      expect(new PlainCollector().collect(makeProfile())).toEqual([]);
    });

    it('applies the transform hook to the drained entries', () => {
      const collector = new TransformingCollector();
      const profile = makeProfile({
        collectors: { [QUERIES_KEY]: [makeEntry({ id: 1 }), makeEntry({ id: 2 })] },
      });
      expect(collector.collect(profile)).toEqual([
        { id: 1, duration: 5, command: 'run-1' },
        { id: 2, duration: 5, command: 'run-2' },
      ]);
      expect(profile.collectors[QUERIES_KEY]).toBeUndefined();
    });
  });

  describe('getBadgeValue', () => {
    it('returns null when there are no queries', () => {
      expect(new PlainCollector().getBadgeValue(makeProfile())).toBeNull();
    });

    it('shows the query count', () => {
      const collector = new PlainCollector();
      const profile = makeProfile({ collectors: { [QUERIES_KEY]: [makeEntry(), makeEntry()] } });
      expect(collector.getBadgeValue(profile)).toBe('2q');
    });

    it('keeps the badge a plain query count regardless of tags', () => {
      const collector = new PlainCollector();
      const profile = makeProfile({
        collectors: { [QUERIES_KEY]: [makeEntry({ tags: [slowTag] }), makeEntry()] },
      });
      expect(collector.getBadgeValue(profile)).toBe('2q');
    });

    it('getBadgeSeverity returns the worst tag severity, or null when untagged', () => {
      const collector = new PlainCollector();
      const tagged = makeProfile({
        collectors: {
          [QUERIES_KEY]: [makeEntry({ tags: [slowTag] }), makeEntry({ tags: [dupTag] })],
        },
      });
      expect(collector.getBadgeSeverity(tagged)).toBe('danger');
      const untagged = makeProfile({ collectors: { [QUERIES_KEY]: [makeEntry()] } });
      expect(collector.getBadgeSeverity(untagged)).toBeNull();
    });

    it('exposes stored entries and a default tag config to the rule engine', () => {
      const collector = new PlainCollector();
      const entries = [makeEntry()];
      const profile = makeProfile({ collectors: { [collector.name]: entries } });
      expect(collector.getTaggableEntries(profile)).toBe(entries);
      expect(collector.getTagConfig()).toMatchObject({ slowThreshold: 100, nPlusOneThreshold: 2 });
      expect(collector.tagDomain).toBe('query');
    });

    it('reads from profile.collectors[name] once collect() has stored the entries', () => {
      const collector = new PlainCollector();
      const profile = makeProfile({ collectors: { [QUERIES_KEY]: [makeEntry(), makeEntry()] } });
      profile.collectors[collector.name] = collector.collect(profile);
      expect(profile.collectors[QUERIES_KEY]).toBeUndefined();
      expect(collector.getBadgeValue(profile)).toBe('2q');
    });
  });

  describe('getTraceSpans (defaults)', () => {
    it('maps entries to db spans with the generic label and no meta, falling back startedAt to 0', () => {
      const collector = new PlainCollector();
      const profile = makeProfile({ collectors: { plain: [makeEntry({ duration: 7 })] } });
      expect(collector.getTraceSpans(profile)).toEqual([
        {
          kind: 'db',
          label: 'query',
          startedAt: 0,
          duration: 7,
          status: 'ok',
          source: { collector: 'plain', index: 0, tab: 'plain' },
          meta: undefined,
        },
      ]);
    });

    it('returns an empty array when nothing was collected', () => {
      expect(new PlainCollector().getTraceSpans(makeProfile())).toEqual([]);
    });
  });
});
