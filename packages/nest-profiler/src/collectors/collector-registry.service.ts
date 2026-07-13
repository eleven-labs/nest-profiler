import * as path from 'path';
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ProfilerCollector } from './collector.decorator';
import type { ProfilerCollectorMetadata } from './collector.decorator';
import type { IProfilerCollector } from './collector.interface';
import type { CollectorSummarySection } from './collector-summary.interface';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';
import { HTTP_ENTRYPOINT_TYPE } from '../interfaces/profile.interface';
import { TAG_SEVERITY_RANK } from '../analysis/profiler-tag.interface';
import type { TagSeverity } from '../analysis/profiler-tag.interface';

const GROUPED_PANEL_TEMPLATE = path.join(__dirname, '..', 'templates', 'grouped-panel.ejs');

/** Default per-collector `collect()` timeout (ms); see {@link ProfilerModuleOptions.collectorTimeout}. */
const DEFAULT_COLLECTOR_TIMEOUT_MS = 1000;

/** The higher of two tag severities (either may be null/undefined). */
function maxSeverity(
  a: TagSeverity | null | undefined,
  b: TagSeverity | null | undefined,
): TagSeverity | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return TAG_SEVERITY_RANK[b] > TAG_SEVERITY_RANK[a] ? b : a;
}

export interface SubPanelInfo {
  name: string;
  label: string;
  icon?: string;
  templatePath?: string;
  /** Worst performance-tag severity in this sub-panel, used to colour its sub-tab. */
  severity?: TagSeverity | null;
}

export interface CollectorPanelInfo {
  name: string;
  label: string;
  icon?: string;
  priority: number;
  badgeValue?: string | number | null;
  /** Worst performance-tag severity in this panel, used to colour its nav tab. */
  severity?: TagSeverity | null;
  templatePath?: string;
  isGroup?: boolean;
  subPanels?: SubPanelInfo[];
}

export interface GlobalPanelInfo {
  name: string;
  label: string;
  icon?: string;
  data: unknown;
  templatePath?: string;
}

interface RegisteredCollector {
  instance: IProfilerCollector;
  meta: ProfilerCollectorMetadata;
}

