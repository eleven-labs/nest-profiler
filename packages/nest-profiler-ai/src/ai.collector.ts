import * as path from 'path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ProfilerCollector, entriesToSpans, getCollectorEntries } from '@eleven-labs/nest-profiler';
import type {
  IProfilerCollector,
  Profile,
  RawSpan,
  TagConfig,
  TaggableCollector,
  TaggableEntry,
  TraceContributor,
} from '@eleven-labs/nest-profiler';
import { AI_ICON } from './icons';
import { AI_COLLECTOR_OPTIONS } from './ai-collector.interface';
import type { AiCollectorModuleOptions } from './ai-collector.interface';
import { AI_ENTRIES_KEY, isAiCall } from './ai-call.interface';
import type { AiCallEntry, AiCollectorData, AiEntry } from './ai-call.interface';

const EMPTY: AiCollectorData = {
  entries: [],
  callCount: 0,
  toolCount: 0,
  totalTokens: 0,
  totalCost: 0,
  costKnown: false,
  costEstimated: false,
  totalDuration: 0,
  toolDuration: 0,
};

const round = (value: number, places: number): number => Math.round(value * places) / places;

const sum = (values: number[]): number =>
  round(
    values.reduce((total, value) => total + value, 0),
    1000,
  );

/** Costs are summed to the nanodollar: a short call on a cheap model costs a fraction of a cent. */
const sumCost = (values: number[]): number =>
  round(
    values.reduce((total, value) => total + value, 0),
    1e9,
  );

@Injectable()
@ProfilerCollector({ name: 'ai', label: 'AI', icon: AI_ICON, priority: 35 })
export class AiCollector implements IProfilerCollector, TraceContributor, TaggableCollector {
  readonly name = 'ai';
  readonly label = 'AI';
  readonly icon = AI_ICON;
  readonly priority = 35;
  readonly tagDomain = 'ai';

  constructor(
    @Optional()
    @Inject(AI_COLLECTOR_OPTIONS)
    private readonly options: AiCollectorModuleOptions = {},
  ) {}

  getBadgeValue(profile: Profile): string | null {
    const { callCount, toolCount, totalTokens } = this.data(profile);
    if (callCount === 0 && toolCount === 0) return null;
    const calls = toolCount > 0 ? `${callCount}+${toolCount}T` : `${callCount}`;
    return totalTokens > 0 ? `${calls} · ${totalTokens}tok` : calls;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'ai-panel.ejs');
  }

  collect(profile: Profile): AiCollectorData {
    const entries = getCollectorEntries<AiEntry>(profile, AI_ENTRIES_KEY);
    delete profile.collectors[AI_ENTRIES_KEY];
    const calls = entries.filter(isAiCall);
    const tools = entries.filter((entry) => !isAiCall(entry));
    return {
      entries,
      callCount: calls.length,
      toolCount: tools.length,
      totalTokens: sum(calls.map((call) => call.usage?.total ?? 0)),
      totalCost: sumCost(calls.map((call) => call.cost ?? 0)),
      costKnown: calls.some((call) => call.cost !== undefined),
      costEstimated: calls.some((call) => call.costSource === 'estimated'),
      totalDuration: sum(calls.map((call) => call.duration)),
      toolDuration: sum(tools.map((tool) => tool.duration)),
    };
  }

  /** One bar per model call and per tool execution, so the LLM's share of the request is visible. */
  getTraceSpans(profile: Profile): RawSpan[] {
    return entriesToSpans(this.data(profile).entries, {
      kind: 'ai',
      collector: this.name,
      label: (entry) =>
        isAiCall(entry) ? `${entry.operation} ${entry.model}` : `tool ${entry.name}`,
      meta: (entry): Record<string, string | number | boolean> =>
        isAiCall(entry)
          ? {
              model: entry.model,
              step: entry.step,
              ...(entry.usage?.total !== undefined && { tokens: entry.usage.total }),
              ...(entry.timeToFirstOutput !== undefined && {
                ttft: `${entry.timeToFirstOutput}ms`,
              }),
            }
          : { tool: entry.name },
    });
  }

  getTaggableEntries(profile: Profile): TaggableEntry[] {
    return this.data(profile).entries;
  }

  /** A model call is slow on a different scale from a query: seconds, not milliseconds. */
  getTagConfig(): TagConfig {
    return {
      slowThreshold: this.options.slowThreshold ?? 5000,
      nPlusOneThreshold: this.options.nPlusOneThreshold ?? 3,
      chattyThreshold: this.options.chattyThreshold ?? 5,
      ...(this.options.slowSeverity !== undefined && { slowSeverity: this.options.slowSeverity }),
      ...(this.options.nPlusOneSeverity !== undefined && {
        nPlusOneSeverity: this.options.nPlusOneSeverity,
      }),
      ...(this.options.chattySeverity !== undefined && {
        chattySeverity: this.options.chattySeverity,
      }),
      ...(this.options.errorSeverity !== undefined && {
        errorSeverity: this.options.errorSeverity,
      }),
    };
  }

  private data(profile: Profile): AiCollectorData {
    return (profile.collectors[this.name] as AiCollectorData | undefined) ?? EMPTY;
  }
}

export type { AiCallEntry };
