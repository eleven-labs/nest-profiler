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
