import { TimelineCollector } from './timeline.collector';
import type { Profile, TimelineSpan } from '../../interfaces/profile.interface';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 't',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

describe('TimelineCollector', () => {
  const collector = new TimelineCollector();

  describe('getBadgeValue', () => {
    it('formats the duration in milliseconds when defined', () => {
      const profile = makeProfile({ performance: { startTime: 0, heapUsed: 0, duration: 12 } });
      expect(collector.getBadgeValue(profile)).toBe('12ms');
    });

    it('returns null when duration is undefined', () => {
      expect(collector.getBadgeValue(makeProfile())).toBeNull();
    });
  });

  describe('collect', () => {
    it('returns the spans recorded on the profile', () => {
      const spans: TimelineSpan[] = [{ phase: 'db', startedAt: 1, duration: 5 }];
      expect(collector.collect(makeProfile({ spans }))).toBe(spans);
    });

    it('returns an empty array when no spans are present', () => {
      expect(collector.collect(makeProfile())).toEqual([]);
    });
  });

  describe('getTemplatePath', () => {
    it('points at the timeline panel template', () => {
      expect(collector.getTemplatePath().replace(/\\/g, '/')).toMatch(
        /templates\/timeline-panel\.ejs$/,
      );
    });
  });
});
