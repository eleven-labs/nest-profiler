import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { TemplateRendererService } from './template-renderer.service';
import { ClientAssetRegistry } from './client-asset-registry.service';
import { TEMPLATES_DIR } from '../views/template-engine';

const MINIMAL_LIST_DATA = {
  title: 'Profiles',
  profilerPath: '/_profiler',
  clientScripts: ['profiler.js', 'http.js'],
  views: [{ key: 'profiling', label: 'Profiling' }],
  activeView: 'profiling',
  profiles: [],
  globalPanels: [],
  heapSeries: [],
  filters: {},
};

const MINIMAL_DETAIL_DATA = {
  title: 'Profile abc12345',
  profilerPath: '/_profiler',
  clientScripts: ['profiler.js', 'http.js'],
  token: 'abc12345678',
  activeTab: 'request',
  summary: { badge: 'GET', badgeClass: 'badge-default', text: '/hello' },
  entrypointTabs: [{ name: 'request', label: 'Request', icon: undefined, badge: 'GET' }],
  entrypointTabTemplate: path.join(TEMPLATES_DIR, 'entrypoints', 'http-request.ejs'),
  collectorPanels: [],
  collectorData: undefined,
  profile: {
    token: 'abc12345678',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/hello', headers: {}, query: {} } },
    response: { statusCode: 200, headers: {} },
    performance: { startTime: Date.now(), heapUsed: 1024 * 1024, duration: 12 },
    logs: [],
    exceptions: [],
    collectors: {},
  },
};

