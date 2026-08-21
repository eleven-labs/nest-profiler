import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProfilerCollector, ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type {
  GlobalPanelDescriptor,
  IProfilerCollector,
  Profile,
  DiscoverGroup,
} from '@eleven-labs/nest-profiler';

const ROUTES_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 100 4 2 2 0 000-4zM4 10a2 2 0 100 4 2 2 0 000-4z" opacity="0.4"/><path d="M12 6a2 2 0 100 4 2 2 0 000-4z"/><path d="M6 4h4a2 2 0 012 2M4 6v4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;

/** Panel payload: the route groups a single **Discover** view renders, plus their total count. */
export interface RoutesCollectorData {
  groups: DiscoverGroup[];
  entryCount: number;
}

/** Total items across a group's non-route sections (the broker topology, …). */
function sectionItemCount(group: DiscoverGroup): number {
  return (group.sections ?? []).reduce((total, section) => total + section.items.length, 0);
}

/** The built-in source, listed first among the Discover views. */
const HTTP_SOURCE = 'http';

/** Sidebar group the per-transport views are filed under. */
export const DISCOVER_GROUP = 'discover';
/** Heading of that sidebar group. */
export const DISCOVER_GROUP_LABEL = 'Discover';

/** The `?view=` key of the **Discover** view for a route source (e.g. `discover-graphql`). */
export function discoverViewKey(source: string): string {
  return `${DISCOVER_GROUP}-${source}`;
}

/**
 * Global-scope discovery of the application's routing table — a Symfony-Routing-style view
 * rendered on the profiler home page. It owns no discovery logic: it aggregates the
 * {@link DiscoverGroup}s from every `ProfilerDiscoverSource` registered on the core (the built-in HTTP
 * source shipped by this package, plus any contributed by protocol packages), then splits them
 * into one **Discover** sidebar view per transport — `Discover / HTTP`, `Discover / GraphQL`, … —
 * because a transport's routing table is its own subject, not a section of a shared "Routes" tab.
 */
@ProfilerCollector({
  name: 'routes',
  label: DISCOVER_GROUP_LABEL,
  icon: ROUTES_ICON,
  priority: 75,
  scope: 'global',
  group: DISCOVER_GROUP,
  groupLabel: DISCOVER_GROUP_LABEL,
})
@Injectable()
export class RoutesCollector implements IProfilerCollector {
  readonly name = 'routes';
  readonly label = DISCOVER_GROUP_LABEL;
  readonly icon = ROUTES_ICON;
  readonly priority = 75;
  readonly scope = 'global' as const;
  readonly group = DISCOVER_GROUP;
  readonly groupLabel = DISCOVER_GROUP_LABEL;

  private core?: ProfilerCoreService;

  constructor(private readonly moduleRef: ModuleRef) {}

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'routes-panel.ejs');
  }

  /**
   * One sidebar view per discovered transport, keyed `discover-<source>` so it can never collide
   * with a list section of the same protocol (`?view=graphql` stays the GraphQL profile list).
   * No transport discovered anything → no views at all, rather than an empty panel.
   */
  expandGlobalPanels(data: unknown): GlobalPanelDescriptor[] {
    const groups = (data as RoutesCollectorData | undefined)?.groups;
    if (!Array.isArray(groups)) return [];
    return groups.map((group) => ({
      name: discoverViewKey(group.source),
      label: group.label,
      icon: group.icon ?? this.icon,
      data: { groups: [group], entryCount: group.entries.length } satisfies RoutesCollectorData,
      // A source can discover a topology without a single handler (a broker the application only
      // publishes to): fall back to the section items so the view is still badged with what it holds.
      badge: group.entries.length || sectionItemCount(group),
    }));
  }

  collect(_profile: Profile): RoutesCollectorData {
    const groups: DiscoverGroup[] = [];
    for (const source of this.resolveCore()?.getDiscoverSources() ?? []) {
      try {
        const result = source.collect();
        for (const group of Array.isArray(result) ? result : [result]) {
          if (group && (group.entries.length > 0 || sectionItemCount(group) > 0))
            groups.push(group);
        }
      } catch {
        // A misbehaving source must not break the panel; skip it.
      }
    }
    // Sources register in DI bootstrap order, which would shuffle the sidebar between runs.
    // Pin the built-in HTTP source first — the primary transport — then order by label.
    groups.sort(
      (a, b) =>
        Number(b.source === HTTP_SOURCE) - Number(a.source === HTTP_SOURCE) ||
        a.label.localeCompare(b.label),
    );
    const entryCount = groups.reduce((total, group) => total + group.entries.length, 0);
    return { groups, entryCount };
  }

  /** Lazily resolves the core from the global scope (a sibling dynamic module), memoized. */
  private resolveCore(): ProfilerCoreService | undefined {
    if (!this.core) {
      try {
        this.core = this.moduleRef.get(ProfilerCoreService, { strict: false });
      } catch {
        return undefined;
      }
    }
    return this.core;
  }
}
