import * as path from 'path';
import { AbstractSqlQueryCollector } from './abstract-sql-query.collector';
import { detectQueryType, detectTransactionBoundary } from './sql-query.interface';
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

  describe('getTraceSpans', () => {
    it('maps queries to db spans with a one-line SQL label and type/rowCount meta', () => {
      const q = makeQuery({
        sql: 'SELECT   *\n  FROM users\n  WHERE id = $1',
        startedAt: 1000,
        duration: 8,
        rowCount: 1,
        connection: 'localhost:5432',
      });
      const profile = makeProfile({ collectors: { [collector.name]: [q] } });
      expect(collector.getTraceSpans(profile)).toEqual([
        {
          kind: 'db',
          label: 'SELECT * FROM users WHERE id = $1',
          startedAt: 1000,
          duration: 8,
          status: 'ok',
          source: { collector: 'test-sql', index: 0, tab: 'test-sql' },
          meta: { type: 'SELECT', rowCount: 1, connection: 'localhost:5432' },
        },
      ]);
    });

    it('keeps the full SQL (collapsed to one line) as the label', () => {
      const q = makeQuery({ sql: 'SELECT a,\n   b\nFROM t' });
      const profile = makeProfile({ collectors: { [collector.name]: [q] } });
      expect(collector.getTraceSpans(profile)[0]!.label).toBe('SELECT a, b FROM t');
    });

    it('marks an errored query as an error span', () => {
      const q = makeQuery({ error: 'syntax error' });
      const profile = makeProfile({ collectors: { [collector.name]: [q] } });
      expect(collector.getTraceSpans(profile)[0]!.status).toBe('error');
    });

    it('wraps a BEGIN … COMMIT run in a container span spanning the whole transaction', () => {
      const queries = [
        makeQuery({ sql: 'START TRANSACTION', type: 'OTHER', startedAt: 1000, duration: 0.2 }),
        makeQuery({
          sql: 'INSERT INTO products VALUES (1)',
          type: 'INSERT',
          startedAt: 1001,
          duration: 0.6,
        }),
        makeQuery({ sql: 'COMMIT', type: 'OTHER', startedAt: 1002, duration: 1.4 }),
      ];
      const profile = makeProfile({ collectors: { [collector.name]: queries } });
      const spans = collector.getTraceSpans(profile);

      expect(spans.map((s) => s.label)).toEqual([
        'transaction',
        'START TRANSACTION',
        'INSERT INTO products VALUES (1)',
        'COMMIT',
      ]);
      const [tx, ...children] = spans;
      expect(tx).toMatchObject({
        kind: 'db',
        container: true,
        startedAt: 1000,
        // start of BEGIN → end of COMMIT, not the boundary statement's own time
        duration: 3.4,
        meta: { statements: 1 },
      });
      for (const child of children) expect(child.parentId).toBe(tx!.id);
    });

    it('labels a rolled-back transaction and propagates a failed statement', () => {
      const queries = [
        makeQuery({ sql: 'BEGIN', type: 'OTHER', startedAt: 1000, duration: 0 }),
        makeQuery({
          sql: 'INSERT INTO t VALUES (1)',
          type: 'INSERT',
          startedAt: 1001,
          duration: 1,
          error: 'duplicate key',
        }),
        makeQuery({ sql: 'ROLLBACK', type: 'OTHER', startedAt: 1003, duration: 0.5 }),
      ];
      const profile = makeProfile({ collectors: { [collector.name]: queries } });
      const tx = collector.getTraceSpans(profile)[0]!;
      expect(tx.label).toBe('transaction (rolled back)');
      expect(tx.status).toBe('error');
    });

    it('keeps two connections apart and leaves queries outside a transaction at top level', () => {
      const queries = [
        makeQuery({ sql: 'SELECT 1', startedAt: 1000, duration: 1, connection: 'a' }),
        makeQuery({ sql: 'BEGIN', type: 'OTHER', startedAt: 1001, duration: 0, connection: 'a' }),
        makeQuery({ sql: 'SELECT 2', startedAt: 1002, duration: 1, connection: 'b' }),
        makeQuery({
          sql: 'UPDATE t SET x = 1',
          type: 'UPDATE',
          startedAt: 1003,
          duration: 1,
          connection: 'a',
        }),
        makeQuery({
          sql: 'COMMIT',
          type: 'OTHER',
          startedAt: 1004,
          duration: 0.5,
          connection: 'a',
        }),
      ];
      const profile = makeProfile({ collectors: { [collector.name]: queries } });
      const spans = collector.getTraceSpans(profile);
      const tx = spans.find((s) => s.label === 'transaction')!;
      expect(spans.find((s) => s.label === 'SELECT 1')!.parentId).toBeUndefined();
      expect(spans.find((s) => s.label === 'SELECT 2')!.parentId).toBeUndefined();
      expect(spans.find((s) => s.label === 'UPDATE t SET x = 1')!.parentId).toBe(tx.id);
      expect(tx.meta).toMatchObject({ statements: 1 });
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

describe('detectTransactionBoundary', () => {
  it.each([
    ['BEGIN', 'begin'],
    ['begin transaction', 'begin'],
    ['START TRANSACTION', 'begin'],
    ['  COMMIT ', 'commit'],
    ['ROLLBACK', 'rollback'],
  ])('classifies %s as %s', (sql, expected) => {
    expect(detectTransactionBoundary(sql)).toBe(expected);
  });

  it.each(['SELECT 1', 'ROLLBACK TO SAVEPOINT sp1', 'SAVEPOINT sp1'])(
    'returns null for %s',
    (sql) => {
      expect(detectTransactionBoundary(sql)).toBeNull();
    },
  );
});
