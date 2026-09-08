import { Inject, Injectable, Optional } from '@nestjs/common';
import * as path from 'path';
import { HTTP_ICON, ProfilerCollector } from '@eleven-labs/nest-profiler';
import type {
  IProfilerCollector,
  Profile,
  TagConfig,
  TaggableCollector,
  TaggableEntry,
  TagSeverity,
  RawSpan,
  TraceContributor,
} from '@eleven-labs/nest-profiler';
import {
  entriesToSpans,
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
export class HttpClientCollector
  implements IProfilerCollector, TaggableCollector, TraceContributor
{
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

  /**
   * Projects each captured call onto the unified trace, so an outgoing request appears as a bar
   * under the code that issued it — next to the queries that ran alongside it, on one time axis.
   *
   * Error classification is the collector's own, not the trace's default: a 404 from an upstream
   * is an answer for some applications and a failure for others, and that is exactly what the
   * `error` option on this module already decides.
   */
  getTraceSpans(profile: Profile): RawSpan[] {
    const isError = resolveEntryErrorClassifier(this.options.error);
    return entriesToSpans(this.getTaggableEntries(profile), {
      kind: 'http',
      collector: this.name,
      label: (entry) => `${entry.method} ${entry.url}`,
      isError: (entry) => isError(entry),
      meta: (entry) => (entry.statusCode !== undefined ? { status: entry.statusCode } : undefined),
    });
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
