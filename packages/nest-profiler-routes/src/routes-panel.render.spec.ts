import * as path from 'node:path';
import { ClientAssetRegistry, TemplateRendererService } from '@eleven-labs/nest-profiler';
import type { RoutesCollectorData } from './routes.collector';

const ROUTES_PANEL = path.join(__dirname, 'templates', 'routes-panel.ejs');

const SCRIPT = '<script>alert(1)</script>';
const ESCAPED_SCRIPT = '&lt;script&gt;alert(1)&lt;/script&gt;';
const ATTR_BREAKOUT = '"><img src=x onerror=alert(1)>';

function listWith(data: RoutesCollectorData): Record<string, unknown> {
  // Mirrors `expandGlobalPanels`: the view is labelled by the transport it renders.
  const label = data.groups[0]?.label ?? 'HTTP';
  return {
    title: 'Profiles',
    profilerPath: '/_profiler',
    clientScripts: ['profiler.js'],
    profiles: [],
    // One **Discover** view per transport, filed under the Discover sidebar group.
    sectionViews: [{ key: 'http', label: 'HTTP', count: 0 }],
    globalViewGroups: [
      { label: 'Discover', views: [{ key: 'discover-http', label, count: data.entryCount }] },
    ],
    activeView: 'discover-http',
    activeGlobalPanel: {
      name: 'discover-http',
      label,
      groupLabel: 'Discover',
      templatePath: ROUTES_PANEL,
      data,
    },
    heapSeries: [],
    filters: {},
  };
}

function render(service: TemplateRendererService, data: RoutesCollectorData): Promise<string> {
  return service.render('list', listWith(data));
}