@Injectable()
export class CollectorRegistry implements OnModuleInit {
  private readonly collectors = new Map<string, RegisteredCollector>();
  private readonly logger = new Logger(CollectorRegistry.name);
  private readonly collectorTimeout: number;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options: ProfilerModuleOptions = {},
  ) {
    this.collectorTimeout = options.collectorTimeout ?? DEFAULT_COLLECTOR_TIMEOUT_MS;
  }

  onModuleInit(): void {
    const providers = this.discovery.getProviders();
    for (const wrapper of providers) {
      if (!wrapper.instance) continue;
      const meta = this.discovery.getMetadataByDecorator(ProfilerCollector, wrapper);
      if (meta) {
        this.collectors.set(meta.name, { instance: wrapper.instance as IProfilerCollector, meta });
      }
    }
  }

  register(collector: IProfilerCollector): void {
    this.collectors.set(collector.name, {
      instance: collector,
      meta: {
        name: collector.name,
        label: collector.label,
        icon: collector.icon,
        priority: collector.priority,
      },
    });
  }

  async collectAll(profile: Profile): Promise<void> {
    const sorted = [...this.collectors.values()]
      .filter(({ instance, meta }) => (meta.scope ?? instance.scope ?? 'profile') !== 'global')
      .sort(
        (a, b) =>
          (a.meta.priority ?? a.instance.priority ?? 100) -
          (b.meta.priority ?? b.instance.priority ?? 100),
      );
    for (const { instance, meta } of sorted) {
      profile.collectors[meta.name] = await this.safeCollect(instance, meta.name, profile);
    }
  }

  getCollectors(): IProfilerCollector[] {
    return [...this.collectors.values()].map((r) => r.instance);
  }

  /** Whether any registered collector contributes a section to the home Summary. */
  hasSummaryContributors(): boolean {
    return [...this.collectors.values()].some(
      ({ instance }) => typeof instance.buildSummary === 'function',
    );
  }

  /**
   * Gathers every collector's {@link IProfilerCollector.buildSummary} contribution over `profiles`,
   * priority-ordered. Each call is isolated (a throw is logged and skipped) and empty sections are
   * dropped, so one faulty collector never breaks the Summary. `topN` is the shared per-table cap.
   */
  buildSummarySections(profiles: Profile[], topN?: number): CollectorSummarySection[] {
    const contributors = [...this.collectors.values()]
      .filter(({ instance }) => typeof instance.buildSummary === 'function')
      .sort(
        (a, b) =>
          (a.meta.priority ?? a.instance.priority ?? 100) -
          (b.meta.priority ?? b.instance.priority ?? 100),
      );

    const sections: CollectorSummarySection[] = [];
    for (const { instance, meta } of contributors) {
      let section: CollectorSummarySection | undefined;
      try {
        section = instance.buildSummary!(profiles, { topN });
      } catch (error) {
        this.logger.warn(
          `Collector "${meta.name}" buildSummary() failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (!section) continue;
      const hasTiles = (section.tiles?.length ?? 0) > 0;
      if (!hasTiles && !section.templatePath) continue;
      sections.push({
        ...section,
        name: section.name.length > 0 ? section.name : meta.name,
        label: section.label.length > 0 ? section.label : (meta.label ?? meta.name),
        icon: section.icon ?? meta.icon ?? instance.icon,
      });
    }
    return sections;
  }

  buildPanels(profile: Profile): CollectorPanelInfo[] {
    const requestCollectors = [...this.collectors.values()]
      .filter(({ instance, meta }) => (meta.scope ?? instance.scope ?? 'profile') !== 'global')
      .sort(
        (a, b) =>
          (a.meta.priority ?? a.instance.priority ?? 100) -
          (b.meta.priority ?? b.instance.priority ?? 100),
      );

    const panels: CollectorPanelInfo[] = [];
    const seenGroups = new Map<string, CollectorPanelInfo>();

    for (const { instance, meta } of requestCollectors) {
      const group = meta.group ?? instance.group;

      if (!group) {
        panels.push({
          name: meta.name,
          label: meta.label ?? instance.label ?? meta.name,
          icon: meta.icon ?? instance.icon,
          priority: meta.priority ?? instance.priority ?? 100,
          badgeValue: instance.getBadgeValue ? instance.getBadgeValue(profile) : undefined,
          severity: instance.getBadgeSeverity ? instance.getBadgeSeverity(profile) : null,
          templatePath: instance.getTemplatePath ? instance.getTemplatePath() : undefined,
        });
        continue;
      }

      const badgeValue = instance.getBadgeValue ? instance.getBadgeValue(profile) : undefined;
      if (badgeValue === null) continue;
      const severity = instance.getBadgeSeverity ? instance.getBadgeSeverity(profile) : null;

      const subPanel: SubPanelInfo = {
        name: meta.name,
        label: meta.label ?? instance.label ?? meta.name,
        icon: meta.icon ?? instance.icon,
        templatePath: instance.getTemplatePath ? instance.getTemplatePath() : undefined,
        severity,
      };

      if (seenGroups.has(group)) {
        const groupPanel = seenGroups.get(group)!;
        groupPanel.subPanels!.push(subPanel);
        if (badgeValue != null) {
          groupPanel.badgeValue =
            groupPanel.badgeValue != null ? `${groupPanel.badgeValue} · ${badgeValue}` : badgeValue;
        }
        groupPanel.severity = maxSeverity(groupPanel.severity, severity);
      } else {
        const groupPanel: CollectorPanelInfo = {
          name: group,
          label: meta.groupLabel ?? instance.groupLabel ?? group,
          icon: meta.groupIcon ?? instance.groupIcon,
          priority:
            meta.groupPriority ??
            instance.groupPriority ??
            meta.priority ??
            instance.priority ??
            100,
          badgeValue,
          severity,
          templatePath: GROUPED_PANEL_TEMPLATE,
          isGroup: true,
          subPanels: [subPanel],
        };
        seenGroups.set(group, groupPanel);
        panels.push(groupPanel);
      }
    }

    return panels.sort((a, b) => a.priority - b.priority);
  }

  /** Whether a registered collector runs once per list page (process-level data). */
  private isGlobal({ instance, meta }: RegisteredCollector): boolean {
    return (meta.scope ?? instance.scope ?? 'profile') === 'global';
  }

  /**
   * The synthetic, empty profile handed to a global collector: its data is
   * process-level (configuration, routes, schemas…), so it never reads a real request.
   */
  private emptyGlobalProfile(): Profile {
    return {
      token: '',
      createdAt: 0,
      entrypoint: {
        type: HTTP_ENTRYPOINT_TYPE,
        data: { method: '', url: '', headers: {}, query: {} },
      },
      performance: { startTime: 0, heapUsed: 0 },
      logs: [],
      exceptions: [],
      collectors: {},
    };
  }

  /**
   * Lightweight descriptors of the registered global panels — `name`/`label`/`icon`
   * only, **without** running each collector's `collect()`. Lets the home page build
   * its sidebar (one entry per global panel) and then materialise only the active
   * view via {@link buildGlobalPanel}, instead of collecting every panel on every load.
   */
  listGlobalPanelDescriptors(): { name: string; label: string; icon?: string }[] {
    return [...this.collectors.values()]
      .filter((e) => this.isGlobal(e))
      .map(({ instance, meta }) => ({
        name: meta.name,
        label: meta.label ?? instance.label ?? meta.name,
        icon: meta.icon ?? instance.icon,
      }));
  }

  /** Builds a single global panel by name (runs only that collector), or `undefined` if unknown. */
  async buildGlobalPanel(name: string): Promise<GlobalPanelInfo | undefined> {
    const entry = [...this.collectors.values()].find(
      (e) => e.meta.name === name && this.isGlobal(e),
    );
    if (!entry) return undefined;
    const { instance, meta } = entry;
    return {
      name: meta.name,
      label: meta.label ?? instance.label ?? meta.name,
      icon: meta.icon ?? instance.icon,
      data: await this.safeCollect(instance, meta.name, this.emptyGlobalProfile()),
      templatePath: instance.getTemplatePath ? instance.getTemplatePath() : undefined,
    };
  }

  async buildGlobalPanels(): Promise<GlobalPanelInfo[]> {
    const globals = [...this.collectors.values()].filter((e) => this.isGlobal(e));
    const emptyProfile = this.emptyGlobalProfile();
    return Promise.all(
      globals.map(async ({ instance, meta }) => ({
        name: meta.name,
        label: meta.label ?? instance.label ?? meta.name,
        icon: meta.icon ?? instance.icon,
        data: await this.safeCollect(instance, meta.name, emptyProfile),
        templatePath: instance.getTemplatePath ? instance.getTemplatePath() : undefined,
      })),
    );
  }

  private async safeCollect(
    instance: IProfilerCollector,
    name: string,
    profile: Profile,
  ): Promise<unknown> {
    // Wrap in a promise so a synchronous throw is captured too (the executor
    // rejects if collect() throws), and attach a no-op catch so a late rejection
    // (after a timeout abandoned it) never surfaces as an unhandledRejection.
    const work = new Promise<unknown>((resolve) => resolve(instance.collect(profile)));
    work.catch(() => undefined);

    try {
      return await this.applyTimeout(work);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Collector "${name}" failed during collection: ${message}`);
      return { error: message };
    }
  }

  /**
   * Races collector work against the configured timeout so a slow or hanging
   * `collect()` can never block the response. A no-op when the timeout is
   * disabled (`collectorTimeout <= 0`).
   */
  private applyTimeout(work: Promise<unknown>): Promise<unknown> {
    if (this.collectorTimeout <= 0) return work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${this.collectorTimeout}ms`)),
        this.collectorTimeout,
      );
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  getCollectorNames(): string[] {
    return [...this.collectors.keys()];
  }
}
