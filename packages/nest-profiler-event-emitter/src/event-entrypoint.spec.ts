import * as path from 'path';
import type { Profile } from '@eleven-labs/nest-profiler';
import {
  EVENT_ENTRYPOINT_TYPE,
  EVENT_ENTRYPOINT_TYPE_DEF,
  buildEventEntrypointType,
} from './event-entrypoint';
import type { EventEntrypointData } from './event-entrypoint';

function makeProfile(
  data: Partial<EventEntrypointData> = {},
  overrides: Partial<Profile<EventEntrypointData>> = {},
): Profile<EventEntrypointData> {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: {
      type: EVENT_ENTRYPOINT_TYPE,
      data: {
        event: 'review.created',
        provider: 'ReviewListener',
        method: 'onCreated',
        success: true,
        ...data,
      },
    },
    performance: { startTime: Date.now(), heapUsed: 0, duration: 12 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

describe('EVENT_ENTRYPOINT_TYPE_DEF', () => {
  it('declares the event kind with its list section and detail tab', () => {
    expect(EVENT_ENTRYPOINT_TYPE_DEF).toMatchObject({
      type: 'event',
      label: 'Event',
      hiddenFilters: ['error'],
    });
    expect(EVENT_ENTRYPOINT_TYPE_DEF.listSection).toMatchObject({
      title: 'Events',
      itemLabel: 'event',
      order: 30,
      templatePath: path.join(__dirname, 'templates', 'events-section.ejs'),
    });
    expect(EVENT_ENTRYPOINT_TYPE_DEF.detailTabs).toHaveLength(1);
    expect(EVENT_ENTRYPOINT_TYPE_DEF.detailTabs[0]).toMatchObject({
      name: 'event',
      label: 'Event',
      templatePath: path.join(__dirname, 'templates', 'event-detail.ejs'),
    });
  });

  it('is not the default kind — the core http kind is', () => {
    expect(EVENT_ENTRYPOINT_TYPE_DEF.isDefault).toBeUndefined();
  });

  it('summarises the execution as event → handler', () => {
    expect(EVENT_ENTRYPOINT_TYPE_DEF.summary(makeProfile())).toEqual({
      badge: 'EVENT',
      badgeClass: 'badge-default',
      text: 'review.created → ReviewListener.onCreated()',
    });
  });

  it('indexes the queryable facets', () => {
    expect(EVENT_ENTRYPOINT_TYPE_DEF.indexAttributes?.(makeProfile())).toEqual({
      success: true,
      event: 'review.created',
    });
    expect(EVENT_ENTRYPOINT_TYPE_DEF.indexAttributes?.(makeProfile({ success: false }))).toEqual({
      success: false,
      event: 'review.created',
    });
  });

  describe('list filters', () => {
    const filters = EVENT_ENTRYPOINT_TYPE_DEF.listFilters ?? [];
    const statusFilter = filters.find((f) => f.key === 'eventStatus');
    const nameFilter = filters.find((f) => f.key === 'eventName');

    it('scopes both filters to the event kind', () => {
      expect(filters).toHaveLength(2);
      for (const filter of filters) expect(filter.forType).toBe('event');
    });

    it('parses the status filter into a boolean criterion', () => {
      expect(statusFilter?.parse('success')).toBe(true);
      expect(statusFilter?.parse('failed')).toBe(false);
      expect(statusFilter?.parse('')).toBeUndefined();
      expect(statusFilter?.parse(undefined)).toBeUndefined();
      expect(statusFilter?.toCriterion(false)).toEqual({
        field: 'attributes.success',
        op: 'eq',
        value: false,
      });
    });

    it('populates the event filter from the distinct indexed names', () => {
      expect(nameFilter?.distinctField).toBe('attributes.event');
      expect(nameFilter?.parse('review.created')).toBe('review.created');
      expect(nameFilter?.parse('')).toBeUndefined();
      expect(nameFilter?.toCriterion('review.created')).toEqual({
        field: 'attributes.event',
        op: 'eq',
        value: 'review.created',
      });
    });
  });
});

describe('buildEventEntrypointType', () => {
  const failed = () =>
    makeProfile(
      { success: false },
      {
        response: { statusCode: 500, headers: {}, body: undefined },
        exceptions: [{ name: 'TimeoutError', message: 'too slow', timestamp: Date.now() }],
      },
    );

  it('treats a thrown handler as a failure by default', () => {
    expect(buildEventEntrypointType().isError?.(failed())).toBe(true);
  });

  it('treats a clean execution as a success', () => {
    const profile = makeProfile(
      {},
      { response: { statusCode: 200, headers: {}, body: undefined } },
    );
    expect(buildEventEntrypointType().isError?.(profile)).toBe(false);
  });

  it('narrows the verdict to the configured exception classes', () => {
    const narrowed = buildEventEntrypointType({ exceptions: ['TimeoutError'] });
    expect(narrowed.isError?.(failed())).toBe(true);

    const other = makeProfile(
      { success: false },
      {
        response: { statusCode: 500, headers: {}, body: undefined },
        exceptions: [{ name: 'RetrySignal', message: 'retry', timestamp: Date.now() }],
      },
    );
    expect(narrowed.isError?.(other)).toBe(false);
  });

  it('lets a classify predicate settle the verdict', () => {
    const custom = buildEventEntrypointType({ classify: () => false });
    expect(custom.isError?.(failed())).toBe(false);
  });

  it('defaults the error severity to danger and honours an override', () => {
    expect(buildEventEntrypointType().errorSeverity).toBe('danger');
    expect(buildEventEntrypointType({ severity: 'warning' }).errorSeverity).toBe('warning');
  });
});
