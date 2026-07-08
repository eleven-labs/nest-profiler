import { AbstractQueryCollector } from './abstract-query.collector';
import type { Profile } from '../interfaces/profile.interface';

interface TestEntry {
  id: number;
  isSlow: boolean;
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
  return { id: 1, isSlow: false, ...overrides };
}

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
        { id: 1, isSlow: false, command: 'run-1' },
        { id: 2, isSlow: false, command: 'run-2' },
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

    it('includes the slow count when some queries are slow', () => {
      const collector = new PlainCollector();
      const profile = makeProfile({
        collectors: { [QUERIES_KEY]: [makeEntry({ isSlow: true }), makeEntry()] },
      });
      expect(collector.getBadgeValue(profile)).toBe('2q (1 slow)');
    });

    it('reads from profile.collectors[name] once collect() has stored the entries', () => {
      const collector = new PlainCollector();
      const profile = makeProfile({ collectors: { [QUERIES_KEY]: [makeEntry(), makeEntry()] } });
      profile.collectors[collector.name] = collector.collect(profile);
      expect(profile.collectors[QUERIES_KEY]).toBeUndefined();
      expect(collector.getBadgeValue(profile)).toBe('2q');
    });
  });
});
