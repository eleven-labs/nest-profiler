import type { IProfilerCollector } from '../collectors/collector.interface';
import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerTag } from './profiler-tag.interface';

/**
 * The minimal shape every entry exposed to the performance-rule engine shares:
 * a `duration` to threshold on, an optional cross-request `fingerprint` to group
 * on (contributed by the collector), and the `tags` array the engine mutates.
 *
 * Concrete entries (a `QueryEntry`, a `MongooseQueryEntry`, an `HttpRequestEntry`)
 * carry more fields; a rule scoped to a domain may cast to the concrete type it
 * knows it is dealing with (see {@link PerformanceRuleContext.collectors}).
 */
export interface TaggableEntry {
  duration: number;
  /** Deterministic, parameter-free key used to group repeated calls (N+1). */
  fingerprint?: string;
  /** Populated by the engine — the tags applied to this entry. */
  tags?: ProfilerTag[];
  error?: string;
}

/**
 * Per-domain thresholds a {@link TaggableCollector} exposes so the built-in rules
 * stay configurable per collector (a Mongo slow threshold differs from an HTTP one).
 * Read from the collector's own module options; the engine never owns these.
 */
export interface TagConfig {
  /** A call at or above this duration (ms) is tagged `slow`. */
  slowThreshold: number;
  /** `nPlusOneThreshold` identical fingerprints or more are tagged `n-plus-one`/N+1. */
  nPlusOneThreshold: number;
  /** At or above this many calls in one profile, the profile is tagged `chatty`. */
  chattyThreshold?: number;
  /** A request/response body at or above this size (bytes) is tagged `large-payload`. */
  largePayloadThreshold?: number;
}

/**
 * Opt-in contract letting the core performance-rule engine ({@link analyzeProfile})
 * discover a collector's entries, know their domain, and read the collector's
 * thresholds — without the core knowing anything ORM/client-specific.
 *
 * Implemented once on {@link AbstractQueryCollector} (covers the SQL and Mongoose
 * collectors) and separately on the HTTP-client collector.
 */
export interface TaggableCollector {
  /** Rule domain, e.g. `'query'` or `'http'`. Selects domain-scoped rules/labels. */
  readonly tagDomain: string;
  /** The collected entries (post-`collect`, under `profile.collectors[name]`), or `undefined`. */
  getTaggableEntries(profile: Profile): TaggableEntry[] | undefined;
  /** The resolved thresholds for this collector's domain. */
  getTagConfig(): TagConfig;
}

/** Narrows a collector to one that participates in performance tagging. */
export function isTaggableCollector(
  collector: IProfilerCollector,
): collector is IProfilerCollector & TaggableCollector {
  const candidate = collector as Partial<TaggableCollector>;
  return (
    typeof candidate.tagDomain === 'string' &&
    typeof candidate.getTaggableEntries === 'function' &&
    typeof candidate.getTagConfig === 'function'
  );
}
