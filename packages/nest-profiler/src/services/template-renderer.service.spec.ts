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
    traceId: 'trace-test',
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

  it('leads with the page title, with no process-wide strip above it', async () => {
    // The heap trend used to sit here. It sampled once per profiled request — an axis made of
    // traffic rather than time — and the Runtime view supersedes it with a fixed interval, rss,
    // heap pressure, CPU, loop lag and GC. It occupied the top of every list for data belonging
    // to none of them.
    const html = await service.render('list', {
      ...MINIMAL_LIST_DATA,
      activeView: 'config',
      activeGlobalPanel: { name: 'config', label: 'Config', data: {} },
    });
    expect(html).not.toContain('Process heap');
    expect(html).toContain('Recent Profiles');
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

  it('renders the trace waterfall on the performance tab, nested and deep-linkable', async () => {
    const startTime = Date.now();
    const html = await service.render('detail', {
      ...MINIMAL_DETAIL_DATA,
      activeTab: 'performance',
      profile: {
        ...MINIMAL_DETAIL_DATA.profile,
        performance: { startTime, heapUsed: 1024, duration: 50 },
        trace: [
          {
            id: 'root',
            kind: 'entrypoint',
            label: 'GET /hello',
            startedAt: startTime,
            duration: 50,
          },
          {
            id: 's1',
            parentId: 'root',
            kind: 'custom',
            label: 'reviews.load',
            startedAt: startTime + 5,
            duration: 30,
          },
          {
            id: 's2',
            parentId: 's1',
            kind: 'db',
            label: 'SELECT * FROM reviews',
            startedAt: startTime + 10,
            duration: 20,
            source: { collector: 'typeorm', index: 0, tab: 'database' },
          },
          {
            id: 'lc1',
            kind: 'phase',
            lane: 'lifecycle',
            label: 'guards',
            startedAt: startTime + 1,
            duration: 3,
          },
        ],
      },
    });

    // The three lanes of the panel: the band, the causal rows, and the detail table.
    expect(html).toContain('Request Lifecycle');
    expect(html).toContain('Execution Trace');
    // A row carries its parent link, which is what the client behaviour folds on.
    expect(html).toContain('data-trace-node="s2"');
    expect(html).toContain('data-trace-parent="s1"');
    // A span with a `source` deep-links into the panel holding its detail.
    expect(html).toContain('tab=database');
    expect(html).toContain('subtab=typeorm');
    // The lifecycle phase is drawn in the band, never as a parent in the causal tree.
    expect(html).not.toContain('data-trace-node="lc1"');
  });

  it('offers the lens only when the trace carries method spans, and tags each row by kind', async () => {
    const startTime = Date.now();
    const withMethods = await service.render('detail', {
      ...MINIMAL_DETAIL_DATA,
      activeTab: 'performance',
      profile: {
        ...MINIMAL_DETAIL_DATA.profile,
        performance: { startTime, heapUsed: 1024, duration: 50 },
        trace: [
          { id: 'root', kind: 'entrypoint', label: 'GET /x', startedAt: startTime, duration: 50 },
          {
            id: 'm1',
            parentId: 'root',
            kind: 'method',
            label: 'ProductService.create',
            startedAt: startTime + 1,
            duration: 40,
          },
          {
            id: 'q1',
            parentId: 'm1',
            kind: 'db',
            label: 'INSERT INTO products',
            startedAt: startTime + 5,
            duration: 30,
          },
        ],
      },
    });

    // The table under the bars carries the same id and kind, so the lens and the folds reach it —
    // otherwise "I/O only" hides the method bars and still lists every one of them below.
    // The two controls that read the same tree at a different density, and the data they need.
    expect(withMethods).toContain('data-trace-critical');
    expect(withMethods).toContain('data-trace-min');
    expect(withMethods).toContain('data-trace-duration="40"');
    // The critical path is the chain that finishes last, marked server-side where the tree exists.
    expect(withMethods).toContain('data-trace-critical-node');
    expect(withMethods).toContain('data-trace-row="m1"');
    expect(withMethods).toContain('data-trace-row="q1"');
    expect(withMethods).toContain('data-trace-lens="io"');
    expect(withMethods).toContain('data-trace-lens="code"');
    // The client filters on this, so a row that carries no kind could never be hidden.
    expect(withMethods).toContain('data-trace-kind="method"');
    expect(withMethods).toContain('data-trace-kind="db"');

    // Without a single method span the lens would only ever hide nothing, so it is not drawn.
    const withoutMethods = await service.render('detail', {
      ...MINIMAL_DETAIL_DATA,
      activeTab: 'performance',
      profile: {
        ...MINIMAL_DETAIL_DATA.profile,
        performance: { startTime, heapUsed: 1024, duration: 50 },
        trace: [
          { id: 'root', kind: 'entrypoint', label: 'GET /x', startedAt: startTime, duration: 50 },
        ],
      },
    });
    expect(withoutMethods).not.toContain('data-trace-lens');
    // The threshold and the critical path apply to any trace, so they are not gated on methods.
    expect(withoutMethods).toContain('data-trace-min');
    expect(withoutMethods).toContain('data-trace-critical');
  });

  it('preselects the host default in the Hide under control', async () => {
    const startTime = Date.now();
    const html = await service.render('detail', {
      ...MINIMAL_DETAIL_DATA,
      activeTab: 'performance',
      minDuration: 0.5,
      profile: {
        ...MINIMAL_DETAIL_DATA.profile,
        performance: { startTime, heapUsed: 1024, duration: 50 },
        trace: [
          { id: 'root', kind: 'entrypoint', label: 'GET /x', startedAt: startTime, duration: 50 },
        ],
      },
    });

    expect(html).toContain('value="0.5" selected');
  });

  it('renders an empty-trace hint pointing at the API that fills it', async () => {
    const html = await service.render('detail', {
      ...MINIMAL_DETAIL_DATA,
      activeTab: 'performance',
      profile: {
        ...MINIMAL_DETAIL_DATA.profile,
        trace: [
          {
            id: 'lc1',
            kind: 'phase',
            lane: 'lifecycle',
            label: 'guards',
            startedAt: Date.now(),
            duration: 1,
          },
        ],
      },
    });

    expect(html).toContain('No spans recorded');
    expect(html).toContain("tracer.span('name', work)");
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
          trace: [
            {
              id: 'root',
              kind: 'entrypoint',
              label: 'GET /hello',
              startedAt: startTime,
              duration: 40,
            },
            {
              id: 's1',
              parentId: 'root',
              kind: 'custom',
              label: 'controller',
              startedAt: startTime,
              duration: 30,
            },
          ],
        },
      });
      expect(html).toContain('>40ms<');
      expect(html).toContain('Execution Trace');
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

  describe('detail — Exceptions tab', () => {
    const APP_FRAME = {
      file: 'src/catalog/application/product.service.ts',
      absoluteFile: '/app/src/catalog/application/product.service.ts',
      line: 49,
      column: 21,
      function: 'ProductService.create',
      isAsync: true,
      isApplication: true,
      lines: [
        { number: 48, code: 'const a = 1;', isFaultLine: false },
        { number: 49, code: 'throw new Error("boom");', isFaultLine: true },
        { number: 50, code: 'const b = 2;', isFaultLine: false },
      ],
    };
    const VENDOR_FRAME = {
      file: 'typeorm/query-builder/InsertQueryBuilder.js',
      line: 166,
      function: 'InsertQueryBuilder.execute',
      isApplication: false,
    };

    const renderException = (
      exception: Record<string, unknown>,
      overrides: Record<string, unknown> = {},
    ): Promise<string> =>
      service.render('detail', {
        ...MINIMAL_DETAIL_DATA,
        activeTab: 'exceptions',
        entrypointTabTemplate: undefined,
        profile: { ...MINIMAL_DETAIL_DATA.profile, exceptions: [exception], ...overrides },
      });

    const anException = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      name: 'QueryFailedError',
      message: 'null value in column "price" violates not-null constraint',
      stack: 'QueryFailedError: null value\n    at x (/app/src/foo.ts:10:5)',
      timestamp: Date.now(),
      ...extra,
    });

    it('leads with the throw site, its excerpt and the faulty line', async () => {
      const html = await renderException(anException({ frames: [APP_FRAME] }));

      expect(html).toContain('Thrown at');
      expect(html).toContain('ProductService.create');
      expect(html).toContain('>async<');
      expect(html).toContain('src/catalog/application/product.service.ts:49:21');
      expect(html).toContain('throw new Error(&#34;boom&#34;);');
      // The faulty line carries the danger background and a caret under its column.
      expect(html).toContain('bg-danger-bg');
      expect(html).toContain('language-typescript');
    });

    it('collapses the dependency and Node-internal frames behind one count', async () => {
      const html = await renderException(
        anException({ frames: [APP_FRAME, VENDOR_FRAME, { ...VENDOR_FRAME, line: 200 }] }),
      );

      expect(html).toContain('2 frames in dependencies and Node internals');
      expect(html).toContain('typeorm/query-builder/InsertQueryBuilder.js:166');
    });

    it('groups the remaining application frames behind their own disclosure', async () => {
      const html = await renderException(
        anException({ frames: [APP_FRAME, { ...APP_FRAME, line: 12, lines: undefined }] }),
      );

      expect(html).toContain('1 more application frame');
    });

    it('names the framework throw site on one line when no frame is the application', async () => {
      // A DTO rejected by a pipe throws entirely inside the framework: promoting one of those
      // frames to "Thrown at" would emphasise the one line the reader cannot act on.
      const html = await renderException(anException({ frames: [VENDOR_FRAME] }));

      expect(html).not.toContain('Thrown at');
      expect(html).toContain('thrown inside');
      expect(html).toContain('InsertQueryBuilder.execute');
      expect(html).toContain('none of the frames are yours');
    });

    it('drops the generic class message when the payload says more', async () => {
      const html = await renderException(
        anException({
          name: 'BadRequestException',
          message: 'Bad Request Exception',
          details: { statusCode: 400, message: ['name should not be empty'] },
        }),
      );

      expect(html).toContain('name should not be empty');
      expect(html).not.toContain('Bad Request Exception');
    });

    it('lists the field errors an HttpException payload carries', async () => {
      const html = await renderException(
        anException({
          name: 'BadRequestException',
          message: 'Bad Request Exception',
          frames: [VENDOR_FRAME],
          details: {
            statusCode: 400,
            error: 'Bad Request',
            message: ['name should not be empty', 'price must not be less than 0'],
          },
        }),
      );

      expect(html).toContain('name should not be empty');
      expect(html).toContain('price must not be less than 0');
      // `statusCode` and `error` add nothing: the status is the profile's, `error` the class name.
      expect(html).not.toContain('Response payload');
    });

    it('renders whatever a payload carries beyond its message', async () => {
      const html = await renderException(
        anException({ details: { statusCode: 409, message: 'Conflict', conflictingId: 42 } }),
      );

      expect(html).toContain('Response payload');
      expect(html).toContain('conflictingId');
    });

    it('does not repeat a payload message that is already the exception message', async () => {
      const html = await renderException(
        anException({
          message: 'Product #9 not found',
          details: { message: 'Product #9 not found' },
        }),
      );

      expect(html.match(/Product #9 not found/g)).toHaveLength(1);
    });

    it('names the handler the exception came out of', async () => {
      const html = await renderException(anException({ frames: [APP_FRAME] }), {
        route: {
          controller: 'ProductController',
          handler: 'create',
          path: '/products',
          method: 'POST',
        },
      });

      expect(html).toContain('thrown in');
      expect(html).toContain('ProductController.create');
    });

    it('renders a handled exception as caught rather than as a failure', async () => {
      const html = await renderException(anException({ frames: [APP_FRAME], handled: true }), {
        route: {
          controller: 'ProductController',
          handler: 'create',
          path: '/products',
          method: 'POST',
        },
      });

      expect(html).toContain('Handled');
      expect(html).toContain('caught in');
      expect(html).not.toContain('bg-danger-bg border-danger-line');
    });

    it('renders the frames of a cause as well as of the primary exception', async () => {
      const html = await renderException(
        anException({
          frames: [APP_FRAME],
          cause: {
            name: 'Error',
            message: 'inner',
            stack: 'Error: inner',
            timestamp: Date.now(),
            frames: [
              {
                file: 'src/bar.ts',
                line: 3,
                isApplication: true,
                lines: [{ number: 3, code: 'fail();', isFaultLine: true }],
              },
            ],
          },
        }),
      );

      expect(html).toContain('Caused by');
      expect(html).toContain('src/bar.ts:3');
      expect(html).toContain('fail();');
    });

    it('falls back to the raw stack when no frame could be parsed out of it', async () => {
      const html = await renderException(anException({ stack: 'QueryFailedError: null value' }));

      expect(html).toContain('QueryFailedError: null value');
    });

    it('renders a source location as plain text when no editor is configured', async () => {
      const html = await renderException(anException({ frames: [APP_FRAME] }));

      expect(html).not.toContain('vscode://');
    });

    it('links a source location to the configured editor', async () => {
      const withEditor = new TemplateRendererService(new ClientAssetRegistry(), {
        editor: 'vscode',
      });
      const html = await withEditor.render('detail', {
        ...MINIMAL_DETAIL_DATA,
        activeTab: 'exceptions',
        entrypointTabTemplate: undefined,
        profile: {
          ...MINIMAL_DETAIL_DATA.profile,
          exceptions: [anException({ frames: [APP_FRAME] })],
        },
      });

      expect(html).toContain('vscode://file//app/src/catalog/application/product.service.ts:49');
    });

    it('warns and renders plain text when the editor name is unknown', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        new TemplateRendererService(new ClientAssetRegistry(), { editor: 'notepad' });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown editor "notepad"'));
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('shows the configured version next to the token badge', async () => {
    const html = await service.render('detail', {
      ...MINIMAL_DETAIL_DATA,
      profile: { ...MINIMAL_DETAIL_DATA.profile, version: '1.2.3' },
    });
    expect(html).toContain('1.2.3');
  });

  it('shows no version badge when the profile carries none', async () => {
    const html = await service.render('detail', MINIMAL_DETAIL_DATA);
    expect(html).not.toContain('Build/release version');
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
