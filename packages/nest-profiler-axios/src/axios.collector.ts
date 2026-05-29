import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { ProfilerCollector } from '@eleven-labs/nest-profiler';
import type { IProfilerCollector, Profile } from '@eleven-labs/nest-profiler';
import { getCollectorEntries } from '@eleven-labs/nest-profiler';
import type { HttpRequestEntry } from './axios-collector.interface';
import { AXIOS_REQUESTS_KEY } from './axios-collector.interface';

const HTTP_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-3 4-3 6s1 4 3 6M8 2c2 2 3 4 3 6s-1 4-3 6"/></svg>`;

@Injectable()
@ProfilerCollector({ name: 'axios', label: 'HTTP Client', icon: HTTP_ICON, priority: 20 })
export class AxiosCollector implements IProfilerCollector {
  readonly name = 'axios';
  readonly label = 'HTTP Client';
  readonly icon = HTTP_ICON;
  readonly priority = 20;

  getBadgeValue(profile: Profile): string | null {
    const requests =
      (profile.collectors[this.name] as HttpRequestEntry[] | undefined) ??
      getCollectorEntries<HttpRequestEntry>(profile, AXIOS_REQUESTS_KEY);
    if (!requests.length) return null;
    const errCount = requests.filter(
      (r) => r.error != null || (r.statusCode != null && r.statusCode >= 400),
    ).length;
    return errCount > 0 ? `${requests.length} (${errCount} err)` : String(requests.length);
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'axios-panel.ejs');
  }

  collect(profile: Profile): HttpRequestEntry[] {
    const requests = getCollectorEntries<HttpRequestEntry>(profile, AXIOS_REQUESTS_KEY);
    delete profile.collectors[AXIOS_REQUESTS_KEY];
    return requests;
  }
}
