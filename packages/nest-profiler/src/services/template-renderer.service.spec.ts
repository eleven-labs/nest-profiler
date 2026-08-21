import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { Logger } from '@nestjs/common';
import { TemplateRendererService } from './template-renderer.service';
import { ClientAssetRegistry } from './client-asset-registry.service';
import { TEMPLATES_DIR } from '../views/template-engine';

const MINIMAL_LIST_DATA = {
  title: 'Profiles',
  profilerPath: '/_profiler',
  clientScripts: ['profiler.js', 'http.js'],
  profiles: [],
  sectionViews: [{ key: 'http', label: 'HTTP' }],
  globalViewGroups: [],
  activeView: 'http',
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

  it('renders the active list section as its own page with a filter bar and rows', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tpl-section-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'rows.ejs'), '<tbody data-rows></tbody>');
      service.registerDir(dir);
      const rowsPath = path.join(dir, 'rows.ejs');

      const html = await service.render('list', {
        ...MINIMAL_LIST_DATA,
        sectionViews: [
          { key: 'http', label: 'HTTP' },
          { key: 'cmd', label: 'Commands' },
        ],
        activeView: 'cmd',
        activeSection: {
          key: 'cmd',
          title: 'Commands',
          description: undefined,
          itemLabel: 'command',
          isDefault: false,
          total: 2,
          profiles: [],
          filterDefs: [{ key: 'q', label: 'Search', control: 'text' }],
          filterValues: {},
          filterPrefix: 'cmd',
          resetHref: '/_profiler?view=cmd',
          templatePath: rowsPath,
        },
      });

      // The sidebar lists both sections under Profiling; the active one renders as a page.
      expect(html).toContain('>Profiling<');
      expect(html).toContain('>HTTP<');
      expect(html).toContain('Commands');
      // Its filter bar keeps the active view on submit, and the rows partial is included.
      expect(html).toContain('name="view" value="cmd"');
      expect(html).toContain('data-rows');
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('puts the process-heap trend above the page title, whatever the active view', async () => {
    // It is process-wide data: on a global panel view too, and never nested under a list.
    const html = await service.render('list', {
      ...MINIMAL_LIST_DATA,
      activeView: 'config',
      activeGlobalPanel: { name: 'config', label: 'Config', data: {} },
      heapSeries: [1024 * 1024, 2 * 1024 * 1024, 3 * 1024 * 1024],
    });
    expect(html).toContain('Process heap');
    expect(html.indexOf('Process heap')).toBeLessThan(html.indexOf('Recent Profiles'));
  });

  it('renders a sidebar item with the same padding and icon slot as the detail page', async () => {
    const [list, detail] = await Promise.all([
      service.render('list', {
        ...MINIMAL_LIST_DATA,
        sectionViews: [{ key: 'http', label: 'HTTP', icon: '<svg id="globe"/>', count: 3 }],
      }),
      service.render('detail', MINIMAL_DETAIL_DATA),
    ]);

    // The nav item's own classes, shared by both sidebars — never the old pl-6 indent.
    const item =
      'flex items-center gap-2.5 pl-3 pr-3 py-2 text-xs font-medium transition-colors border-l-2';
    expect(list).toContain(item);
    expect(detail).toContain(item);
    expect(list).not.toContain('pl-6');
    // A fixed-width icon slot on both sides, so a view with no icon keeps its label aligned.
    expect(list).toContain('<span class="w-3.5 h-3.5 shrink-0"><svg id="globe"/></span>');
    expect(detail).toContain('w-3.5 h-3.5 shrink-0');
  });

  it('keeps the label aligned for a section that registered no icon', async () => {
    const html = await service.render('list', {
      ...MINIMAL_LIST_DATA,
      sectionViews: [{ key: 'custom', label: 'Custom', count: 0 }],
    });
    // The empty slot still occupies its 3.5 units, so a mixed sidebar has one text column.
    expect(html).toContain('<span class="w-3.5 h-3.5 shrink-0"></span>');
  });

  it('accents the count badge of the active view, like the detail page does', async () => {
    const html = await service.render('list', {
      ...MINIMAL_LIST_DATA,
      activeView: 'http',
      sectionViews: [
        { key: 'http', label: 'HTTP', count: 3 },
        { key: 'graphql', label: 'GraphQL', count: 1 },
      ],
    });
    expect(html).toContain('bg-nest/10 text-nest border-nest/20');
    expect(html).toContain('bg-surface-muted text-foreground-muted border-line');
  });

  it('groups the global sidebar views under their heading and keeps ungrouped ones flat', async () => {
    const html = await service.render('list', {
      ...MINIMAL_LIST_DATA,
      globalViewGroups: [
        {
          label: 'Discover',
          views: [
            { key: 'discover-http', label: 'HTTP', count: 4 },
            { key: 'discover-graphql', label: 'GraphQL', count: 2 },
          ],
        },
        { views: [{ key: 'config', label: 'Config', count: 12 }] },
      ],
    });
    expect(html).toContain('>Discover<');
    expect(html).toContain('?view=discover-graphql');
    expect(html).toContain('?view=config');
  });

  it('names the group of a grouped global panel, so a short label stays unambiguous', async () => {
    const html = await service.render('list', {
      ...MINIMAL_LIST_DATA,
      activeView: 'typeorm-schema',
      activeGlobalPanel: {
        name: 'typeorm-schema',
        label: 'TypeORM',
        groupLabel: 'Schemas',
        data: {},
      },
    });
    expect(html).toContain('Schemas');
    expect(html).toContain('TypeORM');
  });

  it('renders the built-in detail template', async () => {
    const html = await service.render('detail', MINIMAL_DETAIL_DATA);
    expect(html).toContain('<!DOCTYPE html>');
  });

  describe('detail — Performance tab', () => {
    it('badges the tab with the total duration and shows the recorded spans', async () => {
      const startTime = Date.now();
      const html = await service.render('detail', {
        ...MINIMAL_DETAIL_DATA,
        activeTab: 'performance',
        entrypointTabTemplate: undefined,
        profile: {
          ...MINIMAL_DETAIL_DATA.profile,
          performance: { startTime, heapUsed: 1024, duration: 40 },
          spans: [{ phase: 'controller', startedAt: startTime, duration: 30 }],
        },
      });
      expect(html).toContain('>40ms<');
      expect(html).toContain('Execution timeline');
      expect(html).toContain('controller');
    });

    it('omits the timeline entirely when no span was recorded', async () => {
      const html = await service.render('detail', {
        ...MINIMAL_DETAIL_DATA,
        activeTab: 'performance',
        entrypointTabTemplate: undefined,
      });
      expect(html).toContain('Timestamps');
      expect(html).not.toContain('Execution timeline');
      // The removed empty state: an uninstrumented app is not told what it is not missing.
      expect(html).not.toContain('No spans recorded');
    });
  });

  it('colours a slow query by its tag severity, not a hardcoded red', async () => {
    service.registerDir(path.join(TEMPLATES_DIR, '..', 'collectors', 'sql', 'templates'));
    const query = (severity: 'warning' | 'danger') => ({
      type: 'SELECT',
      sql: 'SELECT 1',
      duration: 250,
      startedAt: Date.now(),
      tags: [{ id: 'slow', label: 'Slow', severity }],
    });

    // Default severity (warning) → amber, never the old hardcoded red.
    const warn = await service.render('sql-panel', { data: [query('warning')] });
    expect(warn).toContain('text-warning');
    expect(warn).not.toContain('text-danger');

    // Overridden to danger → the duration/count follow it and turn red.
    const danger = await service.render('sql-panel', { data: [query('danger')] });
    expect(danger).toContain('text-danger');
    expect(danger).not.toContain('text-warning');
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

  describe('display timezone', () => {
    // 2026-07-01T22:30:15.250Z — 00:30 the next day in Europe/Paris (the pinned host zone),
    // 07:30 in Asia/Tokyo.
    const startedAt = Date.UTC(2026, 6, 1, 22, 30, 15, 250);

    const renderSqlPanel = (renderer: TemplateRendererService): Promise<string> => {
      renderer.registerDir(path.join(TEMPLATES_DIR, '..', 'collectors', 'sql', 'templates'));
      return renderer.render('sql-panel', {
        data: [{ type: 'SELECT', sql: 'SELECT 1', duration: 5, startedAt }],
      });
    };

    it('renders timestamps in the host timezone when no timezone is configured', async () => {
      await expect(renderSqlPanel(service)).resolves.toContain('00:30:15.250');
    });

    it('renders timestamps in the configured timezone', async () => {
      const tokyo = new TemplateRendererService(new ClientAssetRegistry(), {
        timezone: 'Asia/Tokyo',
      });
      await expect(renderSqlPanel(tokyo)).resolves.toContain('07:30:15.250');
    });

    it('labels the effective timezone in the dashboard header', async () => {
      const tokyo = new TemplateRendererService(new ClientAssetRegistry(), {
        timezone: 'Asia/Tokyo',
      });
      const html = await tokyo.render('list', MINIMAL_LIST_DATA);
      expect(html).toContain('Times in');
      expect(html).toContain('Asia/Tokyo');

      // With nothing configured the header still tells which zone the times are in.
      await expect(service.render('list', MINIMAL_LIST_DATA)).resolves.toContain('Europe/Paris');
    });

    it('renders without a header label when the runtime cannot name the host zone', async () => {
      // `TZ=` / `TZ=:/etc/localtime`: the runtime keeps a working offset but no zone name, and
      // feeding that name back to `Intl` would throw — the renderer must survive it.
      const spy = jest
        .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
        .mockReturnValue({ timeZone: 'Etc/Unknown' } as Intl.ResolvedDateTimeFormatOptions);
      try {
        const nameless = new TemplateRendererService(new ClientAssetRegistry());
        const html = await nameless.render('list', MINIMAL_LIST_DATA);
        expect(html).not.toContain('Times in');
        // Timestamps still render, on the runtime's own offset.
        await expect(renderSqlPanel(nameless)).resolves.toMatch(/\d{2}:\d{2}:\d{2}\.250/);
      } finally {
        spy.mockRestore();
      }
    });

    it('warns and falls back to the host timezone when the name is unknown', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const bogus = new TemplateRendererService(new ClientAssetRegistry(), {
          timezone: 'Middle/Earth',
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Middle/Earth'));
        await expect(renderSqlPanel(bogus)).resolves.toContain('00:30:15.250');
      } finally {
        warn.mockRestore();
      }
    });
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
