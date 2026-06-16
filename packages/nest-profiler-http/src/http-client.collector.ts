import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { ProfilerCollector } from '@eleven-labs/nest-profiler';
import type { IProfilerCollector, Profile } from '@eleven-labs/nest-profiler';
import { getCollectorEntries } from '@eleven-labs/nest-profiler';
import type { HttpRequestEntry } from './http-request.interface';
import { HTTP_CLIENT_REQUESTS_KEY } from './http-request.interface';

const HTTP_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-3 4-3 6s1 4 3 6M8 2c2 2 3 4 3 6s-1 4-3 6"/></svg>`;

/**
 * Renders the client-agnostic "HTTP Client" panel from {@link HttpRequestEntry}
 * items accumulated under {@link HTTP_CLIENT_REQUESTS_KEY}, regardless of which
 * client recorded them. Registered by {@link HttpCollectorModule}.
 */
@Injectable()
@ProfilerCollector({ name: 'http-client', label: 'HTTP Client', icon: HTTP_ICON, priority: 20 })
export class HttpClientCollector implements IProfilerCollector {
  readonly name = 'http-client';
  readonly label = 'HTTP Client';
  readonly icon = HTTP_ICON;
  readonly priority = 20;

  getBadgeValue(profile: Profile): string | null {
    const requests =
      (profile.collectors[this.name] as HttpRequestEntry[] | undefined) ??
      getCollectorEntries<HttpRequestEntry>(profile, HTTP_CLIENT_REQUESTS_KEY);
    if (!requests.length) return null;
    const errCount = requests.filter(
      (r) => r.error != null || (r.statusCode != null && r.statusCode >= 400),
    ).length;
    return errCount > 0 ? `${requests.length} (${errCount} err)` : String(requests.length);
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'http-client-panel.ejs');
  }

  collect(profile: Profile): HttpRequestEntry[] {
    const requests = getCollectorEntries<HttpRequestEntry>(profile, HTTP_CLIENT_REQUESTS_KEY);
    delete profile.collectors[HTTP_CLIENT_REQUESTS_KEY];
    return requests;
  }
}
