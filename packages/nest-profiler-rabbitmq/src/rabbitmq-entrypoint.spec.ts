import type { Profile } from '@eleven-labs/nest-profiler';
import { distinctInMemory, matchesCriterion, summarizeProfile } from '@eleven-labs/nest-profiler';
import { RABBITMQ_ENTRYPOINT_TYPE_DEF } from './rabbitmq-entrypoint';
import { RABBITMQ_ENTRYPOINT_TYPE } from './rabbitmq-collector.interface';
import type { RabbitMqInfo } from './rabbitmq-collector.interface';

const attrs = (p: Profile): Record<string, string | number | boolean> =>
  RABBITMQ_ENTRYPOINT_TYPE_DEF.indexAttributes?.(p) ?? {};

function makeProfile(data: RabbitMqInfo): Profile {
  return {
    token: 'tok',
    createdAt: 0,
    entrypoint: { type: RABBITMQ_ENTRYPOINT_TYPE, data },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

/** Applies a filter through the declarative path: parse → criterion → evaluate on the summary. */
function applies(key: string, value: string, profile: Profile): boolean {
  const filter = RABBITMQ_ENTRYPOINT_TYPE_DEF.listFilters?.find((f) => f.key === key);
  return matchesCriterion(summarizeProfile(profile, attrs), filter!.toCriterion(value));
}

/** The distinct option values a dynamic filter would offer for the given profiles. */
function distinctFor(field: string, profiles: Profile[]): (string | number | boolean)[] {
  return distinctInMemory(profiles, field, attrs).sort();
}

describe('RABBITMQ_ENTRYPOINT_TYPE_DEF', () => {
  it('describes the rabbitmq entrypoint type', () => {
    expect(RABBITMQ_ENTRYPOINT_TYPE_DEF.type).toBe(RABBITMQ_ENTRYPOINT_TYPE);
    expect(RABBITMQ_ENTRYPOINT_TYPE_DEF.label).toBe('RabbitMQ');
    expect(RABBITMQ_ENTRYPOINT_TYPE_DEF.listSection.templatePath).toMatch(/rabbitmq-section\.ejs$/);
    expect(RABBITMQ_ENTRYPOINT_TYPE_DEF.detailTabs).toHaveLength(1);
    expect(RABBITMQ_ENTRYPOINT_TYPE_DEF.detailTabs[0]?.name).toBe('message');
    expect(RABBITMQ_ENTRYPOINT_TYPE_DEF.detailTabs[0]?.templatePath).toMatch(/message\.ejs$/);
  });

  describe('redelivered filter', () => {
    const filter = RABBITMQ_ENTRYPOINT_TYPE_DEF.listFilters?.find((f) => f.key === 'redelivered');
    const first = makeProfile({ exchange: 'e', routingKey: 'k', redelivered: false });
    const again = makeProfile({ exchange: 'e', routingKey: 'k', redelivered: true });

    it('is contributed as a select control', () => {
      expect(filter?.control).toBe('select');
    });

    it('matches redeliveries for "redelivered" and first deliveries for "first"', () => {
      expect(applies('redelivered', 'redelivered', again)).toBe(true);
      expect(applies('redelivered', 'redelivered', first)).toBe(false);
      expect(applies('redelivered', 'first', first)).toBe(true);
      expect(applies('redelivered', 'first', again)).toBe(false);
    });

    it('treats a missing redelivered flag as a first delivery', () => {
      const unknown = makeProfile({ exchange: 'e', routingKey: 'k' });
      expect(applies('redelivered', 'first', unknown)).toBe(true);
      expect(applies('redelivered', 'redelivered', unknown)).toBe(false);
    });

    it('is inactive for an empty value', () => {
      expect(filter?.parse('')).toBeUndefined();
    });
  });

  describe('exchange filter', () => {
    const filter = RABBITMQ_ENTRYPOINT_TYPE_DEF.listFilters?.find((f) => f.key === 'exchange');
    const profiles = [
      makeProfile({ exchange: 'articles.events', routingKey: 'a' }),
      makeProfile({ exchange: '', routingKey: 'b' }),
      makeProfile({ exchange: 'articles.events', routingKey: 'c' }),
    ];

    it('offers the seen exchanges as distinct options (empty exchange → "(default)")', () => {
      expect(filter?.distinctField).toBe('attributes.exchange');
      expect(distinctFor('attributes.exchange', profiles)).toEqual([
        '(default)',
        'articles.events',
      ]);
    });

    it('matches by exchange, mapping the empty exchange to "(default)"', () => {
      expect(applies('exchange', 'articles.events', profiles[0]!)).toBe(true);
      expect(applies('exchange', '(default)', profiles[0]!)).toBe(false);
      expect(applies('exchange', '(default)', profiles[1]!)).toBe(true);
    });

    it('parses a non-empty value and is inactive otherwise', () => {
      expect(filter?.parse('articles.events')).toBe('articles.events');
      expect(filter?.parse('')).toBeUndefined();
      expect(filter?.parse(undefined)).toBeUndefined();
    });
  });

  describe('handler filter', () => {
    const filter = RABBITMQ_ENTRYPOINT_TYPE_DEF.listFilters?.find((f) => f.key === 'handler');
    const withHandler = makeProfile({
      exchange: 'e',
      routingKey: 'k',
      handler: 'NarrationService.createGeneration',
    });
    const withoutHandler = makeProfile({ exchange: 'e', routingKey: 'k' });

    it('lists only the handlers actually present', () => {
      expect(filter?.distinctField).toBe('attributes.handler');
      expect(distinctFor('attributes.handler', [withHandler, withoutHandler])).toEqual([
        'NarrationService.createGeneration',
      ]);
    });

    it('matches the exact handler', () => {
      expect(applies('handler', 'NarrationService.createGeneration', withHandler)).toBe(true);
      expect(applies('handler', 'NarrationService.createGeneration', withoutHandler)).toBe(false);
    });

    it('parses a non-empty value and is inactive otherwise', () => {
      expect(filter?.parse('NarrationService.createGeneration')).toBe(
        'NarrationService.createGeneration',
      );
      expect(filter?.parse('')).toBeUndefined();
      expect(filter?.parse(undefined)).toBeUndefined();
    });
  });

  describe('routingKey filter', () => {
    const filter = RABBITMQ_ENTRYPOINT_TYPE_DEF.listFilters?.find((f) => f.key === 'routingKey');
    const profile = makeProfile({ exchange: 'e', routingKey: 'published.LEFIGARO' });

    it('lower-cases the query and matches a substring of the routing key', () => {
      expect(filter?.parse('PUBLISHED')).toBe('published');
      expect(applies('routingKey', 'published', profile)).toBe(true);
      expect(applies('routingKey', 'tts', profile)).toBe(false);
    });

    it('is inactive for an empty value', () => {
      expect(filter?.parse('')).toBeUndefined();
    });
  });

  describe('summary', () => {
    it('renders the exchange and routing key', () => {
      const profile = makeProfile({
        exchange: 'articles.events',
        routingKey: 'published.LEFIGARO',
      });
      expect(RABBITMQ_ENTRYPOINT_TYPE_DEF.summary(profile)).toEqual({
        badge: 'RMQ',
        badgeClass: 'badge-default',
        text: 'articles.events → published.LEFIGARO',
      });
    });

    it('labels the default (empty) exchange', () => {
      const profile = makeProfile({ exchange: '', routingKey: 'tts.narration' });
      expect(RABBITMQ_ENTRYPOINT_TYPE_DEF.summary(profile).text).toBe('(default) → tts.narration');
    });
  });
});
