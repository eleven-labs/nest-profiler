import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import type { Profile } from '../../interfaces/profile.interface';
import type { IProfilerStorageAdapter, StorageFindOptions } from '../storage-adapter.interface';
import { applyProfileFilters } from '../storage-filters';
import type { IndexAttributesProvider, SummaryPrimitive } from '../profile-summary';
import { summarizeProfile } from '../profile-summary';
import type { FilterCriterion, ProfilerPage, ProfilerQuery } from '../profiler-query';

export interface SqliteStorageAdapterOptions {
  /**
   * SQLite database file. Relative paths resolve from `process.cwd()`; the parent
   * directory is created automatically. Use `':memory:'` for an ephemeral, single-
   * connection database. Default: `.profiler/profiler.db`.
   */
  path?: string;
  /** Maximum profiles kept (LRU eviction by `createdAt`). Default: 100. Set to `0` (or negative) for no cap. */
  maxProfiles?: number;
  /** Profile TTL in seconds. Default: 3600 (1h). Set to `0` (or negative) to never expire. */
  ttl?: number;
  /**
   * Busy-handler timeout in milliseconds for a locked database — how long a write waits on a
   * concurrent writer before giving up (better-sqlite3's synchronous busy wait). Default: 5000.
   */
  busyTimeout?: number;
  /**
   * How to handle a corrupt database file on open. `'recreate'` (default) moves the corrupt file
   * aside (to `<path>.corrupt-<timestamp>`, sidecars included) and starts a fresh database;
   * `'throw'` surfaces an actionable error and leaves the file untouched. Only applies to file
   * databases — `':memory:'` can never be corrupt.
   */
  onCorruption?: 'recreate' | 'throw';
}

/**
 * Saves between amortized housekeeping sweeps (physical expired-row delete + `rowCount` re-sync).
 * The TTL is enforced on every read regardless, so the sweep only reclaims space and corrects drift.
 */
const SWEEP_INTERVAL = 64;

/** Base {@link ProfileSummary} columns, keyed by criterion field name. */
const COLUMN_BY_FIELD: Record<string, string> = {
  type: 'type',
  method: 'method',
  url: 'url',
  statusCode: 'status_code',
  duration: 'duration',
  hasExceptions: 'has_exceptions',
  search: 'search',
};

/**
 * A SQLite-backed {@link IProfilerStorageAdapter} that pushes filtering, sorting and
 * pagination down to the database (`WHERE` / `ORDER BY` / `LIMIT`/`OFFSET` / `COUNT`),
 * so a list render never loads the whole store. Each profile is stored as a row with
 * indexed {@link ProfileSummary} columns (plus its kind-specific attributes as JSON)
 * and the full profile document.
 *
 * Opt in by passing an instance as the `storage` option — the core module never imports
 * `better-sqlite3`, so memory/file users pull no native dependency:
 *
 * ```ts
 * import { SqliteStorageAdapter } from '@eleven-labs/nest-profiler/sqlite';
 * ProfilerModule.forRoot({ storage: new SqliteStorageAdapter({ path: '.profiler/profiler.db' }) });
 * ```
 */
export class SqliteStorageAdapter implements IProfilerStorageAdapter {
  readonly crossProcess: boolean;
  private readonly db: Database.Database;
  private readonly maxProfiles: number;
  private readonly ttlMs: number;
  private readonly busyTimeout: number;
  private readonly onCorruption: 'recreate' | 'throw';
  /** Compiled statements memoized by SQL string — each shape is prepared once. */
  private readonly stmtCache = new Map<string, Database.Statement>();
  /** Physical row count, kept in sync so eviction never sorts the table below the cap. */
  private rowCount = 0;
  /** Saves since the last amortized housekeeping sweep (expired-row delete + count re-sync). */
  private opsSinceSweep = 0;
  private getAttributes?: IndexAttributesProvider;

