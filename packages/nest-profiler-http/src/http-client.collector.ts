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
  normalizeHttpFingerprint,
  resolveEntryErrorClassifier,
  resolveErrorSeverity,
} from '@eleven-labs/nest-profiler';
import type { HttpRequestEntry } from './http-request.interface';
import { HTTP_CLIENT_REQUESTS_KEY } from './http-request.interface';
import { HTTP_COLLECTOR_OPTIONS } from './http-collector.constants';
import type { HttpCollectorModuleOptions } from './http-collector.constants';

const HTTP_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-3 4-3 6s1 4 3 6M8 2c2 2 3 4 3 6s-1 4-3 6"/></svg>`;

/**
 * Renders the client-agnostic "HTTP Client" panel from {@link HttpRequestEntry}
 * items accumulated under {@link HTTP_CLIENT_REQUESTS_KEY}, regardless of which
 * client recorded them. Registered by {@link HttpCollectorModule}.
 *
 * Implements {@link TaggableCollector} so the core performance-rule engine can flag
 * slow, N+1, failed and large-payload calls; the per-call `fingerprint` (method
 * + normalized URL) is stamped at collect time.
 */
@Injectable()
@ProfilerCollector({ name: 'http-client', label: 'HTTP Client', icon: HTTP_ICON, priority: 20 })
export class HttpClientCollector implements IProfilerCollector, TaggableCollector {
  readonly name = 'http-client';
  readonly label = 'HTTP Client';
  readonly icon = HTTP_ICON;
  readonly priority = 20;
  readonly tagDomain = 'http';

  /** Resolved once: `getTagConfig()` runs on every profile, the options never change. */
  private readonly isErrorEntry: (entry: TaggableEntry) => boolean;

  constructor(
    @Optional()
    @Inject(HTTP_COLLECTOR_OPTIONS)
    private readonly options: HttpCollectorModuleOptions = {},
  ) {
    this.isErrorEntry = resolveEntryErrorClassifier(options.error);
  }

  getBadgeValue(profile: Profile): string | null {
    const requests = this.entriesOf(profile);
    return requests.length ? String(requests.length) : null;
  }

  /** Worst tag severity across the calls — colours the panel's nav tab. */
  getBadgeSeverity(profile: Profile): TagSeverity | null {
    return maxTagSeverity(this.entriesOf(profile));
  }

  private entriesOf(profile: Profile): HttpRequestEntry[] {
    return (
      (profile.collectors[this.name] as HttpRequestEntry[] | undefined) ??
      getCollectorEntries<HttpRequestEntry>(profile, HTTP_CLIENT_REQUESTS_KEY)
    );
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'http-client-panel.ejs');
  }

  collect(profile: Profile): HttpRequestEntry[] {
    const requests = getCollectorEntries<HttpRequestEntry>(profile, HTTP_CLIENT_REQUESTS_KEY);
    delete profile.collectors[HTTP_CLIENT_REQUESTS_KEY];
    return requests.map((request) => ({
      ...request,
      fingerprint: normalizeHttpFingerprint(request.method, request.url),
    }));
  }

  /** The collected calls, for the performance-rule engine (post-`collect`). */
  getTaggableEntries(profile: Profile): HttpRequestEntry[] | undefined {
    return profile.collectors[this.name] as HttpRequestEntry[] | undefined;
  }

  /** Feeds the core performance-rule engine the thresholds configured on this module. */
  getTagConfig(): TagConfig {
    return {
      slowThreshold: this.options.slowThreshold ?? 300,
      nPlusOneThreshold: this.options.nPlusOneThreshold ?? 2,
      chattyThreshold: this.options.chattyThreshold ?? 10,
      largePayloadThreshold: this.options.largePayloadThreshold ?? 1_048_576,
      isErrorEntry: this.isErrorEntry,
      errorSeverity: resolveErrorSeverity(this.options.error),
      slowSeverity: this.options.slowSeverity,
      nPlusOneSeverity: this.options.nPlusOneSeverity,
      chattySeverity: this.options.chattySeverity,
      largePayloadSeverity: this.options.largePayloadSeverity,
    };
  }
}
