import { Logger } from '@nestjs/common';
import type { IProfilerCollector } from '../collectors/collector.interface';
import type { Profile } from '../interfaces/profile.interface';
import type {
  AnalyzedCollector,
  PerformanceRule,
  PerformanceRuleContext,
} from './performance-rule.interface';
import type { ProfilerTag, TagSeverity } from './profiler-tag.interface';
import { upsertTag } from './profiler-tag.interface';
import { isTaggableCollector } from './taggable-collector.interface';

const logger = new Logger('ProfilerAnalyzer');

/**
 * The core performance-analysis pass — the single seam that runs once per profile,
 * after every collector has produced its entries and before the profile is saved.
 *
 * It gathers the {@link TaggableCollector}s that produced entries, evaluates each
 * {@link PerformanceRule} against them (isolating a throwing rule so one bad rule
 * can never drop a profile), then aggregates every applied tag — per-entry and
 * per-profile — onto `profile.tags` (deduplicated by id). Those aggregated tags
 * feed the profile header, the list-page pills and the `tags` filter.
 *
 * Rules mutate the entry objects in place; because the stored profile references
 * the same arrays, the tags are persisted with no extra copy.
 *
 * @param profile - The collected profile to analyze and tag (mutated in place).
 * @param collectors - Every registered collector; non-taggable ones are ignored.
 * @param rules - The performance rules to evaluate, in order.
 * @param errorClassification - The entrypoint kind's failure verdict, resolved from its `error`
 *   option (see {@link ProfilerEntrypointType.isError}). Omitted, no profile is a failure —
 *   only its entries can be, since the engine itself knows no protocol.
 */
export function analyzeProfile(
  profile: Profile,
  collectors: readonly IProfilerCollector[],
  rules: readonly PerformanceRule[],
  errorClassification?: {
    isError?: (profile: Profile) => boolean;
    severity?: TagSeverity;
  },
): void {
  const analyzed: AnalyzedCollector[] = [];
  for (const collector of collectors) {
    if (!isTaggableCollector(collector)) continue;
    const entries = collector.getTaggableEntries(profile);
    if (!entries || entries.length === 0) continue;
    analyzed.push({
      name: collector.name,
      domain: collector.tagDomain,
      entries,
      config: collector.getTagConfig(),
    });
  }

  const profileTags: ProfilerTag[] = [];
  const ctx: PerformanceRuleContext = {
    profile,
    collectors: analyzed,
    isProfileError: () => errorClassification?.isError?.(profile) ?? false,
    profileErrorSeverity: errorClassification?.severity ?? 'danger',
    tagEntry: (entry: { tags?: ProfilerTag[] }, tag: ProfilerTag): void => {
      upsertTag((entry.tags ??= []), tag);
    },
    tagProfile: (tag: ProfilerTag): void => {
      upsertTag(profileTags, tag);
    },
  };

  for (const rule of rules) {
    try {
      rule.evaluate(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Performance rule "${rule.id}" failed: ${message}`);
    }
  }

  // Aggregate every per-entry tag up to the profile, merged with the explicit
  // profile-level tags, so the header/list/filter see one deduplicated set.
  const aggregated: ProfilerTag[] = [];
  for (const { entries } of analyzed) {
    for (const entry of entries) {
      for (const tag of entry.tags ?? []) upsertTag(aggregated, tag);
    }
  }
  for (const tag of profileTags) upsertTag(aggregated, tag);
  profile.tags = aggregated;
}
