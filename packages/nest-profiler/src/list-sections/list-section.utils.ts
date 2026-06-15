import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerListSection } from './profiler-list-section.interface';

/** Default display order for contributed sections with no explicit `order`. */
export const DEFAULT_SECTION_ORDER = 100;

/** A section paired with the profiles assigned to it, ready for rendering. */
export interface ProfilerListSectionBucket {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly itemLabel: string;
  readonly isDefault: boolean;
  readonly defaultCollapsed: boolean;
  readonly templatePath: string;
  readonly profiles: Profile[];
}

const order = (section: ProfilerListSection): number => section.order ?? DEFAULT_SECTION_ORDER;

/**
 * Buckets `profiles` into the registered `sections`, ascending by `order`.
 *
 * Each profile is assigned to the first non-default section whose `matches`
 * returns `true`; profiles claimed by none fall through to the single default
 * section. Sections with no default present simply drop unmatched profiles.
 *
 * @returns One bucket per section, in display order, each carrying its profiles.
 */
export function bucketProfilesBySection(
  sections: ProfilerListSection[],
  profiles: Profile[],
): ProfilerListSectionBucket[] {
  const ordered = [...sections].sort((a, b) => order(a) - order(b));
  const matchers = ordered.filter((s) => !s.isDefault);
  const fallback = ordered.find((s) => s.isDefault);

  const byKey = new Map<string, Profile[]>(ordered.map((s) => [s.key, []]));

  for (const profile of profiles) {
    const target = matchers.find((s) => s.matches(profile)) ?? fallback;
    if (target) byKey.get(target.key)?.push(profile);
  }

  return ordered.map((section) => ({
    key: section.key,
    title: section.title,
    description: section.description,
    itemLabel: section.itemLabel ?? 'profile',
    isDefault: section.isDefault === true,
    defaultCollapsed: section.defaultCollapsed === true,
    templatePath: section.templatePath,
    profiles: byKey.get(section.key) ?? [],
  }));
}