describe('TemplateRendererService', () => {
  let service: TemplateRendererService;

  beforeEach(() => {
    service = new TemplateRendererService(new ClientAssetRegistry());
  });

  it('renders the built-in list template', async () => {
    const html = await service.render('list', MINIMAL_LIST_DATA);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Recent Profiles');
  });

  it('renders the Summary view with a populated summary', async () => {
    const t0 = 1_000_000;
    const summary = {
      sampled: 42,
      duration: { avg: 87, p50: 40, p95: 300, p99: 900 },
      errors: { count: 3, rate: 3 / 42 },
      byMethod: { GET: 30, POST: 12 },
      byStatusClass: { '2xx': 38, '3xx': 0, '4xx': 3, '5xx': 1 },
      issues: { slow: 4, 'n-plus-one': 2 },
      topSlowEndpoints: [
        { method: 'GET', badge: 'GET', path: '/api/slow', calls: 5, avg: 300 },
        { badge: 'CLI', path: 'demo:greet', calls: 2, avg: 12 },
      ],
      recentErrors: [
        { token: 'abc12345', method: 'GET', badge: 'GET', path: '/api/x', statusCode: 500, at: t0 },
        { token: 'def67890', badge: 'CLI', path: 'demo:greet --fail', at: t0 - 1000 },
      ],
      byType: { http: 40, command: 2 },
      timeline: [
        { startedAt: t0 - 1000, count: 15, errorCount: 0, p95: 40 }, // fast → green
        { startedAt: t0, count: 20, errorCount: 1, p95: 120 },
        { startedAt: t0 + 1000, count: 22, errorCount: 2, p95: 640 },
      ],
      issueEndpoints: {
        slow: [{ method: 'GET', badge: 'GET', path: '/api/slow', count: 4, token: 'tok-slow-1' }],
        'n-plus-one': [
          { method: 'GET', badge: 'GET', path: '/api/slow', count: 2, token: 'tok-np-1' },
        ],
      },
      heap: {
        current: 64 * 1024 * 1024,
        min: 40 * 1024 * 1024,
        max: 70 * 1024 * 1024,
        trend: 'growing',
        series: [40, 48, 55, 60, 64].map((mb) => mb * 1024 * 1024),
      },
    };
    const html = await service.render('list', {
      ...MINIMAL_LIST_DATA,
      views: [
        { key: 'summary', label: 'Summary' },
        { key: 'profiling', label: 'Profiling' },
      ],
      activeView: 'summary',
      summary,
      domainSections: [
        {
          name: 'cache',
          label: 'Cache',
          tiles: [
            { label: 'Hit rate', value: '92%' },
            { label: 'Misses', value: '8' },
          ],
        },
        {
          name: 'database',
          label: 'Database',
          tiles: [{ label: 'Queries', value: '12' }],
          templatePath: path.join(__dirname, '../collectors/templates/query-summary.ejs'),
          data: {
            highlight: true,
            tab: 'database',
            subtab: 'typeorm',
            entries: [
              {
                label: 'SELECT * FROM a_very_long_table_name WHERE id = 1',
                duration: 42,
                token: 'tok-query-1',
              },
            ],
          },
        },
      ],
    });

    expect(html).toContain('Error rate');
    expect(html).toContain('Hit rate'); // collector-contributed domain tile
    expect(html).toContain('92%');
    // Collector custom table (SQL slowest-queries) rendered via its templatePath, with a
    // wrapping query column so long SQL never overflows the responsive table.
    expect(html).toContain('slowest queries');
    expect(html).toContain('a_very_long_table_name');
    expect(html).toContain('whitespace-pre-wrap break-words');
    expect(html).toContain('/_profiler/tok-query-1'); // query row links to its profile
    expect(html).toContain('Throughput'); // time-series chart
    expect(html).toContain('bg-success/70'); // a fast bucket uses the green (not the nest-red)
    expect(html).toContain('By kind'); // entrypoint-kind distribution
    expect(html).toContain('Performance issues'); // per-issue endpoint tables
    expect(html).toContain('n-plus-one'); // an issue id with its affected endpoints
    expect(html).toContain('/_profiler/tok-np-1'); // issue row links to a representative profile
    expect(html).toContain('Process heap'); // heap trend chart
    expect(html).toContain('demo:greet'); // non-HTTP endpoint label
    expect(html).toContain('/_profiler/summary.json'); // JSON export link
    // Drill-through into the detail page for a recent error.
    expect(html).toContain('/_profiler/abc12345');
  });

  it('renders every section as a <details> disclosure and folds only defaultCollapsed ones', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tpl-section-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'rows.ejs'), '<tbody data-rows></tbody>');
      service.registerDir(dir);
      const rowsPath = path.join(dir, 'rows.ejs');

      const baseSection = {
        title: 'HTTP',
        description: undefined,
        itemLabel: 'profile',
        isDefault: true,
        total: 0,
        profiles: [],
        filterDefs: [],
        filterValues: {},
        filterPrefix: 'http',
        resetHref: '/_profiler',
        templatePath: rowsPath,
      };

      const html = await service.render('list', {
        ...MINIMAL_LIST_DATA,
        sections: [
          { ...baseSection, key: 'http', defaultCollapsed: false },
          {
            ...baseSection,
            key: 'cmd',
            title: 'Commands',
            isDefault: false,
            total: 2,
            defaultCollapsed: true,
          },
        ],
      });

      expect(html).toContain('Commands');
      // Every section is a disclosure: two sections → two <details>/<summary>.
      expect(html.match(/<details/g)).toHaveLength(2);
      expect(html.match(/<summary/g)).toHaveLength(2);
      // Expanded by default, except the defaultCollapsed: true section → exactly one `open`.
      expect(html.match(/<details[^>]*\sopen>/g)).toHaveLength(1);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('renders the built-in detail template', async () => {
    const html = await service.render('detail', MINIMAL_DETAIL_DATA);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('threads security.linkQuery onto the JSON export and navigation links', async () => {
    const link = (href: string): string => `${href}${href.includes('?') ? '&' : '?'}token=x`;
    const html = await service.render('detail', { ...MINIMAL_DETAIL_DATA, link });
    // The `/data` export download carries the credential (the historical 401 fix)…
    expect(html).toContain('/_profiler/abc12345678/data?token=x');
    // …and so do the breadcrumb/nav links back to the list.
    expect(html).toContain('href="/_profiler?token=x"');
  });

  it('references local same-origin assets instead of external CDNs', async () => {
    const html = await service.render('list', MINIMAL_LIST_DATA);

    // No third-party CDN is loaded — everything is served from the profiler itself.
    expect(html).not.toMatch(/https:\/\/cdn\.jsdelivr\.net|https:\/\/cdnjs\.cloudflare\.com/);
    expect(html).not.toMatch(/<script[^>]+https:\/\//);
    expect(html).not.toMatch(/<link[^>]+https:\/\//);

    // Local, build-time assets served under the configured profiler path.
    expect(html).toContain('/_profiler/__assets/styles/profiler.css');
    expect(html).toContain('/_profiler/__assets/styles/github.min.css');
    expect(html).toContain('/_profiler/__assets/styles/github-dark.min.css');
    expect(html).toContain('/_profiler/__assets/scripts/highlight.min.js');
    expect(html).toContain('/_profiler/__assets/scripts/graphql.min.js');
    // The compiled client bundles (core first, then registered extensions) are emitted.
    expect(html).toContain('/_profiler/__assets/scripts/profiler.js');
    expect(html).toContain('/_profiler/__assets/scripts/http.js');
  });

  it('carries no inline JavaScript — all behaviour lives in compiled bundles', async () => {
    const list = await service.render('list', MINIMAL_LIST_DATA);
    const detail = await service.render('detail', MINIMAL_DETAIL_DATA);

    for (const html of [list, detail]) {
      // No inline event handlers…
      expect(html).not.toMatch(/\son\w+=/);
      // …and every <script> is an external reference (has a src=), never an inline block.
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    }
  });

  it('throws when template name does not exist', async () => {
    await expect(service.render('does-not-exist', {})).rejects.toThrow(
      'Template "does-not-exist" not found',
    );
  });

  it('registerDir makes templates in that directory resolvable', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tpl-test-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'hello.ejs'), '<p>hello world</p>');
      service.registerDir(dir);
      const html = await service.render('hello', {});
      expect(html).toBe('<p>hello world</p>');
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('registerDir is idempotent — same directory registered twice does not duplicate', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tpl-dedup-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'tpl.ejs'), 'ok');
      service.registerDir(dir);
      service.registerDir(dir);

      // Both registrations resolve to the same template — no duplicate error
      const html = await service.render('tpl', {});
      expect(html).toBe('ok');
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('template in registered dir takes precedence over built-in of same name when registered first', async () => {
    // registerDir APPENDS — so a second dir can only shadow a name that the first dirs don't have.
    // This test ensures custom templates in user-registered dirs are found.
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tpl-custom-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'custom-panel.ejs'), '<custom/>');
      service.registerDir(dir);
      const html = await service.render('custom-panel', {});
      expect(html).toBe('<custom/>');
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});
