import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type Client, type InValue, type Row } from '@libsql/client';
import type { Profile } from '../../interfaces/profile.interface';
import type { IProfilerStorageAdapter, StorageFindOptions } from '../storage-adapter.interface';
import { applyProfileFilters } from '../storage-filters';
import type { IndexAttributesProvider, SummaryPrimitive } from '../profile-summary';
import { summarizeProfile } from '../profile-summary';
import type { FilterCriterion, ProfilerPage, ProfilerQuery } from '../profiler-query';

export interface SqliteStorageAdapterOptions {
  /**
   * SQLite database file for a **local** database. Relative paths resolve from `process.cwd()`;
   * the parent directory is created automatically. Use `':memory:'` for an ephemeral, single-
   * connection database. Default: `.profiler/profiler.db`. Ignored when `url` is set.
   */
  path?: string;
  /**
   * libSQL URL for a **remote** SQLite database (a `libsql://…` / `http(s)://…` endpoint). When set,
   * it takes precedence over `path`, and the store is cross-process. Pair with `authToken` if the
   * server requires one.
   */
  url?: string;
  /** Auth token for the remote `url`. Ignored for a local `path` database. */
  authToken?: string;
  /** Maximum profiles kept (LRU eviction by `createdAt`). Default: 100. Set to `0` (or negative) for no cap. */
  maxProfiles?: number;
  /** Profile TTL in seconds. Default: 3600 (1h). Set to `0` (or negative) to never expire. */
  ttl?: number;
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
  tags: 'tags',
  search: 'search',
};

/**
 * A libSQL-backed {@link IProfilerStorageAdapter} that pushes filtering, sorting and pagination
 * down to the database (`WHERE` / `ORDER BY` / `LIMIT`/`OFFSET` / `COUNT`), so a list render never
 * loads the whole store. Each profile is stored as a row with indexed {@link ProfileSummary}
 * columns (plus its kind-specific attributes as JSON) and the full profile document.
 *
 * One adapter serves three targets via `@libsql/client`: an ephemeral `':memory:'` database, a
 * local file, or a remote SQLite database (`url` + optional `authToken`) — so the same code runs
 * locally and on a serverless host. Opt in by passing an instance as the `storage` option — the core
 * module never imports `@libsql/client`, so memory/file users pull no extra dependency:
 *
 * ```ts
 * import { SqliteStorageAdapter } from '@eleven-labs/nest-profiler/sqlite';
 *
 * // Local file (default) or ':memory:'
 * ProfilerModule.forRoot({ storage: new SqliteStorageAdapter({ path: '.profiler/profiler.db' }) });
 *
 * // Remote SQLite database
 * ProfilerModule.forRoot({
 *   storage: new SqliteStorageAdapter({
 *     url: process.env.PROFILER_STORAGE_URL!,
 *     authToken: process.env.PROFILER_STORAGE_AUTH_TOKEN,
 *   }),
 * });
 * ```
 */
export class SqliteStorageAdapter implements IProfilerStorageAdapter {
  readonly crossProcess: boolean;
  private readonly client: Client;
  private readonly maxProfiles: number;
  private readonly ttlMs: number;
  /** WAL is applied only to a local file database (cross-process reads); not a `:memory:`/remote concern. */
  private readonly localFile: boolean;
  /** Physical row count, kept in sync so eviction never sorts the table below the cap. */
  private rowCount = 0;
  /** Saves since the last amortized housekeeping sweep (expired-row delete + count re-sync). */
  private opsSinceSweep = 0;
  private getAttributes?: IndexAttributesProvider;
  /** Resolves once the schema (and WAL, for a local file) is applied and `rowCount` is seeded. */
  private readonly ready: Promise<void>;