describe('routes-panel template', () => {
  let service: TemplateRendererService;

  beforeEach(() => {
    service = new TemplateRendererService(new ClientAssetRegistry());
  });

  it('renders the empty state when there are no routes', async () => {
    const html = await render(service, { groups: [], entryCount: 0 });
    expect(html).toContain('Nothing discovered.');
  });

  it('names the transport it lists, so a short view label stays unambiguous', async () => {
    const html = await render(service, { groups: [], entryCount: 0 });
    expect(html).toContain('Discover');
    expect(html).toContain('HTTP');
  });

  it('counts the entries with the noun the source chose, not always "route"', async () => {
    const html = await render(service, {
      entryCount: 1,
      groups: [
        {
          source: 'command',
          label: 'Commands',
          itemLabel: 'command',
          entries: [
            { method: 'command', path: 'content:sync', controller: 'SyncCommand', handler: 'run' },
          ],
        },
      ],
    });
    expect(html).toContain('1 command');
    expect(html).not.toContain('1 route');
  });

  it('renders routes flat — one transport per view means no disclosure to open first', async () => {
    const html = await render(service, {
      entryCount: 1,
      groups: [
        {
          source: 'http',
          label: 'HTTP',
          entries: [
            {
              method: 'POST',
              path: '/users/:id',
              controller: 'UsersController',
              handler: 'create',
              guards: ['JwtAuthGuard'],
              inputs: {
                params: ['id'],
                query: ['page'],
                headers: ['x-tenant'],
                body: {
                  name: 'CreateUserDto',
                  properties: [
                    { name: 'email', tsType: 'String', rules: ['isEmail'], optional: true },
                  ],
                },
              },
            },
          ],
        },
      ],
    });

    expect(html).toContain('POST');
    expect(html).toContain('/users/:id');
    expect(html).toContain('UsersController');
    expect(html).toContain('CreateUserDto');
    expect(html).toContain('email');
    expect(html).toContain('String');
    expect(html).toContain('isEmail');
    expect(html).toContain('1 route');
    // A guarded route surfaces its guard names and a "Protected by …" lock affordance.
    expect(html).toContain('JwtAuthGuard');
    expect(html).toContain('Protected by JwtAuthGuard');
  });

  it('renders a source-specific input group with its descriptions', async () => {
    const html = await render(service, {
      entryCount: 1,
      groups: [
        {
          source: 'command',
          label: 'Commands',
          entries: [
            {
              method: 'command',
              path: 'content:sync',
              controller: 'SyncArticlesCommand',
              handler: 'run',
              description: 'Fetch articles from an external API',
              inputs: {
                groups: [
                  { label: 'Arguments', items: [{ name: '<source>', required: true }] },
                  {
                    label: 'Options',
                    items: [
                      {
                        name: '-l, --limit <limit>',
                        description: 'Number of articles to fetch',
                        defaultValue: '5',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(html).toContain('Fetch articles from an external API');
    expect(html).toContain('Arguments');
    expect(html).toContain('&lt;source&gt;');
    expect(html).toContain('Options');
    expect(html).toContain('-l, --limit &lt;limit&gt;');
    expect(html).toContain('Number of articles to fetch');
    expect(html).toContain('(default: 5)');
    expect(html).toContain('(required)');
    // Never the HTTP label — a CLI option is not a query param.
    expect(html).not.toContain('Query params');
  });

  it('renders the non-route sections above the entry list, each with its own count', async () => {
    const html = await render(service, {
      entryCount: 1,
      groups: [
        {
          source: 'rabbitmq',
          label: 'RabbitMQ',
          itemLabel: 'handler',
          entries: [
            {
              method: 'subscribe',
              path: 'api-tts.narration',
              controller: 'GenerationWorker',
              handler: 'generateNarration',
              inputs: {
                groups: [
                  {
                    label: 'Subscription',
                    items: [{ name: 'queue', description: 'api-tts.narration' }],
                  },
                ],
              },
            },
          ],
          sections: [
            {
              label: 'Exchanges',
              itemLabel: 'exchange',
              items: [{ name: 'articles.events', kind: 'topic', flags: ['durable'] }],
            },
            {
              label: 'Queues',
              itemLabel: 'queue',
              items: [
                {
                  name: 'api-tts.narration',
                  detail: '\u2190 articles.events (published.*)',
                  attributes: { 'x-dead-letter-exchange': 'tts.dlx' },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(html).toContain('Exchanges');
    expect(html).toContain('1 exchange');
    expect(html).toContain('articles.events');
    expect(html).toContain('topic');
    expect(html).toContain('durable');
    expect(html).toContain('Queues');
    expect(html).toContain('x-dead-letter-exchange');
    expect(html).toContain('tts.dlx');
    // With sections above it, the entry list is titled by what it holds.
    expect(html).toContain('Handlers');
    expect(html).toContain('1 handler');
    expect(html).not.toContain('Nothing discovered.');
  });

  it('renders a topology-only view — a broker the application declares but never consumes', async () => {
    const html = await render(service, {
      entryCount: 0,
      groups: [
        {
          source: 'rabbitmq',
          label: 'RabbitMQ',
          itemLabel: 'handler',
          entries: [],
          sections: [
            {
              label: 'Connections',
              itemLabel: 'connection',
              items: [{ name: 'tts', detail: 'amqp://[REDACTED]@rabbit/api-tts' }],
            },
          ],
        },
      ],
    });

    expect(html).not.toContain('Nothing discovered.');
    expect(html).toContain('Connections');
    expect(html).toContain('1 connection');
    expect(html).toContain('amqp://[REDACTED]@rabbit/api-tts');
  });

  it('HTML-escapes every attacker-influenced field', async () => {
    const html = await render(service, {
      entryCount: 1,
      groups: [
        {
          source: 'http',
          label: `REST${SCRIPT}`,
          sections: [
            {
              label: `Queues${SCRIPT}`,
              itemLabel: `queue${SCRIPT}`,
              items: [
                {
                  name: `q${ATTR_BREAKOUT}`,
                  kind: `k${SCRIPT}`,
                  detail: `d${SCRIPT}`,
                  flags: [`f${SCRIPT}`],
                  attributes: { [`a${SCRIPT}`]: `v${ATTR_BREAKOUT}` },
                },
              ],
            },
          ],
          entries: [
            {
              method: 'GET',
              path: `/evil/${SCRIPT}`,
              controller: `Ctrl${SCRIPT}`,
              handler: `h${SCRIPT}`,
              guards: [`Guard${SCRIPT}`],
              description: `desc${SCRIPT}`,
              inputs: {
                groups: [
                  {
                    label: `Options${SCRIPT}`,
                    items: [
                      {
                        name: `--flag${ATTR_BREAKOUT}`,
                        description: `d${SCRIPT}`,
                        defaultValue: `v${SCRIPT}`,
                      },
                    ],
                  },
                ],
                query: [`q${SCRIPT}`],
                headers: [`x${ATTR_BREAKOUT}`],
                body: {
                  name: `Dto${SCRIPT}`,
                  properties: [
                    { name: `p${SCRIPT}`, tsType: `T${SCRIPT}`, rules: [`r${ATTR_BREAKOUT}`] },
                  ],
                },
              },
            },
          ],
        },
      ],
    });

    expect(html).not.toContain(SCRIPT);
    expect(html).not.toContain('<img src=x onerror=');
    expect(html).not.toContain('"><img');
    expect(html).toContain(ESCAPED_SCRIPT);
  });
});
