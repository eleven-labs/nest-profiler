import * as path from 'path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ProfilerCollector,
  getCollectorEntries,
  maxTagSeverity,
  resolveEntryErrorClassifier,
  resolveErrorSeverity,
} from '@eleven-labs/nest-profiler';
import type {
  IProfilerCollector,
  Profile,
  TagConfig,
  TagSeverity,
  TaggableCollector,
} from '@eleven-labs/nest-profiler';
import { EVENT_EMITTER_COLLECTOR_OPTIONS, EVENT_ICON } from './event-emitter-collector.interface';
import type {
  EventEmitterCollectorModuleOptions,
  EventEntry,
} from './event-emitter-collector.interface';
import { EVENT_EMITTER_EVENTS_KEY } from './event-emitter.patch';

/**
 * Renders the "Events" panel from the emissions recorded by {@link EventEmitterPatch}, and feeds
 * them to the core performance-rule engine so a slow or repeated emission is tagged like a query.
 */
@Injectable()
@ProfilerCollector({ name: 'event-emitter', label: 'Events', icon: EVENT_ICON, priority: 35 })
export class EventEmitterCollector implements IProfilerCollector, TaggableCollector {
  readonly name = 'event-emitter';
  readonly label = 'Events';
  readonly icon = EVENT_ICON;
  readonly priority = 35;
  /** Emissions get their own rule domain, so their thresholds never inherit the query ones. */
  readonly tagDomain = 'event';

  constructor(
    @Optional()
    @Inject(EVENT_EMITTER_COLLECTOR_OPTIONS)
    private readonly options: EventEmitterCollectorModuleOptions = {},
  ) {}

  collect(profile: Profile): EventEntry[] {
    const events = this.entriesOf(profile);
    // Drop the raw capture key so only the panel-facing collector data is persisted.
    delete profile.collectors[EVENT_EMITTER_EVENTS_KEY];
    return events;
  }

  /** Worst tag severity across the emissions — colours the panel's nav tab. */
  getBadgeSeverity(profile: Profile): TagSeverity | null {
    const entries = this.entriesOf(profile);
    // Tags are applied after `collect`, so fall back to the raw error flag on a fresh profile.
    return maxTagSeverity(entries) ?? (entries.some((entry) => entry.error) ? 'danger' : null);
  }

  /** Number of events emitted during the request; hidden when none. */
  getBadgeValue(profile: Profile): string | null {
    const count = this.entriesOf(profile).length;
    return count ? String(count) : null;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'event-emitter-panel.ejs');
  }

  /** The collected entries, for the performance-rule engine (post-`collect`). */
  getTaggableEntries(profile: Profile): EventEntry[] | undefined {
    return profile.collectors[this.name] as EventEntry[] | undefined;
  }

  getTagConfig(): TagConfig {
    return {
      slowThreshold: this.options.slowThreshold ?? 100,
      nPlusOneThreshold: this.options.nPlusOneThreshold ?? 2,
      chattyThreshold: this.options.chattyThreshold ?? 20,
      // An emission carries no status code, so only its own `error` can fail it.
      isErrorEntry: resolveEntryErrorClassifier({ httpStatus: false }),
      errorSeverity: resolveErrorSeverity(this.options.error),
      slowSeverity: this.options.slowSeverity ?? 'warning',
    };
  }

  private entriesOf(profile: Profile): EventEntry[] {
    return (
      (profile.collectors[this.name] as EventEntry[] | undefined) ??
      getCollectorEntries<EventEntry>(profile, EVENT_EMITTER_EVENTS_KEY)
    );
  }
}