  constructor(options: SqliteStorageAdapterOptions = {}) {
    this.maxProfiles = options.maxProfiles ?? 100;
    this.ttlMs = (options.ttl ?? 3600) * 1000;

    if (options.url) {
      // Remote SQLite database — takes precedence over `path`; shared across processes.
      this.client = createClient({ url: options.url, authToken: options.authToken });
      this.crossProcess = true;
      this.localFile = false;
    } else {
      const rawPath = options.path ?? path.join('.profiler', 'profiler.db');
      if (rawPath === ':memory:') {
        this.client = createClient({ url: ':memory:' });
        this.crossProcess = false;
        this.localFile = false;
      } else {
        const file = path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        this.client = createClient({ url: `file:${file}` });
        this.crossProcess = true;
        this.localFile = true;
      }
    }

    this.ready = this.configure();
  }

  setIndexAttributesProvider(provider: IndexAttributesProvider): void {
    this.getAttributes = provider;
  }

  async save(profile: Profile): Promise<void> {
    await this.ready;
    const s = summarizeProfile(profile, this.getAttributes);
    // Point lookup on the primary key (index seek) so the counter stays exact across re-saves —
    // an INSERT OR REPLACE of an existing token must not inflate `rowCount` and over-evict.
    const existing = await this.client.execute({
      sql: 'SELECT 1 FROM profiles WHERE token = ?',
      args: [s.token],
    });
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO profiles
         (token, created_at, type, method, url, status_code, duration, has_exceptions, tags, search, attributes, profile)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        s.token,
        s.createdAt,
        s.type,
        s.method ?? null,
        s.url ?? null,
        s.statusCode ?? null,
        s.duration,
        s.hasExceptions ? 1 : 0,
        s.tags,
        s.search,
        JSON.stringify(s.attributes),
        JSON.stringify(profile),
      ],
    });
    if (existing.rows.length === 0) this.rowCount++;
    await this.evict();
  }

  async findOne(token: string): Promise<Profile | undefined> {
    await this.ready;
    const result = await this.client.execute({
      sql: 'SELECT profile FROM profiles WHERE token = ? AND created_at >= ?',
      args: [token, this.minCreatedAt()],
    });
    const profile = stringColumn(result.rows[0], 'profile');
    return profile ? (JSON.parse(profile) as Profile) : undefined;
  }

  async findAll(options?: StorageFindOptions): Promise<Profile[]> {
    await this.ready;
    const result = await this.client.execute({
      sql: 'SELECT profile FROM profiles WHERE created_at >= ? ORDER BY created_at DESC',
      args: [this.minCreatedAt()],
    });
    const profiles = result.rows.map((row) => JSON.parse(stringColumn(row, 'profile')) as Profile);
    return applyProfileFilters(profiles, options);
  }

  async query(query: ProfilerQuery): Promise<ProfilerPage> {
    await this.ready;
    const { clause, params } = this.buildWhere(query);
    const count = await this.client.execute({
      sql: `SELECT COUNT(*) AS n FROM profiles ${clause}`,
      args: params,
    });
    const total = numberColumn(count.rows[0], 'n');

    const direction = query.sort?.direction === 'asc' ? 'ASC' : 'DESC';
    const offset = Math.max(0, (query.page - 1) * query.pageSize);
    const result = await this.client.execute({
      // `token` tie-breaker keeps pagination deterministic when two profiles share a
      // millisecond timestamp (matches the in-memory selectPage ordering).
      sql: `SELECT profile FROM profiles ${clause} ORDER BY created_at ${direction}, token ${direction} LIMIT ? OFFSET ?`,
      args: [...params, query.pageSize, offset],
    });

    return {
      items: result.rows.map((row) => JSON.parse(stringColumn(row, 'profile')) as Profile),
      total,
    };
  }

  async distinct(field: string, typeIn?: string[]): Promise<SummaryPrimitive[]> {
    await this.ready;
    const expr = this.fieldExpr(field);
    const conditions = [`created_at >= ?`, `${expr} IS NOT NULL`, `${expr} <> ''`];
    const params: InValue[] = [this.minCreatedAt()];
    if (typeIn && typeIn.length > 0) {
      conditions.push(`type IN (${typeIn.map(() => '?').join(', ')})`);
      params.push(...typeIn);
    }
    const result = await this.client.execute({
      sql: `SELECT DISTINCT ${expr} AS v FROM profiles WHERE ${conditions.join(' AND ')}`,
      args: params,
    });
    return result.rows.map((row) => summaryColumn(row, 'v'));
  }

  async clear(): Promise<void> {
    await this.ready;
    await this.client.execute('DELETE FROM profiles');
    this.rowCount = 0;
  }

  /** Closes the underlying client. Awaits `ready` first so a pending init never rejects unhandled. */
  async close(): Promise<void> {
    await this.ready.catch(() => {});
    this.client.close();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Applies the WAL pragma (local file only) and the schema, then seeds the row count. */
  private async configure(): Promise<void> {
    // WAL lets separate processes read while one writes — matches the cross-process contract for a
    // local file. It is meaningless for `:memory:` and managed by the server for remote libSQL.
    if (this.localFile) await this.client.execute('PRAGMA journal_mode = WAL');
    await this.client.executeMultiple(SCHEMA);
    this.rowCount = await this.countRows();
  }

  private async countRows(): Promise<number> {
    const result = await this.client.execute('SELECT COUNT(*) AS n FROM profiles');
    return numberColumn(result.rows[0], 'n');
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
   * on a shared database. The overflow trim stays inline because `findAll` has no `LIMIT`, but only
   * fires once actually over the cap.
   */
  private async evict(): Promise<void> {
    if (++this.opsSinceSweep >= SWEEP_INTERVAL) {
      this.opsSinceSweep = 0;
      // A non-positive TTL disables expiry.
      if (this.ttlMs > 0) {
        await this.client.execute({
          sql: 'DELETE FROM profiles WHERE created_at < ?',
          args: [Date.now() - this.ttlMs],
        });
      }
      this.rowCount = await this.countRows();
    }

    // A non-positive cap disables overflow trimming. Delete the oldest rows first (expired rows,
    // if any, are the oldest) so a read never sees more than `maxProfiles` live profiles.
    if (this.maxProfiles > 0 && this.rowCount > this.maxProfiles) {
      const result = await this.client.execute({
        sql: `DELETE FROM profiles WHERE token IN (
           SELECT token FROM profiles ORDER BY created_at ASC, token ASC LIMIT ?
         )`,
        args: [this.rowCount - this.maxProfiles],
      });
      this.rowCount -= result.rowsAffected;
    }
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
  private criterionSql(criterion: FilterCriterion): { sql: string; params: InValue[] } {
    const expr = this.fieldExpr(criterion.field);
    const value = criterion.value;
    switch (criterion.op) {
      case 'eq':
        if (typeof value === 'string') return { sql: `LOWER(${expr}) = LOWER(?)`, params: [value] };
        if (typeof value === 'boolean') return { sql: `${expr} = ?`, params: [value ? 1 : 0] };
        return { sql: `${expr} = ?`, params: [value as InValue] };
      case 'gte':
        return { sql: `${expr} >= ?`, params: [value as InValue] };
      case 'lte':
        return { sql: `${expr} <= ?`, params: [value as InValue] };
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
  private buildWhere(query: ProfilerQuery): { clause: string; params: InValue[] } {
    const conditions: string[] = ['created_at >= ?'];
    const params: InValue[] = [this.minCreatedAt()];

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
    tags TEXT NOT NULL DEFAULT '',
    search TEXT NOT NULL DEFAULT '',
    attributes TEXT NOT NULL DEFAULT '{}',
    profile TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at);
  CREATE INDEX IF NOT EXISTS idx_profiles_type ON profiles(type);
  CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status_code);
  CREATE INDEX IF NOT EXISTS idx_profiles_duration ON profiles(duration);
`;

// The `profile` column always holds the JSON document as text; a non-string is corruption we treat
// as absent rather than stringifying into a bogus '[object Object]'.
function stringColumn(row: Row | undefined, column: string): string {
  const value = row?.[column];
  return typeof value === 'string' ? value : '';
}

function numberColumn(row: Row | undefined, column: string): number {
  const value = row?.[column];
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

// `distinct` filters out NULL / '' in SQL and only reads text/number columns, so a value is always a
// bound summary primitive (libSQL returns integers as numbers under its default int mode).
function summaryColumn(row: Row, column: string): SummaryPrimitive {
  return row[column] as SummaryPrimitive;
}
