import { Inject, Injectable, Optional } from '@nestjs/common';
import * as path from 'path';
import { ProfilerCollector } from '@eleven-labs/nest-profiler';
import type {
  IProfilerCollector,
  Profile,
  TagConfig,
  TaggableCollector,
  TaggableEntry,
  TagSeverity,
} from '@eleven-labs/nest-profiler';
import {
  getCollectorEntries,
  maxTagSeverity,
  resolveEntryErrorClassifier,
  resolveErrorSeverity,
} from '@eleven-labs/nest-profiler';
import { buildPubSubPublish } from './build-pubsub-publish.js';
import {
  PUBSUB_PUBLISHES_KEY,
  PUBSUB_PUBLISH_COLLECTOR_OPTIONS,
} from './pubsub-publish-collector.interface.js';
import type {
  PubSubPublishEntry,
  PubSubPublishCollectorModuleOptions,
} from './pubsub-publish-collector.interface.js';

const PUBLISH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 11l18-8-8 18-2.5-7.5L3 11z"/></svg>`;

/**
 * Renders the **Pub/Sub** panel: the messages the profiled request published to Google Cloud
 * Pub/Sub, captured by {@link PubSubPublishPatch}.
 *
 * Implements {@link TaggableCollector} in the `pubsub` domain so the core performance-rule engine
 * flags slow, repeated (N+1) and failed publishes; the per-message `fingerprint` and the runnable
 * publish snippet are stamped at collect time.
 */
@Injectable()
@ProfilerCollector({
  name: 'pubsub-publish',
  label: 'Pub/Sub',
  icon: PUBLISH_ICON,
  priority: 35,
})
export class PubSubPublishCollector implements IProfilerCollector, TaggableCollector {
  readonly name = 'pubsub-publish';
  readonly label = 'Pub/Sub';
  readonly icon = PUBLISH_ICON;
  readonly priority = 35;
  readonly tagDomain = 'pubsub';

  /** Resolved once: `getTagConfig()` runs on every profile, the options never change. */
  private readonly isErrorEntry: (entry: TaggableEntry) => boolean;

  constructor(
    @Optional()
    @Inject(PUBSUB_PUBLISH_COLLECTOR_OPTIONS)
    private readonly options: PubSubPublishCollectorModuleOptions = {},
  ) {
    this.isErrorEntry = resolveEntryErrorClassifier(options.error);
  }

  getBadgeValue(profile: Profile): string | null {
    const messages = this.entriesOf(profile);
    return messages.length ? String(messages.length) : null;
  }

  /** Worst tag severity across the published messages — colours the panel's nav tab. */
  getBadgeSeverity(profile: Profile): TagSeverity | null {
    return maxTagSeverity(this.entriesOf(profile));
  }

  private entriesOf(profile: Profile): PubSubPublishEntry[] {
    return (
      (profile.collectors[this.name] as PubSubPublishEntry[] | undefined) ??
      getCollectorEntries<PubSubPublishEntry>(profile, PUBSUB_PUBLISHES_KEY)
    );
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'pubsub-publish-panel.ejs');
  }

  collect(profile: Profile): PubSubPublishEntry[] {
    const messages = getCollectorEntries<PubSubPublishEntry>(profile, PUBSUB_PUBLISHES_KEY);
    delete profile.collectors[PUBSUB_PUBLISHES_KEY];
    return messages.map((message) => ({
      ...message,
      fingerprint: message.topic,
      publishSnippet: buildPubSubPublish(message),
    }));
  }

  /** The collected messages, for the performance-rule engine (post-`collect`). */
  getTaggableEntries(profile: Profile): PubSubPublishEntry[] | undefined {
    return profile.collectors[this.name] as PubSubPublishEntry[] | undefined;
  }

  /** Feeds the core performance-rule engine the thresholds configured on this module. */
  getTagConfig(): TagConfig {
    return {
      slowThreshold: this.options.slowThreshold ?? 100,
      nPlusOneThreshold: this.options.nPlusOneThreshold ?? 5,
      chattyThreshold: this.options.chattyThreshold ?? 10,
      isErrorEntry: this.isErrorEntry,
      errorSeverity: resolveErrorSeverity(this.options.error),
      slowSeverity: this.options.slowSeverity,
      nPlusOneSeverity: this.options.nPlusOneSeverity,
      chattySeverity: this.options.chattySeverity,
    };
  }
}
