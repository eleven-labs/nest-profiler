import * as path from 'path';
import { ProfilerCollector } from '../collector.decorator';
import type { IProfilerCollector } from '../collector.interface';
import type { Profile, TimelineSpan } from '../../interfaces/profile.interface';

const TIMELINE_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="5" width="3" height="6" rx="0.5"/><rect x="5" y="3" width="3" height="10" rx="0.5" opacity="0.7"/><rect x="9" y="6" width="3" height="5" rx="0.5" opacity="0.5"/><rect x="13" y="4" width="2" height="7" rx="0.5" opacity="0.6"/></svg>`;

@ProfilerCollector({ name: 'timeline', label: 'Timeline', icon: TIMELINE_ICON, priority: 5 })
export class TimelineCollector implements IProfilerCollector {
  readonly name = 'timeline';
  readonly label = 'Timeline';
  readonly icon = TIMELINE_ICON;
  readonly priority = 5;

  getBadgeValue(profile: Profile): string | null {
    const dur = profile.performance.duration;
    return dur !== undefined ? `${dur}ms` : null;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'timeline-panel.ejs');
  }

  collect(profile: Profile): TimelineSpan[] {
    return profile.spans ?? [];
  }
}
