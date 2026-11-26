import type { Profile } from '@eleven-labs/nest-profiler';
import { PubSubPublishCollector } from './pubsub-publish.collector.js';
import { PUBSUB_PUBLISHES_KEY } from './pubsub-publish-collector.interface.js';
import type { PubSubPublishEntry } from './pubsub-publish-collector.interface.js';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    traceId: 'trace-test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function makeMessage(overrides: Partial<PubSubPublishEntry> = {}): PubSubPublishEntry {
  return {
    topic: 'orders',
    projectId: 'my-project',
    startedAt: Date.now(),
    duration: 12,
    messageId: '1234',
    ...overrides,
  };
}

const slowTag = { id: 'slow', label: 'Slow', severity: 'warning' as const };

describe('PubSubPublishCollector', () => {
  let collector: PubSubPublishCollector;

  beforeEach(() => {
    collector = new PubSubPublishCollector();
  });

  it('exposes the panel metadata and its template', () => {
    expect(collector.name).toBe('pubsub-publish');
    expect(collector.label).toBe('Pub/Sub');
    expect(collector.tagDomain).toBe('pubsub');
    expect(collector.getTemplatePath()).toMatch(/templates[/\\]pubsub-publish-panel\.ejs$/);
  });

  it('stamps a fingerprint and a publish snippet, and drains the private key', () => {
    const message = makeMessage({ payload: { id: 42 } });
    const profile = makeProfile({ collectors: { [PUBSUB_PUBLISHES_KEY]: [message] } });

    const [collected] = collector.collect(profile);

    expect(collected?.fingerprint).toBe('orders');
    expect(collected?.publishSnippet).toContain('pubsub.topic("orders").publishMessage(');
    expect(profile.collectors[PUBSUB_PUBLISHES_KEY]).toBeUndefined();
  });

  it('returns an empty array when nothing was published', () => {
    expect(collector.collect(makeProfile())).toEqual([]);
  });

  it('badges the number of published messages, and nothing when there is none', () => {
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
    const message = makeMessage();
    const profile = makeProfile({ collectors: { [PUBSUB_PUBLISHES_KEY]: [message, message] } });
    expect(collector.getBadgeValue(profile)).toBe('2');
  });

  it('colours the nav tab with the worst tag severity', () => {
    const profile = makeProfile({
      collectors: { [PUBSUB_PUBLISHES_KEY]: [makeMessage({ tags: [slowTag] })] },
    });
    expect(collector.getBadgeSeverity(profile)).toBe('warning');
    expect(collector.getBadgeSeverity(makeProfile())).toBeNull();
  });

  it('reads the collected messages from the panel key once collected', () => {
    const message = makeMessage();
    const profile = makeProfile({ collectors: { 'pubsub-publish': [message] } });
    expect(collector.getTaggableEntries(profile)).toEqual([message]);
    expect(collector.getBadgeValue(profile)).toBe('1');
  });

  it('defaults the thresholds to Pub/Sub-sized values', () => {
    expect(collector.getTagConfig()).toMatchObject({
      slowThreshold: 100,
      nPlusOneThreshold: 5,
      chattyThreshold: 10,
    });
  });

  it('feeds the rule engine the configured thresholds and severities', () => {
    const configured = new PubSubPublishCollector({
      slowThreshold: 200,
      nPlusOneThreshold: 8,
      chattyThreshold: 40,
      slowSeverity: 'info',
      nPlusOneSeverity: 'warning',
      chattySeverity: 'info',
    });

    expect(configured.getTagConfig()).toMatchObject({
      slowThreshold: 200,
      nPlusOneThreshold: 8,
      chattyThreshold: 40,
      slowSeverity: 'info',
      nPlusOneSeverity: 'warning',
      chattySeverity: 'info',
    });
  });

  it('treats a failed publish as an error, unless the host classifies it away', () => {
    const failed = makeMessage({ error: 'CANCELLED: client closed' });
    expect(collector.getTagConfig().isErrorEntry?.(failed)).toBe(true);
    expect(collector.getTagConfig().isErrorEntry?.(makeMessage())).toBe(false);

    const lenient = new PubSubPublishCollector({
      error: { classify: (entry) => (entry.error?.includes('CANCELLED') ? false : undefined) },
    });
    expect(lenient.getTagConfig().isErrorEntry?.(failed)).toBe(false);
  });
});
