import { Inject, Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import type { DataSource, QueryRunner } from 'typeorm';
import type { Profile } from '@eleven-labs/nest-profiler';
import { appendCollectorEntry, redact, tryResolve } from '@eleven-labs/nest-profiler';
import type { QueryEntry } from './typeorm-collector.interface';
import { detectQueryType } from './typeorm-collector.interface';
import { TYPEORM_COLLECTOR_OPTIONS } from './typeorm-collector.interface';
import type { TypeOrmCollectorModuleOptions } from './typeorm-collector.interface';

export const TYPEORM_QUERIES_KEY = '__typeorm_queries';

/** Connection metadata derived once from the DataSource, shared by every captured entry. */
interface ConnectionMeta {
  connection?: string;
  database?: string;
}

/**
 * Best-effort row count from a raw driver result, without altering it: an array is a
 * read result-set (or a write with `RETURNING`) so its length is the count; an object
 * carrying `affected`/`rowCount`/`affectedRows`/`changes` covers TypeORM's `QueryResult`
 * and the pg/mysql/better-sqlite3 write results. TypeORM 0.3 QueryBuilder/repository reads
 * call `query(sql, params, useStructuredResult=true)`, which returns a structured `QueryResult`
 * (`{ records, raw, affected }`); for a `SELECT` `affected` is `undefined` and the rows live
 * under `records` (falling back to `raw`), so count those. A write on a driver that exposes
 * none of these yields `undefined` — never a spurious `0`.
 */
function deriveRowCount(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    for (const key of ['affected', 'rowCount', 'affectedRows', 'changes'] as const) {
      const value = r[key];
      if (typeof value === 'number') return value;
    }
    // A structured QueryResult from a read: `affected` is unset, rows sit under records/raw.
    if (Array.isArray(r.records)) return r.records.length;
    if (Array.isArray(r.raw)) return r.raw.length;
  }
  return undefined;
}

/** Reads host:port / database from the DataSource options, omitting anything absent (e.g. sqlite has no host). */
function readConnectionMeta(dataSource: DataSource): ConnectionMeta {
  const options = (dataSource.options ?? {}) as {
    host?: unknown;
    port?: unknown;
    database?: unknown;
  };
  const host = typeof options.host === 'string' ? options.host : undefined;
  const port =
    typeof options.port === 'number' || typeof options.port === 'string' ? options.port : undefined;
  const database = typeof options.database === 'string' ? options.database : undefined;
  return {
    connection: host && port != null ? `${host}:${port}` : undefined,
    database,
  };
}

type PatchableMethod = (...args: unknown[]) => Promise<unknown>;

/** A patched `QueryRunner.query` tagged so a re-used runner is never wrapped twice. */
type PatchedQuery = PatchableMethod & { __profilerPatched?: boolean };

/** A patched `QueryRunner.stream` tagged so a re-used runner is never wrapped twice. */
type PatchedStream = PatchableMethod & { __profilerPatched?: boolean };

/** Minimal Node stream surface used to time a streamed read without touching its data. */
interface LifecycleStream {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** A patched `createQueryRunner` tagged so re-initialisation cannot re-wrap it. */
type PatchedCreateQueryRunner = ((...args: unknown[]) => QueryRunner) & {
  __profilerPatched?: boolean;
};

/** TypeORM internal surface used for monkey-patching createQueryRunner. */
interface PatchableDataSource {
  createQueryRunner: PatchedCreateQueryRunner;
}

/**
 * `cls` and the (optionally named) DataSource are resolved lazily via ModuleRef in
 * `onModuleInit` (a plain `@Optional()` constructor dependency does not traverse to the core's
 * global ClsModule from a dynamic feature module, and the DataSource may be a named connection).
 * When the profiler core is disabled or the configured connection is absent, the patch no-ops.
 */
@Injectable()
export class TypeOrmDriverPatch implements OnModuleInit {
  private readonly logger = new Logger(TypeOrmDriverPatch.name);
  private cls: ClsService | undefined;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(TYPEORM_COLLECTOR_OPTIONS)
    private readonly options: TypeOrmCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    this.cls = tryResolve<ClsService>(this.moduleRef, ClsService);
    if (!this.cls) return;

    const dataSource = tryResolve<DataSource>(
      this.moduleRef,
      getDataSourceToken(this.options.connectionName),
    );
    if (!dataSource) {
      if (this.options.connectionName) {
        this.logger.warn(
          `TypeORM DataSource "${this.options.connectionName}" not found — queries will not be profiled.`,
        );
      }
      return;
    }
    // With manualInitialization the DataSource may not be initialized yet at onModuleInit;
    // warn rather than silently do nothing (MIN-20).
    if (!dataSource.isInitialized) {
      this.logger.warn(
        'TypeORM DataSource is not initialized at bootstrap — queries will not be profiled.',
      );
      return;
    }
    this.patchCreateQueryRunner(dataSource);
  }

