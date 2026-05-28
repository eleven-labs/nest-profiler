import * as path from 'path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ProfilerCollector } from './collector.decorator';
import type { ProfilerCollectorMetadata } from './collector.decorator';
import type { IProfilerCollector } from './collector.interface';
import type { Profile } from '../interfaces/profile.interface';

const GROUPED_PANEL_TEMPLATE = path.join(__dirname, '..', 'templates', 'grouped-panel.ejs');

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

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
  ) {}

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
      .filter(({ instance, meta }) => (meta.scope ?? instance.scope ?? 'request') !== 'global')
      .sort(
        (a, b) =>
          (a.meta.priority ?? a.instance.priority ?? 100) -
          (b.meta.priority ?? b.instance.priority ?? 100),
      );
    for (const { instance, meta } of sorted) {
      try {
        profile.collectors[meta.name] = await instance.collect(profile);
      } catch {
        profile.collectors[meta.name] = { error: 'Collection failed' };
      }
    }
  }

  getCollectors(): IProfilerCollector[] {
    return [...this.collectors.values()].map((r) => r.instance);
  }

  buildPanels(profile: Profile): CollectorPanelInfo[] {
    const requestCollectors = [...this.collectors.values()]
      .filter(({ instance, meta }) => (meta.scope ?? instance.scope ?? 'request') !== 'global')
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
      ({ instance, meta }) => (meta.scope ?? instance.scope ?? 'request') === 'global',
    );
    const emptyProfile: Profile = {
      token: '',
      createdAt: 0,
      request: { method: '', url: '', headers: {}, query: {} },
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
        data: await instance.collect(emptyProfile),
        templatePath: instance.getTemplatePath ? instance.getTemplatePath() : undefined,
      })),
    );
  }

  getCollectorNames(): string[] {
    return [...this.collectors.keys()];
  }
}
