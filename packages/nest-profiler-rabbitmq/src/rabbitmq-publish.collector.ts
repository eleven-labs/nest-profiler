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
import { buildRabbitMqPublish } from './build-rabbitmq-publish';
import { buildPublishFingerprint } from './rabbitmq-publish.util';
import {
  RABBITMQ_PUBLISHES_KEY,
  RABBITMQ_PUBLISH_COLLECTOR_OPTIONS,
} from './rabbitmq-publish-collector.interface';
import type {
  RabbitMqPublishEntry,
  RabbitMqPublishCollectorModuleOptions,
} from './rabbitmq-publish-collector.interface';

const PUBLISH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 11l18-8-8 18-2.5-7.5L3 11z"/></svg>`;

/**
 * Renders the **RabbitMQ** panel: the messages the profiled request published, captured by
 * {@link RabbitMqPublishPatch}. The counterpart of the consumer side — `RabbitMqCollectorModule`
 * profiles a message the application *receives*, this panel lists the ones it *sends*.
 *
 * Implements {@link TaggableCollector} in the `rabbitmq` domain so the core performance-rule engine
 * flags slow, repeated (N+1) and failed publishes; the per-message `fingerprint` and the
 * runnable publish snippet are stamped at collect time.
 */
@Injectable()
@ProfilerCollector({
  name: 'rabbitmq-publish',
  label: 'RabbitMQ',
  icon: PUBLISH_ICON,
  priority: 35,
})
export class RabbitMqPublishCollector implements IProfilerCollector, TaggableCollector {
  readonly name = 'rabbitmq-publish';
  readonly label = 'RabbitMQ';
  readonly icon = PUBLISH_ICON;
  readonly priority = 35;
  readonly tagDomain = 'rabbitmq';

  /** Resolved once: `getTagConfig()` runs on every profile, the options never change. */
  private readonly isErrorEntry: (entry: TaggableEntry) => boolean;

  constructor(
    @Optional()
    @Inject(RABBITMQ_PUBLISH_COLLECTOR_OPTIONS)
    private readonly options: RabbitMqPublishCollectorModuleOptions = {},
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

  private entriesOf(profile: Profile): RabbitMqPublishEntry[] {
    return (
      (profile.collectors[this.name] as RabbitMqPublishEntry[] | undefined) ??
      getCollectorEntries<RabbitMqPublishEntry>(profile, RABBITMQ_PUBLISHES_KEY)
    );
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'rabbitmq-publish-panel.ejs');
  }

  collect(profile: Profile): RabbitMqPublishEntry[] {
    const messages = getCollectorEntries<RabbitMqPublishEntry>(profile, RABBITMQ_PUBLISHES_KEY);
    delete profile.collectors[RABBITMQ_PUBLISHES_KEY];
    return messages.map((message) => ({
      ...message,
      fingerprint: buildPublishFingerprint(message.exchange, message.routingKey),
      publishSnippet: buildRabbitMqPublish(message),
    }));
  }

  /** The collected messages, for the performance-rule engine (post-`collect`). */
  getTaggableEntries(profile: Profile): RabbitMqPublishEntry[] | undefined {
    return profile.collectors[this.name] as RabbitMqPublishEntry[] | undefined;
  }

  /** Feeds the core performance-rule engine the thresholds configured on this module. */
  getTagConfig(): TagConfig {
    return {
      slowThreshold: this.options.slowThreshold ?? 50,
      nPlusOneThreshold: this.options.nPlusOneThreshold ?? 2,
      chattyThreshold: this.options.chattyThreshold ?? 10,
      isErrorEntry: this.isErrorEntry,
      errorSeverity: resolveErrorSeverity(this.options.error),
      slowSeverity: this.options.slowSeverity,
      nPlusOneSeverity: this.options.nPlusOneSeverity,
      chattySeverity: this.options.chattySeverity,
    };
  }
}