  private patchCreateQueryRunner(dataSource: DataSource): void {
    const cls = this.cls;
    const { connection, database } = readConnectionMeta(dataSource);
    const patchable = dataSource as DataSource & PatchableDataSource;
    if (patchable.createQueryRunner.__profilerPatched) return;
    const originalCreate = patchable.createQueryRunner.bind(dataSource);

    const patched: PatchedCreateQueryRunner = function (...args: unknown[]): QueryRunner {
      const qr = originalCreate(...args);
      // SQLite drivers memoise a single QueryRunner, so `createQueryRunner` hands back the same
      // instance every call — guard against re-wrapping its `query`, which would otherwise nest
      // the patch and record each query N times.
      if ((qr.query as PatchedQuery).__profilerPatched) return qr;
      // TypeORM's query() has complex overloads — bind as PatchableMethod (widening cast),
      // then use Reflect.set to assign the patched version without a type conflict on assignment.
      const originalQuery = qr.query.bind(qr) as PatchableMethod;

      const patchedQuery: PatchedQuery = async function (...args: unknown[]): Promise<unknown> {
        const query = String(args[0]);
        const parameters = Array.isArray(args[1]) ? args[1] : undefined;
        const rest = args.slice(2);
        const startedAt = Date.now();
        let error: string | undefined;
        let rowCount: number | undefined;
        try {
          const result = await originalQuery(query, parameters, ...rest);
          rowCount = deriveRowCount(result);
          return result;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          const duration = Date.now() - startedAt;
          try {
            const profile = cls?.get<Profile | undefined>('profiler.profile');
            if (profile) {
              const entry: QueryEntry = {
                sql: query,
                // Redact credentials embedded in bound parameters (DSNs, JWTs, keys) before
                // they are persisted/displayed. Non-sensitive values pass through unchanged.
                parameters: redact(parameters ?? []),
                duration,
                type: detectQueryType(query),
                startedAt,
                error,
                rowCount,
                connection,
                database,
              };
              appendCollectorEntry<QueryEntry>(profile, TYPEORM_QUERIES_KEY, entry);
            }
          } catch {
            // Outside CLS context — ignore
          }
        }
      };

      patchedQuery.__profilerPatched = true;
      Reflect.set(qr, 'query', patchedQuery);

      // Streaming reads bypass `query()` entirely — `Repository.stream()` /
      // `QueryBuilder.stream()` go through `QueryRunner.stream()`, which resolves a Node
      // ReadStream. Time it from the terminal lifecycle events only (never a `data` listener,
      // which would force flowing mode and steal rows from the caller); row count is not
      // captured for the same reason. Skipped when the driver does not expose `stream`.
      const streamFn = (qr as { stream?: PatchableMethod }).stream;
      if (typeof streamFn === 'function' && !(streamFn as PatchedStream).__profilerPatched) {
        const originalStream = streamFn.bind(qr);

        const patchedStream: PatchedStream = async function (...args: unknown[]): Promise<unknown> {
          const query = String(args[0]);
          const parameters = Array.isArray(args[1]) ? args[1] : undefined;
          // Capture the profile synchronously, before awaiting, so we stay in the CLS context.
          const profile = cls?.get<Profile | undefined>('profiler.profile');
          const startedAt = Date.now();
          let recorded = false;
          const record = (error?: string): void => {
            if (recorded || !profile) return;
            recorded = true;
            const entry: QueryEntry = {
              sql: query,
              parameters: redact(parameters ?? []),
              duration: Date.now() - startedAt,
              type: detectQueryType(query),
              startedAt,
              streaming: true,
              error,
              connection,
              database,
            };
            appendCollectorEntry<QueryEntry>(profile, TYPEORM_QUERIES_KEY, entry);
          };
          let stream: LifecycleStream;
          try {
            stream = (await originalStream(...args)) as LifecycleStream;
          } catch (err) {
            record(err instanceof Error ? err.message : String(err));
            throw err;
          }
          stream.once('end', () => record());
          stream.once('close', () => record());
          stream.once('error', (err: unknown) =>
            record(err instanceof Error ? err.message : String(err)),
          );
          return stream;
        };

        patchedStream.__profilerPatched = true;
        Reflect.set(qr, 'stream', patchedStream);
      }

      return qr;
    };

    patched.__profilerPatched = true;
    patchable.createQueryRunner = patched;
  }
}
