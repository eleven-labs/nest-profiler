import * as path from 'path';
import type { Profile } from '@eleven-labs/nest-profiler';
import { EventEmitterCollector } from './event-emitter.collector';
import { EVENT_EMITTER_EVENTS_KEY } from './event-emitter.patch';
import type { EventEntry } from './event-emitter-collector.interface';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function makeEntry(overrides: Partial<EventEntry> = {}): EventEntry {
  return {
    event: 'review.created',
    listenerCount: 1,
    duration: 5,
    async: false,
    startedAt: Date.now(),
    fingerprint: 'review.created',
    ...overrides,
  };
}

describe('EventEmitterCollector', () => {
  let collector: EventEmitterCollector;

  beforeEach(() => {
    collector = new EventEmitterCollector();
  });

  it('collects emissions and removes the internal key', () => {
    const entry = makeEntry();
    const profile = makeProfile({ collectors: { [EVENT_EMITTER_EVENTS_KEY]: [entry] } });

    expect(collector.collect(profile)).toEqual([entry]);
    expect(profile.collectors[EVENT_EMITTER_EVENTS_KEY]).toBeUndefined();
  });

  it('returns an empty list when nothing was emitted', () => {
    expect(collector.collect(makeProfile())).toEqual([]);
  });

  it('reads back the collected key once collect has run', () => {
    const profile = makeProfile({ collectors: { 'event-emitter': [makeEntry(), makeEntry()] } });
    expect(collector.getBadgeValue(profile)).toBe('2');
  });

  describe('getBadgeValue', () => {
    it('is null when no event was emitted', () => {
      expect(collector.getBadgeValue(makeProfile())).toBeNull();
    });

    it('counts the emissions', () => {
      const profile = makeProfile({
        collectors: { [EVENT_EMITTER_EVENTS_KEY]: [makeEntry(), makeEntry()] },
      });
      expect(collector.getBadgeValue(profile)).toBe('2');
    });
  });

  describe('getBadgeSeverity', () => {
    it('is null when nothing is tagged and nothing errored', () => {
      const profile = makeProfile({ collectors: { [EVENT_EMITTER_EVENTS_KEY]: [makeEntry()] } });
      expect(collector.getBadgeSeverity(profile)).toBeNull();
    });

    it('falls back to danger when an untagged emission carries an error', () => {
      const profile = makeProfile({
        collectors: { [EVENT_EMITTER_EVENTS_KEY]: [makeEntry({ error: 'boom' })] },
      });
      expect(collector.getBadgeSeverity(profile)).toBe('danger');
    });

    it('reports the worst tag severity once the engine has run', () => {
      const profile = makeProfile({
        collectors: {
          'event-emitter': [
            makeEntry({ tags: [{ id: 'slow', label: 'Slow', severity: 'warning' }] }),
            makeEntry({ tags: [{ id: 'error', label: 'Error', severity: 'danger' }] }),
          ],
        },
      });
      expect(collector.getBadgeSeverity(profile)).toBe('danger');
    });
  });

  it('points at the panel template shipped next to the compiled module', () => {
    expect(collector.getTemplatePath()).toBe(
      path.join(__dirname, 'templates', 'event-emitter-panel.ejs'),
    );
  });

  describe('performance tagging', () => {
    it('declares its own rule domain', () => {
      expect(collector.tagDomain).toBe('event');
    });

    it('exposes the collected entries to the rule engine', () => {
      const entries = [makeEntry()];
      const profile = makeProfile({ collectors: { 'event-emitter': entries } });
      expect(collector.getTaggableEntries(profile)).toBe(entries);
    });

    it('returns undefined before collect has run', () => {
      expect(collector.getTaggableEntries(makeProfile())).toBeUndefined();
    });

    it('defaults the thresholds', () => {
      expect(collector.getTagConfig()).toMatchObject({
        slowThreshold: 100,
        nPlusOneThreshold: 2,
        chattyThreshold: 20,
        errorSeverity: 'danger',
        slowSeverity: 'warning',
      });
    });

    it('reads the thresholds from the module options', () => {
      const configured = new EventEmitterCollector({
        slowThreshold: 10,
        nPlusOneThreshold: 5,
        chattyThreshold: 50,
        slowSeverity: 'danger',
        error: { severity: 'warning' },
      });

      expect(configured.getTagConfig()).toMatchObject({
        slowThreshold: 10,
        nPlusOneThreshold: 5,
        chattyThreshold: 50,
        slowSeverity: 'danger',
        errorSeverity: 'warning',
      });
    });

    it('fails an entry on its own error only — an emission has no status code', () => {
      const { isErrorEntry } = collector.getTagConfig();

      expect(isErrorEntry?.(makeEntry({ error: 'boom' }))).toBe(true);
      expect(isErrorEntry?.(makeEntry())).toBe(false);
      expect(isErrorEntry?.({ duration: 1, statusCode: 503 } as never)).toBe(false);
    });
  });
});
