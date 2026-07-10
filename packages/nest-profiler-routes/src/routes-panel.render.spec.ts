import * as path from 'node:path';
import { ClientAssetRegistry, TemplateRendererService } from '@eleven-labs/nest-profiler';
import type { RoutesCollectorData } from './routes.collector';

const ROUTES_PANEL = path.join(__dirname, 'templates', 'routes-panel.ejs');

const SCRIPT = '<script>alert(1)</script>';
const ESCAPED_SCRIPT = '&lt;script&gt;alert(1)&lt;/script&gt;';
const ATTR_BREAKOUT = '"><img src=x onerror=alert(1)>';

function listWith(data: RoutesCollectorData): Record<string, unknown> {
  return {
    title: 'Profiles',
    profilerPath: '/_profiler',
    clientScripts: ['profiler.js'],
    profiles: [],
    globalPanels: [{ name: 'routes', label: 'Routes', templatePath: ROUTES_PANEL, data }],
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
    const html = await render(service, { groups: [], routeCount: 0 });
    expect(html).toContain('No routes discovered.');
  });

  it('renders groups, routes and DTO properties', async () => {
    const html = await render(service, {
      routeCount: 1,
      groups: [
        {
          source: 'http',
          label: 'REST',
          routes: [
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

    expect(html).toContain('REST');
    expect(html).toContain('POST');
    expect(html).toContain('/users/:id');
    expect(html).toContain('UsersController');
    expect(html).toContain('CreateUserDto');
    expect(html).toContain('email');
    expect(html).toContain('String');
    expect(html).toContain('isEmail');
    expect(html).toContain('1 routes');
    // A guarded route surfaces its guard names and a "Protected by …" lock affordance.
    expect(html).toContain('JwtAuthGuard');
    expect(html).toContain('Protected by JwtAuthGuard');
  });

  it('HTML-escapes every attacker-influenced field', async () => {
    const html = await render(service, {
      routeCount: 1,
      groups: [
        {
          source: 'http',
          label: `REST${SCRIPT}`,
          routes: [
            {
              method: 'GET',
              path: `/evil/${SCRIPT}`,
              controller: `Ctrl${SCRIPT}`,
              handler: `h${SCRIPT}`,
              guards: [`Guard${SCRIPT}`],
              inputs: {
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
