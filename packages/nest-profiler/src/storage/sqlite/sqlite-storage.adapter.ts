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
  /** Maximum number of profiles kept (LRU eviction by `createdAt`). Default: 100 */
  maxProfiles?: number;
  /** Profile TTL in seconds. Default: 3600 (1h) */
  ttl?: number;
}

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

    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    // WAL lets separate processes read while one writes — matches the cross-process contract.
    if (this.crossProcess) this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  setIndexAttributesProvider(provider: IndexAttributesProvider): void {
    this.getAttributes = provider;
  }

  save(profile: Profile): void {
    const s = summarizeProfile(profile, this.getAttributes);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO profiles
         (token, created_at, type, method, url, status_code, duration, has_exceptions, search, attributes, profile)
         VALUES (@token, @createdAt, @type, @method, @url, @statusCode, @duration, @hasExceptions, @search, @attributes, @profile)`,
      )
      .run({
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
    this.evict();
  }

  findOne(token: string): Profile | undefined {
    const row = this.db
      .prepare('SELECT profile FROM profiles WHERE token = ? AND created_at >= ?')
      .get(token, this.minCreatedAt()) as { profile: string } | undefined;
    return row ? (JSON.parse(row.profile) as Profile) : undefined;
  }

  findAll(options?: StorageFindOptions): Profile[] {
    const rows = this.db
      .prepare('SELECT profile FROM profiles WHERE created_at >= ? ORDER BY created_at DESC')
      .all(this.minCreatedAt()) as { profile: string }[];
    const profiles = rows.map((r) => JSON.parse(r.profile) as Profile);
    return applyProfileFilters(profiles, options);
  }

  query(query: ProfilerQuery): ProfilerPage {
    const { clause, params } = this.buildWhere(query);
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM profiles ${clause}`).get(...params) as {
        n: number;
      }
    ).n;

    const direction = query.sort?.direction === 'asc' ? 'ASC' : 'DESC';
    const offset = Math.max(0, (query.page - 1) * query.pageSize);
    const rows = this.db
      .prepare(
        `SELECT profile FROM profiles ${clause} ORDER BY created_at ${direction} LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, offset) as { profile: string }[];

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
    const rows = this.db
      .prepare(`SELECT DISTINCT ${expr} AS v FROM profiles WHERE ${conditions.join(' AND ')}`)
      .all(...params) as { v: SummaryPrimitive }[];
    return rows.map((r) => r.v);
  }

  clear(): void {
    this.db.prepare('DELETE FROM profiles').run();
  }

  /** Closes the underlying database handle. */
  close(): void {
    this.db.close();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private minCreatedAt(): number {
    return Date.now() - this.ttlMs;
  }

  /** Deletes expired rows, then trims the oldest rows beyond `maxProfiles`. */
  private evict(): void {
    this.db.prepare('DELETE FROM profiles WHERE created_at < ?').run(this.minCreatedAt());
    this.db
      .prepare(
        `DELETE FROM profiles WHERE token IN (
           SELECT token FROM profiles ORDER BY created_at DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(this.maxProfiles);
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
      case 'contains':
        return { sql: `LOWER(${expr}) LIKE ?`, params: [`%${String(value).toLowerCase()}%`] };
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
