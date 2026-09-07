import type { TagSeverity } from '../analysis/profiler-tag.interface';

/**
 * The options every collector module accepts, declared once.
 *
 * Each collector package used to redeclare these — `enabled` in twelve places, the four tag
 * severities in five — with the same wording copied along. One definition means one place to
 * read, one place to fix, and no chance of the descriptions drifting apart.
 *
 * Only options whose **meaning and default are identical everywhere** live here. The numeric
 * thresholds deliberately do not: a slow SQL query is 100 ms, a slow outgoing HTTP call 300 ms,
 * a slow publish 50 ms, and that default is the useful half of the documentation. Each package
 * keeps declaring its own.
 */
export interface CollectorModuleOptions {
  /**
   * Enable the collector. Default: `true`. Set to `false` to disable (the host application
   * decides per environment).
   *
   * A synchronous, build-time flag: it decides which providers are registered, which an async
   * factory cannot. With `forRootAsync` it therefore stays outside `useFactory`. For real
   * per-environment gating, wrap the module in `ConditionalModule.registerWhen(...)`.
   */
  enabled?: boolean;
}

/**
 * Severities a collector's performance tags are reported at, for the tags the built-in rule
 * engine raises. Every collector that participates in tagging accepts these, with the same
 * defaults; only the tags a collector can actually raise are meaningful to it (`zeroRows` is a
 * query notion, `largePayload` an HTTP one), and setting one it never raises is harmless.
 *
 * The matching thresholds are declared per package, since their defaults differ per domain.
 */
export interface TagSeverityOptions {
  /** Severity of the `slow` tag. Default: `warning`. */
  slowSeverity?: TagSeverity;
  /** Severity of the `n-plus-one` tag. Default: `danger`. */
  nPlusOneSeverity?: TagSeverity;
  /** Severity of the `chatty` tag. Default: `warning`. */
  chattySeverity?: TagSeverity;
  /** Severity of the `error` tag on this collector's entries. Default: `danger`. */
  errorSeverity?: TagSeverity;
  /**
   * Severity of the `zero-rows` tag — a write that affected nothing, a possible silent failure.
   * Query collectors only. Default: `warning`.
   */
  zeroRowsSeverity?: TagSeverity;
  /**
   * Severity of the `large-payload` tag. HTTP collectors only. Default: `warning`.
   */
  largePayloadSeverity?: TagSeverity;
}
