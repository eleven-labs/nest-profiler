import * as path from 'node:path';
import { ClientAssetRegistry, TemplateRendererService } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { EVENT_ENTRYPOINT_TYPE } from './event-entrypoint';
import type { EventEntrypointData } from './event-entrypoint';

function profileWith(
  data: Partial<EventEntrypointData> = {},
  overrides: Partial<Profile<EventEntrypointData>> = {},
): Profile<EventEntrypointData> {
  return {
    token: 'abcdef1234',
    traceId: 'trace-test',
    createdAt: 0,
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
    // A sub-millisecond duration: the monotonic clock reports decimals, which the templates must
    // format rather than print raw.
    performance: { startTime: 0, duration: 0.4242, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

describe('event templates', () => {
  let service: TemplateRendererService;

  beforeEach(() => {
    service = new TemplateRendererService(new ClientAssetRegistry());
    service.registerDir(path.join(__dirname, 'templates'));
  });

  describe('events list section', () => {
    it('leads with time and duration, and makes the whole row the link to the profile', async () => {
      const html = await service.render('events-section', {
        profiles: [profileWith({}, { tags: [{ id: 'slow', label: 'slow', severity: 'warning' }] })],
        profilerPath: '/_profiler',
      });

      expect(html).toContain('data-row-href="/_profiler/abcdef1234"');
      expect(html).toContain('review.created');
      expect(html).toContain('ReviewListener.onCreated()');
      expect(html).toContain('OK');
      // Formatted, not the raw `0.4242ms` the monotonic clock hands over.
      expect(html).toContain('0.42ms');
      expect(html).toContain('slow');
    });

    it('badges a failed handler and shows the empty state when nothing ran', async () => {
      const failed = await service.render('events-section', {
        profiles: [profileWith({ success: false })],
        profilerPath: '/_profiler',
      });
      expect(failed).toContain('FAILED');

      const empty = await service.render('events-section', {
        profiles: [],
        profilerPath: '/_profiler',
      });
      expect(empty).toContain('No event executions found');
    });
  });

  describe('event detail tab', () => {
    it('formats the handler duration and names the subscription that ran', async () => {
      const html = await service.render('event-detail', { profile: profileWith() });

      expect(html).toContain('0.42ms');
      expect(html).toContain('review.created');
      expect(html).toContain('ReviewListener');
      expect(html).toContain('onCreated');
    });
  });
});
