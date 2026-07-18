import { TimelineCollector } from './timeline.collector';
import type { Profile, TraceSpan } from '../../interfaces/profile.interface';

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
    it('returns the assembled trace recorded on the profile', () => {
      const trace: TraceSpan[] = [
        { id: 'root', kind: 'entrypoint', label: 'GET /', startedAt: 0, duration: 10 },
      ];
      expect(collector.collect(makeProfile({ trace }))).toBe(trace);
    });

    it('returns an empty array when no trace is present', () => {
      expect(collector.collect(makeProfile())).toEqual([]);
    });
  });

  describe('getBadgeSeverity', () => {
    it('flags danger when any span failed', () => {
      const trace: TraceSpan[] = [
        { id: 'root', kind: 'entrypoint', label: 'GET /', startedAt: 0, duration: 10 },
        {
          id: 'db-0',
          parentId: 'root',
          kind: 'db',
          label: 'SELECT 1',
          startedAt: 1,
          duration: 2,
          status: 'error',
        },
      ];
      expect(collector.getBadgeSeverity(makeProfile({ trace }))).toBe('danger');
    });

    it('returns null when every span is ok', () => {
      expect(collector.getBadgeSeverity(makeProfile())).toBeNull();
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
