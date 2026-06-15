import * as path from 'path';
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ProfilerCollector } from './collector.decorator';
import type { ProfilerCollectorMetadata } from './collector.decorator';
import type { IProfilerCollector } from './collector.interface';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';
import { HTTP_ENTRYPOINT_TYPE } from '../interfaces/profile.interface';

const GROUPED_PANEL_TEMPLATE = path.join(__dirname, '..', 'templates', 'grouped-panel.ejs');

/** Default per-collector `collect()` timeout (ms); see {@link ProfilerModuleOptions.collectorTimeout}. */
const DEFAULT_COLLECTOR_TIMEOUT_MS = 1000;

export interface SubPanelInfo {
  name: string;
  label: string;
  icon?: string;
  templatePath?: string;
}

export interface CollectorPanelInfo {
  name: string;
  label: string;
  icon?: string;
  priority: number;
  badgeValue?: string | number | null;
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
          templatePath: instance.getTemplatePath ? instance.getTemplatePath() : undefined,
        });
        continue;
      }

      const badgeValue = instance.getBadgeValue ? instance.getBadgeValue(profile) : undefined;
      if (badgeValue === null) continue;

      const subPanel: SubPanelInfo = {
        name: meta.name,
        label: meta.label ?? instance.label ?? meta.name,
        icon: meta.icon ?? instance.icon,
        templatePath: instance.getTemplatePath ? instance.getTemplatePath() : undefined,
      };

      if (seenGroups.has(group)) {
        const groupPanel = seenGroups.get(group)!;
        groupPanel.subPanels!.push(subPanel);
        if (badgeValue != null) {
          groupPanel.badgeValue =
            groupPanel.badgeValue != null ? `${groupPanel.badgeValue} · ${badgeValue}` : badgeValue;
        }
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
          badgeValue: badgeValue ?? null,
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

  async buildGlobalPanels(): Promise<GlobalPanelInfo[]> {
    const globals = [...this.collectors.values()].filter(
      ({ instance, meta }) => (meta.scope ?? instance.scope ?? 'profile') === 'global',
    );
    const emptyProfile: Profile = {
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