  constructor(options: SqliteStorageAdapterOptions = {}) {
    const rawPath = options.path ?? path.join('.profiler', 'profiler.db');
    const file =
      rawPath === ':memory:' || path.isAbsolute(rawPath)
        ? rawPath
        : path.join(process.cwd(), rawPath);
    this.crossProcess = rawPath !== ':memory:';
    this.maxProfiles = options.maxProfiles ?? 100;
    this.ttlMs = (options.ttl ?? 3600) * 1000;
    this.busyTimeout = options.busyTimeout ?? 5000;
    this.onCorruption = options.onCorruption ?? 'recreate';

    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = this.open(file);
    this.rowCount = (this.stmt('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
  }

  setIndexAttributesProvider(provider: IndexAttributesProvider): void {
    this.getAttributes = provider;
  }

  save(profile: Profile): void {
    const s = summarizeProfile(profile, this.getAttributes);
    // Point lookup on the primary key (index seek) so the counter stays exact across re-saves —
    // an INSERT OR REPLACE of an existing token must not inflate `rowCount` and over-evict.
    const isNew = !this.stmt('SELECT 1 FROM profiles WHERE token = ?').get(s.token);
    this.stmt(
      `INSERT OR REPLACE INTO profiles
         (token, created_at, type, method, url, status_code, duration, has_exceptions, search, attributes, profile)
         VALUES (@token, @createdAt, @type, @method, @url, @statusCode, @duration, @hasExceptions, @search, @attributes, @profile)`,
    ).run({
      token: s.token,
      createdAt: s.createdAt,
      type: s.type,
      method: s.method ?? null,
      url: s.url ?? null,
      statusCode: s.statusCode ?? null,
      duration: s.duration,
      hasExceptions: s.hasExceptions ? 1 : 0,
      search: s.search,
      attributes: JSON.stringify(s.attributes),
      profile: JSON.stringify(profile),
    });
    if (isNew) this.rowCount++;
    this.evict();
  }

  findOne(token: string): Profile | undefined {
    const row = this.stmt('SELECT profile FROM profiles WHERE token = ? AND created_at >= ?').get(
      token,
      this.minCreatedAt(),
    ) as { profile: string } | undefined;
    return row ? (JSON.parse(row.profile) as Profile) : undefined;
  }

  findAll(options?: StorageFindOptions): Profile[] {
    const rows = this.stmt(
      'SELECT profile FROM profiles WHERE created_at >= ? ORDER BY created_at DESC',
    ).all(this.minCreatedAt()) as { profile: string }[];
    const profiles = rows.map((r) => JSON.parse(r.profile) as Profile);
    return applyProfileFilters(profiles, options);
  }

  query(query: ProfilerQuery): ProfilerPage {
    const { clause, params } = this.buildWhere(query);
    const total = (
      this.stmt(`SELECT COUNT(*) AS n FROM profiles ${clause}`).get(...params) as {
        n: number;
      }
    ).n;

    const direction = query.sort?.direction === 'asc' ? 'ASC' : 'DESC';
    const offset = Math.max(0, (query.page - 1) * query.pageSize);
    const rows = this.stmt(
      // `token` tie-breaker keeps pagination deterministic when two profiles share a
      // millisecond timestamp (matches the in-memory selectPage ordering).
      `SELECT profile FROM profiles ${clause} ORDER BY created_at ${direction}, token ${direction} LIMIT ? OFFSET ?`,
    ).all(...params, query.pageSize, offset) as { profile: string }[];

    return { items: rows.map((r) => JSON.parse(r.profile) as Profile), total };
  }

  distinct(field: string, typeIn?: string[]): SummaryPrimitive[] {
    const expr = this.fieldExpr(field);
    const conditions = [`created_at >= ?`, `${expr} IS NOT NULL`, `${expr} <> ''`];
    const params: unknown[] = [this.minCreatedAt()];
    if (typeIn && typeIn.length > 0) {
      conditions.push(`type IN (${typeIn.map(() => '?').join(', ')})`);
      params.push(...typeIn);
    }
    const rows = this.stmt(
      `SELECT DISTINCT ${expr} AS v FROM profiles WHERE ${conditions.join(' AND ')}`,
    ).all(...params) as { v: SummaryPrimitive }[];
    return rows.map((r) => r.v);
  }

  clear(): void {
    this.stmt('DELETE FROM profiles').run();
    this.rowCount = 0;
  }

  /** Closes the underlying database handle. */
  close(): void {
    this.db.close();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Prepares a statement once per SQL string and reuses it for subsequent calls. */
  private stmt(sql: string): Database.Statement {
    let statement = this.stmtCache.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.stmtCache.set(sql, statement);
    }
    return statement;
  }

  /** Earliest `created_at` a read may return. A non-positive TTL disables expiry (returns 0). */
  private minCreatedAt(): number {
    return this.ttlMs > 0 ? Date.now() - this.ttlMs : 0;
  }

  /**
   * Keeps the store bounded from the in-memory {@link rowCount}, without sorting the table on
   * every save. The TTL is already enforced on reads (`created_at >= minCreatedAt()`), so the
   * physical expired-row delete is only housekeeping — run amortized every {@link SWEEP_INTERVAL}
   * saves, where it also re-syncs the counter from `COUNT(*)` to absorb writes by another process
   * on a shared file database. The overflow trim stays synchronous because `findAll` has no
   * `LIMIT`, but only fires once actually over the cap.
   */
  private evict(): void {
    if (++this.opsSinceSweep >= SWEEP_INTERVAL) {
      this.opsSinceSweep = 0;
      // A non-positive TTL disables expiry.
      if (this.ttlMs > 0) {
        this.stmt('DELETE FROM profiles WHERE created_at < ?').run(Date.now() - this.ttlMs);
      }
      this.rowCount = (this.stmt('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
    }

    // A non-positive cap disables overflow trimming. Delete the oldest rows first (expired rows,
    // if any, are the oldest) so a read never sees more than `maxProfiles` live profiles.
    if (this.maxProfiles > 0 && this.rowCount > this.maxProfiles) {
      const { changes } = this.stmt(
        `DELETE FROM profiles WHERE token IN (
           SELECT token FROM profiles ORDER BY created_at ASC, token ASC LIMIT ?
         )`,
      ).run(this.rowCount - this.maxProfiles);
      this.rowCount -= changes;
    }
  }

  /**
   * Opens the database and applies pragmas + schema. On a corrupt file, either recreates a fresh
   * database (moving the corrupt one aside) or rethrows, per {@link onCorruption}; any other
   * failure is rethrown with an actionable, cause-chained message.
   */
  private open(file: string): Database.Database {
    let db: Database.Database | undefined;
    try {
      db = new Database(file, { timeout: this.busyTimeout });
      return this.configure(db);
    } catch (err) {
      // Corruption usually surfaces when the schema first reads the file — release the handle
      // before moving the file so the reopen starts clean (and no lock lingers on Windows).
      db?.close();
      if (file !== ':memory:' && this.onCorruption === 'recreate' && isCorruption(err)) {
        const aside = `${file}.corrupt-${Date.now()}`;
        moveAside(file, aside);
        const db = this.configure(new Database(file, { timeout: this.busyTimeout }));
        console.warn(
          `[nest-profiler] SQLite database at ${file} was corrupt; moved it to ${aside} and recreated a fresh database.`,
        );
        return db;
      }
      throw new Error(
        `Failed to open SQLite profiler database at ${file}: ${(err as Error).message}`,
        { cause: err },
      );
    }
  }

  /** Applies the WAL pragma (cross-process only) and the schema to a freshly opened handle. */
  private configure(db: Database.Database): Database.Database {
    // WAL lets separate processes read while one writes — matches the cross-process contract.
    if (this.crossProcess) db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    return db;
  }

  /** The SQL expression for a criterion field: a base column or a JSON attribute path. */
  private fieldExpr(field: string): string {
    const column = COLUMN_BY_FIELD[field];
    if (column) return column;
    if (field.startsWith('attributes.')) {
      // Attribute keys come from filter definitions (developer-controlled), not user input;
      // still, restrict to a safe identifier so the JSON path can't inject SQL.
      const key = field.slice('attributes.'.length).replace(/[^A-Za-z0-9_]/g, '');
      return `json_extract(attributes, '$.${key}')`;
    }
    // Unknown field — an expression that matches nothing.
    return `NULL`;
  }

  /** Translates one criterion into a SQL fragment and its bound parameters. */
  private criterionSql(criterion: FilterCriterion): { sql: string; params: unknown[] } {
    const expr = this.fieldExpr(criterion.field);
    const value = criterion.value;
    switch (criterion.op) {
      case 'eq':
        if (typeof value === 'string') return { sql: `LOWER(${expr}) = LOWER(?)`, params: [value] };
        if (typeof value === 'boolean') return { sql: `${expr} = ?`, params: [value ? 1 : 0] };
        return { sql: `${expr} = ?`, params: [value] };
      case 'gte':
        return { sql: `${expr} >= ?`, params: [value] };
      case 'lte':
        return { sql: `${expr} <= ?`, params: [value] };
      case 'range': {
        const [min, max] = value as [number, number];
        return { sql: `${expr} BETWEEN ? AND ?`, params: [min, max] };
      }
      case 'contains': {
        // Escape LIKE wildcards (`%`, `_`) and the escape char itself so a user filter like
        // "50%" matches literally instead of acting as a wildcard (false positives).
        const escaped = String(value)
          .toLowerCase()
          .replace(/[\\%_]/g, (ch) => `\\${ch}`);
        return { sql: `LOWER(${expr}) LIKE ? ESCAPE '\\'`, params: [`%${escaped}%`] };
      }
      case 'truthy':
        return { sql: `${expr} IS NOT NULL AND ${expr} NOT IN (0, '')`, params: [] };
      default:
        return { sql: '0 = 1', params: [] };
    }
  }

  /** Builds the full `WHERE` clause (TTL + type constraint + criteria) and its params. */
  private buildWhere(query: ProfilerQuery): { clause: string; params: unknown[] } {
    const conditions: string[] = ['created_at >= ?'];
    const params: unknown[] = [this.minCreatedAt()];

    if (query.typeIn && query.typeIn.length > 0) {
      conditions.push(`type IN (${query.typeIn.map(() => '?').join(', ')})`);
      params.push(...query.typeIn);
    }
    if (query.typeNotIn && query.typeNotIn.length > 0) {
      conditions.push(`type NOT IN (${query.typeNotIn.map(() => '?').join(', ')})`);
      params.push(...query.typeNotIn);
    }
    for (const criterion of query.filters) {
      const { sql, params: p } = this.criterionSql(criterion);
      conditions.push(`(${sql})`);
      params.push(...p);
    }

    return { clause: `WHERE ${conditions.join(' AND ')}`, params };
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS profiles (
    token TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    type TEXT NOT NULL,
    method TEXT,
    url TEXT,
    status_code INTEGER,
    duration INTEGER NOT NULL DEFAULT 0,
    has_exceptions INTEGER NOT NULL DEFAULT 0,
    search TEXT NOT NULL DEFAULT '',
    attributes TEXT NOT NULL DEFAULT '{}',
    profile TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at);
  CREATE INDEX IF NOT EXISTS idx_profiles_type ON profiles(type);
  CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status_code);
  CREATE INDEX IF NOT EXISTS idx_profiles_duration ON profiles(duration);
`;

/** True when an open error is SQLite reporting a corrupt / non-database file (recoverable). */
function isCorruption(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') return true;
  return /file is not a database|malformed/i.test((err as Error).message ?? '');
}

/** Renames a corrupt database file and its `-wal`/`-shm` sidecars aside, best-effort. */
function moveAside(file: string, aside: string): void {
  const renames: Array<[string, string]> = [
    [file, aside],
    [`${file}-wal`, `${aside}-wal`],
    [`${file}-shm`, `${aside}-shm`],
  ];
  for (const [from, to] of renames) {
    try {
      fs.renameSync(from, to);
    } catch {
      // Sidecars may not exist; the main file rename failing surfaces on the reopen below.
    }
  }
}
