import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerTag, TagSeverity } from './profiler-tag.interface';
import type { TagConfig, TaggableEntry } from './taggable-collector.interface';

/**
 * One collector's contribution to the analysis pass: its name, its rule `domain`,
 * the entries it collected this request, and the thresholds it exposes. A rule
 * iterates these groups and tags entries (or the profile).
 */
export interface AnalyzedCollector {
  readonly name: string;
  readonly domain: string;
  readonly entries: TaggableEntry[];
  readonly config: TagConfig;
}

/**
 * The context handed to every {@link PerformanceRule} once per profile, after all
 * collectors have run. A rule reads {@link collectors} (and {@link profile}) and
 * applies tags via {@link tagEntry} / {@link tagProfile}; it must not throw — the
 * engine isolates failures, but a well-behaved rule stays side-effect-free beyond
 * tagging.
 */
export interface PerformanceRuleContext {
  readonly profile: Profile;
  /** Analyzable entry groups, one per taggable collector that produced entries. */
  readonly collectors: readonly AnalyzedCollector[];
  /**
   * Whether the profile's entrypoint kind considers it a **failure**, per the kind's own
   * {@link ProfilerErrorOptions} — a 5xx for HTTP, an `INTERNAL_SERVER_ERROR` for GraphQL, a
   * non-zero exit for a command. The engine knows no protocol; each kind supplies the verdict.
   */
  isProfileError(): boolean;
  /** Severity the entrypoint kind gives its `error` tag. Default: `'danger'`. */
  readonly profileErrorSeverity: TagSeverity;
  /** Tag a single entry (deduplicated by tag id). */
  tagEntry(entry: TaggableEntry, tag: ProfilerTag): void;
  /** Tag the whole profile (aggregated onto `profile.tags`, deduplicated by tag id). */
  tagProfile(tag: ProfilerTag): void;
}

/**
 * A performance heuristic evaluated once per profile. The core ships
 * {@link BUILTIN_PERFORMANCE_RULES} (slow, N+1, error, chatty,
 * large-payload); consumers add their own via
 * {@link ProfilerCoreService.registerPerformanceRule} or the
 * `performance.rules` module option to flag any domain-specific anti-pattern.
 */
export interface PerformanceRule {
  /** Unique id; a second rule with the same id is ignored on registration. */
  readonly id: string;
  /** Inspect the context and apply tags. Runs synchronously. */
  evaluate(ctx: PerformanceRuleContext): void;
}
