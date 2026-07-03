import type { ProfilerListSection } from './profiler-list-section.interface';

/** Default display order for contributed sections with no explicit `order`. */
export const DEFAULT_SECTION_ORDER = 100;

/** The entrypoint types a section owns (`types`, defaulting to its `key`). */
function sectionTypes(section: ProfilerListSection): readonly string[] {
  return section.types ?? [section.key];
}

const order = (section: ProfilerListSection): number => section.order ?? DEFAULT_SECTION_ORDER;

/** Registered sections sorted ascending by display `order`. */
export function sortSections(sections: ProfilerListSection[]): ProfilerListSection[] {
  return [...sections].sort((a, b) => order(a) - order(b));
}

/** The entrypoint-type constraint of a query scoped to a single section. */
export interface SectionTypeConstraint {
  readonly typeIn?: string[];
  readonly typeNotIn?: string[];
}

/**
 * Builds the {@link SectionTypeConstraint} that scopes a query to `section`:
 *
 * - a non-default section owns its {@link ProfilerListSection.types} (→ `typeIn`);
 * - the {@link ProfilerListSection.isDefault} catch-all claims every type **not**
 *   owned by another section (→ `typeNotIn`, listing every non-default type).
 */
export function sectionTypeConstraint(
  section: ProfilerListSection,
  sections: ProfilerListSection[],
): SectionTypeConstraint {
  if (section.isDefault) {
    const claimed = sections.filter((s) => !s.isDefault).flatMap((s) => [...sectionTypes(s)]);
    return { typeNotIn: claimed };
  }
  return { typeIn: [...sectionTypes(section)] };
}
