import * as path from 'node:path';
import { TemplateRendererService } from './template-renderer.service';
import { ClientAssetRegistry } from './client-asset-registry.service';
import { TEMPLATES_DIR } from '../views/template-engine';

/**
 * Render-level XSS regression suite. Every field the profiler renders from captured,
 * attacker-influenced data (exception name/message/stack, log message/context, SQL
 * text/error, timeline phase, list URL/method) is rendered through the real EJS
 * pipeline with a hostile fixture and asserted to be HTML-escaped — the raw payload
 * never survives, its escaped form does, and no `"`-breakout escapes an attribute.
 *
 * Complements the controller e2e test (which covers only the HTTP request/response
 * tab) and the helper unit tests in `template-engine.spec.ts`.
 */

// A classic script-injection payload plus the escaped form EJS must emit for it.
const SCRIPT = '<script>alert(1)</script>';
const ESCAPED_SCRIPT = '&lt;script&gt;alert(1)&lt;/script&gt;';
// An attribute-breakout payload: a `"` that would close an attribute, then markup.
const ATTR_BREAKOUT = '"><img src=x onerror=alert(1)>';

const SQL_PANEL = path.join(TEMPLATES_DIR, '..', 'collectors', 'sql', 'templates', 'sql-panel.ejs');
const TIMELINE_PANEL = path.join(
  TEMPLATES_DIR,
  '..',
  'collectors',
  'timeline',
  'templates',
  'timeline-panel.ejs',
);
const REQUESTS_SECTION = path.join(TEMPLATES_DIR, 'sections', 'requests-section.ejs');

function baseProfile(): Record<string, unknown> {
  return {
    token: 'xss-token-1234567890',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/hello', headers: {}, query: {} } },
    response: { statusCode: 200, headers: {} },
    performance: { startTime: Date.now(), heapUsed: 1024, duration: 12 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

function detailData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Profile',
    profilerPath: '/_profiler',
    clientScripts: ['profiler.js'],
    token: 'xss-token-1234567890',
    activeTab: 'performance',
    summary: { badge: 'GET', badgeClass: 'badge-default', text: '/hello' },
    entrypointTabs: [],
    entrypointTabTemplate: undefined,
    collectorPanels: [],
    collectorData: undefined,
    profile: baseProfile(),
    ...overrides,
  };
}

/** Assert a rendered page neither carries the raw script payload nor an attribute breakout. */
function expectNoRawInjection(html: string): void {
  expect(html).not.toContain(SCRIPT);
  expect(html).not.toContain('<img src=x onerror=');
  expect(html).not.toContain('"><img');
}

describe('template rendering — XSS regression', () => {
  let service: TemplateRendererService;

  beforeEach(() => {
    service = new TemplateRendererService(new ClientAssetRegistry());
  });

  describe('detail — exceptions tab', () => {
    it('escapes a hostile exception name, message and stack', async () => {
      const profile = baseProfile();
      profile.exceptions = [
        {
          name: `Error${SCRIPT}`,
          message: `boom ${SCRIPT}`,
          stack: `at ${SCRIPT}\n  at handler`,
          timestamp: Date.now(),
        },
      ];
      const html = await service.render('detail', detailData({ activeTab: 'exceptions', profile }));

      expectNoRawInjection(html);
      expect(html).toContain(ESCAPED_SCRIPT);
    });

    it('renders realistic exception text as-is (no over-escaping)', async () => {
      const profile = baseProfile();
      profile.exceptions = [
        {
          name: 'TypeError',
          message: 'Cannot read properties of undefined',
          timestamp: Date.now(),
        },
      ];
      const html = await service.render('detail', detailData({ activeTab: 'exceptions', profile }));

      expect(html).toContain('TypeError');
      expect(html).toContain('Cannot read properties of undefined');
    });
  });

  describe('detail — logs tab', () => {
    it('escapes a hostile log message and context', async () => {
      const profile = baseProfile();
      profile.logs = [
        {
          timestamp: Date.now(),
          level: 'error',
          message: `logged ${SCRIPT}`,
          context: `Ctx${SCRIPT}`,
        },
      ];
      const html = await service.render('detail', detailData({ activeTab: 'logs', profile }));

      expectNoRawInjection(html);
      expect(html).toContain(ESCAPED_SCRIPT);
    });
  });

  describe('detail — SQL panel', () => {
    it('escapes hostile SQL text, parameters and error', async () => {
      const html = await service.render(
        'detail',
        detailData({
          activeTab: 'sql',
          collectorPanels: [{ name: 'sql', label: 'SQL', templatePath: SQL_PANEL, badgeValue: 1 }],
          collectorData: [
            {
              type: 'SELECT',
              sql: `SELECT ${SCRIPT} FROM t`,
              parameters: [SCRIPT],
              error: `failed ${SCRIPT}`,
              duration: 5,
              isSlow: false,
              startedAt: Date.now(),
            },
          ],
        }),
      );

      expectNoRawInjection(html);
      expect(html).toContain(ESCAPED_SCRIPT);
    });
  });

  describe('detail — timeline panel', () => {
    it('escapes a hostile span phase in both text and the title attribute', async () => {
      const profile = baseProfile();
      const html = await service.render(
        'detail',
        detailData({
          activeTab: 'timeline',
          profile,
          collectorPanels: [
            { name: 'timeline', label: 'Timeline', templatePath: TIMELINE_PANEL, badgeValue: 1 },
          ],
          collectorData: [
            {
              phase: `controller${ATTR_BREAKOUT}`,
              duration: 5,
              startedAt: (profile.performance as { startTime: number }).startTime,
            },
          ],
        }),
      );

      // Rendered both as text and inside title="<%= span.phase %>" — neither may break out.
      expectNoRawInjection(html);
    });
  });

  describe('list — requests section', () => {
    it('escapes a hostile URL in both the cell text and the title attribute', async () => {
      const profile = baseProfile();
      (profile.entrypoint as { data: { url: string } }).data.url =
        `/search?q=${ATTR_BREAKOUT}${SCRIPT}`;

      const section = {
        key: 'http',
        title: 'HTTP',
        description: undefined,
        isDefault: true,
        total: 1,
        itemLabel: 'request',
        profiles: [profile],
        filterDefs: [],
        filterValues: {},
        filterPrefix: 'http',
        resetHref: '/_profiler',
        defaultCollapsed: false,
        templatePath: REQUESTS_SECTION,
      };

      const html = await service.render('list', {
        title: 'Profiles',
        profilerPath: '/_profiler',
        clientScripts: ['profiler.js'],
        views: [{ key: 'profiling', label: 'Profiling' }],
        activeView: 'profiling',
        globalPanels: [],
        heapSeries: [],
        filters: {},
        sections: [section],
      });

      expectNoRawInjection(html);
      expect(html).toContain(ESCAPED_SCRIPT);
    });
  });
});
