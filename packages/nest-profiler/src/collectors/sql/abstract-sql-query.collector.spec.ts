import * as path from 'path';
import { AbstractSqlQueryCollector } from './abstract-sql-query.collector';
import { detectQueryType } from './sql-query.interface';
import type { QueryEntry } from './sql-query.interface';
import type { Profile } from '../../interfaces/profile.interface';

const QUERIES_KEY = '__test_sql_queries';

class TestSqlCollector extends AbstractSqlQueryCollector {
  readonly name = 'test-sql';
  protected readonly queriesKey = QUERIES_KEY;
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

function makeQuery(overrides: Partial<QueryEntry> = {}): QueryEntry {
  return {
    sql: 'SELECT * FROM users',
    duration: 10,
    type: 'SELECT',
    startedAt: Date.now(),
    ...overrides,
  };
}

const slowTag = { id: 'slow', label: 'Slow', severity: 'warning' as const };

describe('AbstractSqlQueryCollector', () => {
  let collector: TestSqlCollector;

  beforeEach(() => {
    collector = new TestSqlCollector();
  });

  it('returns the private queries key entries with a fingerprint and removes them from collectors', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [QUERIES_KEY]: [q] } });
    const result = collector.collect(profile);
    expect(result).toEqual([{ ...q, fingerprint: 'SELECT * FROM users' }]);
    expect(profile.collectors[QUERIES_KEY]).toBeUndefined();
  });

  it('returns empty array when no queries', () => {
    expect(collector.collect(makeProfile())).toEqual([]);
  });

  it('getBadgeValue returns null when no queries', () => {
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
  });

  it('getBadgeValue shows query count', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [QUERIES_KEY]: [q, q] } });
    expect(collector.getBadgeValue(profile)).toBe('2q');
  });

  it('getBadgeValue is a plain query count; getBadgeSeverity reflects the tags', () => {
    const slow = makeQuery({ tags: [slowTag] });
    const fast = makeQuery();
    const profile = makeProfile({ collectors: { [QUERIES_KEY]: [slow, fast] } });
    expect(collector.getBadgeValue(profile)).toBe('2q');
    expect(collector.getBadgeSeverity(profile)).toBe('warning');
  });

  it('getBadgeValue reads from profile.collectors[name] after collect() has run', () => {
    const q = makeQuery();
    const profile = makeProfile({ collectors: { [QUERIES_KEY]: [q, q] } });
    profile.collectors[collector.name] = collector.collect(profile);
    expect(profile.collectors[QUERIES_KEY]).toBeUndefined();
    expect(collector.getBadgeValue(profile)).toBe('2q');
  });

  it('getTemplatePath returns an absolute path ending with sql-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/sql-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });

  describe('buildSummary', () => {
    it('contributes DB tiles and a highlighted slowest-queries table linked to the profile', () => {
      const p1 = makeProfile({
        token: 'sql-p1',
        collectors: {
          'test-sql': [
            makeQuery({ duration: 20 }),
            makeQuery({ duration: 150, sql: 'SELECT slow' }),
          ],
        },
      });
      const p2 = makeProfile({
        token: 'sql-p2',
        collectors: { 'test-sql': [makeQuery({ duration: 5 })] },
      });
      const section = collector.buildSummary([p1, p2]);
      expect(section?.name).toBe('test-sql');
      // 3 queries; mean duration (20+150+5)/3 = 58.3ms; one query ≥100ms is slow.
      expect(section?.tiles).toEqual([
        { label: 'Queries', value: '3' },
        { label: 'Avg time', value: '58.3 ms' },
        { label: 'Slow queries', value: '1', hint: '≥ 100 ms', severity: 'warning' },
      ]);
      // The shared query-summary table, SQL highlighting on, with each row's profile token.
      expect(section?.templatePath).toMatch(/query-summary\.ejs$/);
      const data = section?.data as {
        highlight: boolean;
        tab: string;
        subtab?: string;
        entries: { label: string; duration: number; token: string }[];
      };
      expect(data.highlight).toBe(true);
      // Ungrouped collector → the tab is its own name, no sub-tab.
      expect(data.tab).toBe('test-sql');
      expect(data.subtab).toBeUndefined();
      expect(data.entries).toHaveLength(3);
      expect(data.entries[0]).toEqual({ label: 'SELECT slow', duration: 150, token: 'sql-p1' });
    });

    it('contributes nothing when the window ran no queries', () => {
      expect(collector.buildSummary([makeProfile()])).toBeUndefined();
    });
  });
});

describe('detectQueryType', () => {
  it.each([
    ['SELECT * FROM users', 'SELECT'],
    ['INSERT INTO users VALUES (1)', 'INSERT'],
    ['UPDATE users SET x = 1', 'UPDATE'],
    ['DELETE FROM users', 'DELETE'],
    ['BEGIN TRANSACTION', 'OTHER'],
  ])('classifies %s as %s', (sql, expected) => {
    expect(detectQueryType(sql)).toBe(expected);
  });

  it('trims leading whitespace and is case-insensitive', () => {
    expect(detectQueryType('   select 1')).toBe('SELECT');
  });
});
