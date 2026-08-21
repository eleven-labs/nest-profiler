import type { Profile } from '@eleven-labs/nest-profiler';
import { RabbitMqPublishCollector } from './rabbitmq-publish.collector';
import { RABBITMQ_PUBLISHES_KEY } from './rabbitmq-publish-collector.interface';
import type { RabbitMqPublishEntry } from './rabbitmq-publish-collector.interface';

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

function makeMessage(overrides: Partial<RabbitMqPublishEntry> = {}): RabbitMqPublishEntry {
  return {
    exchange: 'articles.events',
    routingKey: 'published.LEFIGARO',
    startedAt: Date.now(),
    duration: 4,
    accepted: true,
    ...overrides,
  };
}

const slowTag = { id: 'slow', label: 'Slow', severity: 'warning' as const };

describe('RabbitMqPublishCollector', () => {
  let collector: RabbitMqPublishCollector;

  beforeEach(() => {
    collector = new RabbitMqPublishCollector();
  });

  it('exposes the panel metadata and its template', () => {
    expect(collector.name).toBe('rabbitmq-publish');
    expect(collector.label).toBe('RabbitMQ');
    expect(collector.tagDomain).toBe('rabbitmq');
    expect(collector.getTemplatePath()).toMatch(/templates[/\\]rabbitmq-publish-panel\.ejs$/);
  });

  it('stamps a fingerprint and a publish snippet, and drains the private key', () => {
    const message = makeMessage({ routingKey: 'article.42.published', payload: { id: 42 } });
    const profile = makeProfile({ collectors: { [RABBITMQ_PUBLISHES_KEY]: [message] } });

    const [collected] = collector.collect(profile);

    expect(collected?.fingerprint).toBe('articles.events article.:id.published');
    expect(collected?.publishSnippet).toContain('channel.publish(');
    expect(collected?.publishSnippet).toContain('"articles.events"');
    expect(profile.collectors[RABBITMQ_PUBLISHES_KEY]).toBeUndefined();
  });

  it('returns an empty array when nothing was published', () => {
    expect(collector.collect(makeProfile())).toEqual([]);
  });

  it('badges the number of published messages, and nothing when there is none', () => {
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
    const message = makeMessage();
    const profile = makeProfile({ collectors: { [RABBITMQ_PUBLISHES_KEY]: [message, message] } });
    expect(collector.getBadgeValue(profile)).toBe('2');
  });

  it('colours the nav tab with the worst tag severity', () => {
    const profile = makeProfile({
      collectors: { [RABBITMQ_PUBLISHES_KEY]: [makeMessage({ tags: [slowTag] })] },
    });
    expect(collector.getBadgeSeverity(profile)).toBe('warning');
    expect(collector.getBadgeSeverity(makeProfile())).toBeNull();
  });

  it('reads the collected messages from the panel key once collected', () => {
    const message = makeMessage();
    const profile = makeProfile({ collectors: { 'rabbitmq-publish': [message] } });
    expect(collector.getTaggableEntries(profile)).toEqual([message]);
  });

  it('defaults the thresholds to RabbitMQ-sized values', () => {
    expect(collector.getTagConfig()).toMatchObject({
      slowThreshold: 50,
      nPlusOneThreshold: 2,
      chattyThreshold: 10,
    });
  });

  it('feeds the rule engine the configured thresholds and severities', () => {
    const configured = new RabbitMqPublishCollector({
      slowThreshold: 200,
      nPlusOneThreshold: 5,
      chattyThreshold: 40,
      slowSeverity: 'info',
    });

    expect(configured.getTagConfig()).toMatchObject({
      slowThreshold: 200,
      nPlusOneThreshold: 5,
      chattyThreshold: 40,
      slowSeverity: 'info',
    });
  });

  it('treats a rejected publish as an error, unless the host classifies it away', () => {
    const failed = makeMessage({ error: 'Channel closed' });
    expect(collector.getTagConfig().isErrorEntry?.(failed)).toBe(true);

    const lenient = new RabbitMqPublishCollector({
      error: { classify: (entry) => (entry.error?.includes('Channel closed') ? false : undefined) },
    });
    expect(lenient.getTagConfig().isErrorEntry?.(failed)).toBe(false);
  });

  it('does not treat a buffered publish as an error', () => {
    expect(collector.getTagConfig().isErrorEntry?.(makeMessage({ accepted: false }))).toBe(false);
  });
});
