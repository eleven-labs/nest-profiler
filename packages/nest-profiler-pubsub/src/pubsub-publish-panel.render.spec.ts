import * as path from 'node:path';
import { ClientAssetRegistry, TemplateRendererService } from '@eleven-labs/nest-profiler';
import type { PubSubPublishEntry } from './pubsub-publish-collector.interface.js';

const PANEL = path.join(__dirname, 'templates', 'pubsub-publish-panel.ejs');

/** Renders the panel through the core layout, as the profiler does for any panel template. */
function render(data: PubSubPublishEntry[]): Promise<string> {
  const service = new TemplateRendererService(new ClientAssetRegistry());
  return service.render('list', {
    title: 'Profiles',
    profilerPath: '/_profiler',
    clientScripts: ['profiler.js'],
    profiles: [],
    sectionViews: [{ key: 'http', label: 'HTTP', count: 0 }],
    globalViewGroups: [
      { label: 'Pub/Sub', views: [{ key: 'pubsub', label: 'Pub/Sub', count: 1 }] },
    ],
    activeView: 'pubsub',
    activeGlobalPanel: { name: 'pubsub', label: 'Pub/Sub', templatePath: PANEL, data },
    filters: {},
  });
}

function makeMessage(overrides: Partial<PubSubPublishEntry> = {}): PubSubPublishEntry {
  return { topic: 'orders', startedAt: Date.now(), duration: 7, ...overrides };
}

describe('pubsub-publish-panel template', () => {
  it('renders the empty state when nothing was published', async () => {
    const html = await render([]);
    expect(html).toContain('No Pub/Sub message published during this request.');
  });

  it('renders the topic, properties, attributes and JSON payload of a message', async () => {
    const html = await render([
      makeMessage({
        projectId: 'my-project',
        messageId: '987',
        orderingKey: 'customer-1',
        size: 2048,
        attributes: { eventType: 'order.created' },
        payload: { id: 42 },
        publishSnippet: 'await pubsub.topic("orders").publishMessage({});',
      }),
    ]);

    expect(html).toContain('1</strong> message published');
    expect(html).toContain('orders');
    expect(html).toContain('987');
    expect(html).toContain('my-project');
    expect(html).toContain('customer-1');
    expect(html).toContain('2.0 KB');
    expect(html).toContain('order.created');
    expect(html).toContain('language-json');
    expect(html).toContain('Copy publish');
  });

  it('flags plain-text payloads, errors and multiple topics', async () => {
    const html = await render([
      makeMessage({ payload: 'hello', size: 5 }),
      makeMessage({ topic: 'audit', error: 'PERMISSION_DENIED' }),
    ]);

    expect(html).toContain('plain text');
    expect(html).toContain('Error: PERMISSION_DENIED');
    expect(html).toContain('2</strong> topics');
    expect(html).toContain('1</strong> error<');
  });

  it('escapes captured values', async () => {
    const html = await render([makeMessage({ attributes: { x: '<script>alert(1)</script>' } })]);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
