import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ProfilerCollector } from '../collectors/collector.decorator';
import type { GlobalPanelDescriptor, IProfilerCollector } from '../collectors/collector.interface';
import type { Profile } from '../interfaces/profile.interface';
import { RuntimeMetricsService } from './runtime-metrics.service';
import type { RuntimeCollectorData } from './runtime-metrics.interface';

const RUNTIME_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 11l2.5-3.5L7 9.5 10 4l4 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * Contributes the **Runtime** sidebar view: process memory, CPU, event-loop lag and garbage
 * collection, sampled on an interval by {@link RuntimeMetricsService}.
 *
 * A `scope: 'global'` collector, like Config — it describes the process, not one execution, so it
 * belongs on the dashboard rather than in a profile's tabs.
 */
@ProfilerCollector({
  name: 'runtime',
  label: 'Runtime',
  icon: RUNTIME_ICON,
  priority: 85,
  scope: 'global',
})
@Injectable()
export class RuntimeCollector implements IProfilerCollector {
  readonly name = 'runtime';
  readonly label = 'Runtime';
  readonly icon = RUNTIME_ICON;
  readonly priority = 85;
  readonly scope = 'global' as const;

  constructor(private readonly metrics: RuntimeMetricsService) {}

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'runtime-panel.ejs');
  }

  /**
   * Hides the view entirely when runtime metrics are disabled, rather than offering a panel that
   * can only explain that it has nothing to show. No count badge: the sidebar badge is a number
   * of things, and this view counts nothing — a percentage there would read as a quantity.
   */
  expandGlobalPanels(data: unknown): GlobalPanelDescriptor[] {
    const snapshot = data as RuntimeCollectorData;
    if (!snapshot.enabled) return [];
    return [
      {
        name: this.name,
        label: this.label,
        icon: this.icon,
        data: snapshot,
        templatePath: this.getTemplatePath(),
        note: `— process-wide, sampled every ${Math.round(snapshot.interval / 1000)}s`,
      },
    ];
  }

  collect(_profile: Profile): RuntimeCollectorData {
    return this.metrics.snapshot();
  }
}
