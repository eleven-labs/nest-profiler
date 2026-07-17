/** SQL dialects for which an EXPLAIN plan can be produced and parsed. */
export type ExplainDialect = 'postgres' | 'mysql' | 'sqlite';

/**
 * Per-collector EXPLAIN options (shared shape, wired on each SQL collector's module
 * options). EXPLAIN runs **on demand** — only when a user clicks "Explain" in the SQL
 * panel — so it never adds latency to the profiled request.
 */
export interface ExplainOptions {
  /** Show the "Explain" action for this collector's queries. Default: `true`. */
  enabled?: boolean;
  /**
   * Use `EXPLAIN ANALYZE`, which **executes** the query to report real timings/rows.
   * Restricted to `SELECT` (never runs on writes) and meant for development only.
   * Default: `false`.
   */
  analyze?: boolean;
}

/** Raw EXPLAIN output plus the context {@link parseExplainPlan} needs to normalize it. */
export interface ExplainRawResult {
  dialect: ExplainDialect;
  /** Whether `EXPLAIN ANALYZE` was used (the query was actually executed). */
  analyzed: boolean;
  /**
   * Canonical raw plan for the dialect, already unwrapped by the runner:
   * - postgres: the `[{ Plan: {...} }]` array from `EXPLAIN (FORMAT JSON)`
   * - mysql: the `{ query_block: {...} }` object from `EXPLAIN FORMAT=JSON`
   * - sqlite: the `{ id, parent, detail }[]` rows from `EXPLAIN QUERY PLAN`
   */
  raw: unknown;
}

/** Normalized, dialect-agnostic execution plan rendered in the SQL panel. */
export interface ExplainPlan {
  dialect: ExplainDialect;
  analyzed: boolean;
  /** Top-level plan node / operation label, e.g. `'Seq Scan'`. `null` when unknown. */
  planType: string | null;
  /** True when any node is a full-table scan (Seq Scan / `access_type: ALL` / SQLite `SCAN`). */
  hasSeqScan: boolean;
  /** Relations scanned sequentially, surfaced as the plan's warning. */
  seqScanRelations: string[];
  /** Estimated rows for the top node, when the dialect exposes it. */
  estimatedRows?: number;
  /** Estimated total cost for the top node, when the dialect exposes it. */
  estimatedCost?: number;
  /** Full raw EXPLAIN output, kept for power users. */
  raw: unknown;
}

/**
 * Runs EXPLAIN for one SQL collector's queries. Implemented per ORM (it owns the DB
 * connection) and registered with {@link ExplainRunnerRegistry}. A runner is registered
 * only when the collector's `explain.enabled` is true and its dialect is supported, so a
 * registered runner is exactly what makes the "Explain" action appear.
 */
export interface ExplainRunner {
  /** The collector name (a `profile.collectors` key) this runner serves, e.g. `'typeorm'`. */
  readonly collectorName: string;
  /** Run EXPLAIN over a captured query and return its raw output. Throws on failure. */
  explain(sql: string, parameters: readonly unknown[] | undefined): Promise<ExplainRawResult>;
}
