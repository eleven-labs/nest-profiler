import { ProfilerController } from './profiler.controller';
import type { ProfilerCoreService } from '../services/profiler-core.service';
import type { TemplateRendererService } from '../services/template-renderer.service';
import type { ClientAssetRegistry } from '../services/client-asset-registry.service';
import type { SummaryService } from '../services/summary.service';
import type { ProfilerEntrypointType } from '../entrypoints/profiler-entrypoint-type.interface';
import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerQuery } from '../storage/profiler-query';
import { applyQueryInMemory, distinctInMemory } from '../storage/profiler-query';
import type { PlatformRequest } from '../types/http';

/** Minimal platform request for the `@Req()` param of the controller handlers. */
function mockReq(overrides: Partial<PlatformRequest> = {}): PlatformRequest {
  return { headers: {}, query: {}, ...overrides } as unknown as PlatformRequest;
}

function makeProfile(token = 'tok-123456789', createdAt = Date.now()): Profile {
  return {
    token,
    createdAt,
    entrypoint: { type: 'tabless', data: {} },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

/** Entrypoint type with no detail tabs, exercising the "performance" tab fallback. */
const TABLESS_TYPE: ProfilerEntrypointType = {
  type: 'tabless',
  label: 'Tabless',
  listSection: { title: 'Tabless', templatePath: '/tmp/tabless.ejs' },
  detailTabs: [],
  summary: () => ({ badge: 'T', text: 'tabless' }),
};

type RenderArgs = { template: string; ctx: Record<string, unknown> };

/**
 * A realistic in-memory fake of `ProfilerStorageService` backed by an array, so the
 * controller exercises the true query/pagination path (via {@link applyQueryInMemory}).
 */
function fakeStorage(profiles: Profile[]) {
  return {
    findAll: jest.fn().mockResolvedValue(profiles),
    findOne: jest.fn().mockResolvedValue(profiles[0] ?? makeProfile()),
    query: jest.fn((query: ProfilerQuery) => applyQueryInMemory(profiles, query)),
    distinct: jest.fn((field: string, typeIn?: string[]) =>
      distinctInMemory(profiles, field, undefined, typeIn),
    ),
  };
}

function setup(
  options: {
    listPageSize?: number;
    profiles?: Profile[];
    security?: { linkQuery?: (request: PlatformRequest) => string };
  } = {},
): {
  controller: ProfilerController;
  rendered: RenderArgs[];
  core: jest.Mocked<Pick<ProfilerCoreService, never>> & Record<string, unknown>;
  summary: { getSummary: jest.Mock };
} {
  const rendered: RenderArgs[] = [];
  const renderer = {
    render: (template: string, ctx: Record<string, unknown>) => {
      rendered.push({ template, ctx });
      return 'html';
    },
  } as unknown as TemplateRendererService;

  const core = {
    storage: fakeStorage(options.profiles ?? []),
    collectorRegistry: {
      buildGlobalPanels: jest.fn().mockResolvedValue([]),
      listGlobalPanelDescriptors: jest.fn().mockReturnValue([]),
      buildGlobalPanel: jest.fn().mockResolvedValue(undefined),
      buildPanels: jest.fn().mockReturnValue([]),
    },
    getListFilters: jest.fn().mockReturnValue([]),
    getListSections: jest
      .fn()
      .mockReturnValue([
        { key: 'http', title: 'HTTP', isDefault: true, templatePath: '/tmp/http.ejs' },
      ]),
    getEntrypointType: jest.fn().mockReturnValue(TABLESS_TYPE),
  } as unknown as ProfilerCoreService;

  const clientAssets = {
    register: jest.fn(),
    list: jest.fn().mockReturnValue(['profiler.js']),
    resolve: jest.fn(),
  } as unknown as ClientAssetRegistry;

  const emptySummary = {
    sampled: 0,
    duration: { avg: 0, p50: 0, p95: 0, p99: 0 },
    errors: { count: 0, rate: 0 },
    byMethod: {},
    byStatusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
    issues: {},
    topSlowEndpoints: [],
    recentErrors: [],
  };
  const summary = {
    getSummary: jest.fn().mockResolvedValue(emptySummary),
    getDomainSections: jest.fn().mockResolvedValue([]),
  } as unknown as SummaryService;

  const controller = new ProfilerController(core, renderer, clientAssets, summary, options);

  return { controller, rendered, core: core as never, summary: summary as never };
}

/** First (and only) rendered section from a `listProfiles` call. */
type RenderedSection = {
  profiles: Profile[];
  total: number;
  pagination: {
    page: number;
    pageCount: number;
    pageSize: number;
    filteredTotal: number;
    rangeStart: number;
    rangeEnd: number;
    prevHref: string | null;
    nextHref: string | null;
  };
};

describe('ProfilerController (unit)', () => {
  it('renders with the profiler path /_profiler', async () => {
    const { controller, rendered } = setup();
    await controller.listProfiles({}, mockReq());
    expect(rendered[0]?.ctx.profilerPath).toBe('/_profiler');
  });

  describe('security.linkQuery threading', () => {
    it('defaults to an identity link helper and no query pairs when unset', async () => {
      const { controller, rendered } = setup();
      await controller.listProfiles({}, mockReq());
      const link = rendered[0]?.ctx.link as (href: string) => string;
      expect(link('/_profiler')).toBe('/_profiler');
      expect(rendered[0]?.ctx.linkQueryPairs).toEqual([]);
    });

    it('appends the configured link query to list links (and the export) and exposes hidden pairs', async () => {
      const { controller, rendered } = setup({ security: { linkQuery: () => '?token=abc' } });
      await controller.listProfiles({}, mockReq());
      const link = rendered[0]?.ctx.link as (href: string) => string;
      expect(link('/_profiler')).toBe('/_profiler?token=abc');
      expect(link('/_profiler/tok/data')).toBe('/_profiler/tok/data?token=abc');
      expect(link('/_profiler/tok?tab=logs')).toBe('/_profiler/tok?tab=logs&token=abc');
      expect(rendered[0]?.ctx.linkQueryPairs).toEqual([{ name: 'token', value: 'abc' }]);
    });

    it('passes the request to linkQuery so the credential can be read from it', async () => {
      const linkQuery = jest.fn((req: PlatformRequest) => `?token=${String(req.query?.['token'])}`);
      const { controller, rendered } = setup({ security: { linkQuery } });
      await controller.getProfileDetail(mockReq({ query: { token: 'xyz' } }), 'tok-123456789');
      const link = rendered[0]?.ctx.link as (href: string) => string;
      expect(link('/_profiler')).toBe('/_profiler?token=xyz');
      expect(linkQuery).toHaveBeenCalled();
    });
  });

  describe('home sidebar views (?view=)', () => {
    it('defaults to the Summary view and lists Summary then Profiling in the sidebar', async () => {
      const { controller, rendered, summary, core } = setup();
      await controller.listProfiles({}, mockReq());
      expect(rendered[0]?.template).toBe('list');
      expect(rendered[0]?.ctx.activeView).toBe('summary');
      expect(rendered[0]?.ctx.views).toEqual([
        { key: 'summary', label: 'Summary' },
        { key: 'profiling', label: 'Profiling' },
      ]);
      // The Summary view aggregates via SummaryService and skips the list-section queries.
      expect(summary.getSummary).toHaveBeenCalledTimes(1);
      expect(rendered[0]?.ctx.summary).toBeDefined();
      expect(rendered[0]?.ctx.sections).toEqual([]);
      expect((core.storage as { query: jest.Mock }).query).not.toHaveBeenCalled();
    });

    it('honours a known ?view= value', async () => {
      const { controller, rendered } = setup();
      await controller.listProfiles({ view: 'profiling' }, mockReq());
      expect(rendered[0]?.ctx.activeView).toBe('profiling');
    });

    it('falls back to the default (Summary) view for an unknown ?view=', async () => {
      const { controller, rendered } = setup();
      await controller.listProfiles({ view: 'does-not-exist' }, mockReq());
      expect(rendered[0]?.ctx.activeView).toBe('summary');
    });

    it('adds one sidebar view per registered global panel and lazily builds only the active one', async () => {
      const { controller, rendered, core } = setup();
      const registry = core.collectorRegistry as {
        listGlobalPanelDescriptors: jest.Mock;
        buildGlobalPanel: jest.Mock;
      };
      registry.listGlobalPanelDescriptors.mockReturnValue([
        { name: 'config', label: 'Config', icon: '<svg/>' },
      ]);
      registry.buildGlobalPanel.mockResolvedValue({
        name: 'config',
        label: 'Config',
        data: { foo: 1 },
        templatePath: '/tmp/config.ejs',
      });

      await controller.listProfiles({ view: 'config' }, mockReq());

      expect(rendered[0]?.ctx.activeView).toBe('config');
      expect(rendered[0]?.ctx.views).toEqual([
        { key: 'summary', label: 'Summary' },
        { key: 'profiling', label: 'Profiling' },
        { key: 'config', label: 'Config', icon: '<svg/>' },
      ]);
      expect(registry.buildGlobalPanel).toHaveBeenCalledWith('config');
      expect(rendered[0]?.ctx.activeGlobalPanel).toMatchObject({ name: 'config' });
      // Lazy: the Profiling-only work (heap query + list sections) is skipped for a global view.
      expect(rendered[0]?.ctx.sections).toEqual([]);
      expect((core.storage as { query: jest.Mock }).query).not.toHaveBeenCalled();
    });

    it('exposes the aggregated summary as JSON via getSummaryData', async () => {
      const { controller, summary } = setup();
      const result = await controller.getSummaryData();
      expect(summary.getSummary).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ sampled: 0, errors: { count: 0 } });
    });

    it('builds the list sections and no summary/global panel on the Profiling view', async () => {
      const { controller, rendered, summary, core } = setup({ profiles: [] });
      const registry = core.collectorRegistry as { buildGlobalPanel: jest.Mock };
      await controller.listProfiles({ view: 'profiling' }, mockReq());
      expect(rendered[0]?.ctx.sections).toHaveLength(1);
      expect(summary.getSummary).not.toHaveBeenCalled();
      expect(registry.buildGlobalPanel).not.toHaveBeenCalled();
    });
  });

  it('falls back to the performance tab when the entrypoint type has no detail tabs', async () => {
    const { controller, rendered } = setup();
    await controller.getProfileDetail(mockReq(), 'tok-123456789');
    expect(rendered[0]?.template).toBe('detail');
    expect(rendered[0]?.ctx.activeTab).toBe('performance');
    expect(rendered[0]?.ctx.entrypointTabs).toEqual([]);
  });

  it('enriches grouped sub-panels with each collector data when several ORMs share a group', async () => {
    // A profile produced by an app wiring TypeORM + Mongoose at once: both collectors
    // stored their entries under their own name. Opening the merged "Database" tab must
    // hand every sub-panel its own data so all queries are visualised, none dropped.
    const profile = makeProfile();
    const typeormEntries = [{ sql: 'SELECT 1', duration: 2, isSlow: false }];
    const mongooseEntries = [
      { collection: 'reviews', operation: 'find', duration: 3, isSlow: false },
    ];
    profile.collectors = { typeorm: typeormEntries, mongoose: mongooseEntries };

    const { controller, rendered, core } = setup({ profiles: [profile] });
    (core.collectorRegistry as { buildPanels: jest.Mock }).buildPanels.mockReturnValue([
      {
        name: 'database',
        label: 'Database',
        priority: 10,
        isGroup: true,
        templatePath: '/tmp/grouped.ejs',
        subPanels: [
          { name: 'typeorm', label: 'TypeORM', templatePath: '/tmp/sql.ejs' },
          { name: 'mongoose', label: 'MongoDB', templatePath: '/tmp/mongo.ejs' },
        ],
      },
    ]);

    await controller.getProfileDetail(mockReq(), profile.token, 'database');

    expect(rendered[0]?.ctx.activeTab).toBe('database');
    // No `subtab` query → the grouped panel falls back to its first sub-tab.
    expect(rendered[0]?.ctx.activeSubTab).toBeNull();
    expect(rendered[0]?.ctx.collectorData).toEqual({
      subPanels: [
        { name: 'typeorm', label: 'TypeORM', templatePath: '/tmp/sql.ejs', data: typeormEntries },
        {
          name: 'mongoose',
          label: 'MongoDB',
          templatePath: '/tmp/mongo.ejs',
          data: mongooseEntries,
        },
      ],
    });
  });

  it('forwards the ?subtab query to the view so a grouped sub-panel is linkable', async () => {
    const profile = makeProfile();
    const { controller, rendered } = setup({ profiles: [profile] });

    await controller.getProfileDetail(mockReq(), profile.token, 'database', 'mongoose');

    expect(rendered[0]?.ctx.activeSubTab).toBe('mongoose');
  });

  it('resolves ?tag to the tab (and grouped sub-tab) whose entries carry that tag', async () => {
    const profile = makeProfile();
    profile.collectors = {
      typeorm: [{ sql: 'SELECT 1', duration: 2, tags: [] }],
      mongoose: [
        {
          collection: 'r',
          operation: 'find',
          duration: 3,
          tags: [{ id: 'n-plus-one', severity: 'warning' }],
        },
      ],
    };
    const { controller, rendered, core } = setup({ profiles: [profile] });
    (core.collectorRegistry as { buildPanels: jest.Mock }).buildPanels.mockReturnValue([
      {
        name: 'database',
        label: 'Database',
        priority: 10,
        isGroup: true,
        templatePath: '/tmp/g.ejs',
        subPanels: [
          { name: 'typeorm', label: 'TypeORM', templatePath: '/tmp/sql.ejs' },
          { name: 'mongoose', label: 'MongoDB', templatePath: '/tmp/mongo.ejs' },
        ],
      },
    ]);

    await controller.getProfileDetail(mockReq(), profile.token, undefined, undefined, 'n-plus-one');

    expect(rendered[0]?.ctx.activeTab).toBe('database');
    expect(rendered[0]?.ctx.activeSubTab).toBe('mongoose');
  });

  it('lets an explicit ?tab win over ?tag, and keeps the default tab for an unknown tag', async () => {
    const profile = makeProfile();
    profile.collectors = { http: [{ url: '/x', tags: [{ id: 'slow', severity: 'warning' }] }] };
    const { controller, rendered, core } = setup({ profiles: [profile] });
    (core.collectorRegistry as { buildPanels: jest.Mock }).buildPanels.mockReturnValue([
      { name: 'http', label: 'HTTP', priority: 10 },
    ]);

    // A matching tag opens its collector tab…
    await controller.getProfileDetail(mockReq(), profile.token, undefined, undefined, 'slow');
    expect(rendered[0]?.ctx.activeTab).toBe('http');
    // …an explicit tab always wins…
    await controller.getProfileDetail(mockReq(), profile.token, 'performance', undefined, 'slow');
    expect(rendered[1]?.ctx.activeTab).toBe('performance');
    // …and an unknown tag keeps the default (no entry carries it).
    await controller.getProfileDetail(mockReq(), profile.token, undefined, undefined, 'nope');
    expect(rendered[2]?.ctx.activeTab).toBe('performance');
  });

  it('keeps a badgeless entrypoint tab active (undefined, not null) so it is never dimmed', async () => {
    const { controller, rendered, core } = setup();
    (core.getEntrypointType as jest.Mock).mockReturnValue({
      ...TABLESS_TYPE,
      detailTabs: [
        // No badge function: the tab always carries content (e.g. Request).
        { name: 'request', label: 'Request', templatePath: '/tmp/request.ejs' },
        // A badge that returns null: genuinely "no data", so it may be dimmed.
        {
          name: 'response',
          label: 'Response',
          templatePath: '/tmp/response.ejs',
          badge: () => null,
        },
        // A badge that returns a count: shown as-is.
        {
          name: 'items',
          label: 'Items',
          templatePath: '/tmp/items.ejs',
          badge: () => 3,
        },
      ],
    });
    await controller.getProfileDetail(mockReq(), 'tok-123456789');
    expect(rendered[0]?.ctx.entrypointTabs).toEqual([
      { name: 'request', label: 'Request', icon: undefined, badge: undefined },
      { name: 'response', label: 'Response', icon: undefined, badge: null },
      { name: 'items', label: 'Items', icon: undefined, badge: 3 },
    ]);
  });

  it('drops empty and array-empty foreign params from reset links', async () => {
    const { controller, rendered } = setup();
    // `''` (empty string) and `[]` (no first element) both fail the keep test,
    // so the only section's reset link carries no query string.
    await controller.listProfiles({ view: 'profiling', other_a: '', other_b: [] }, mockReq());
    const sections = rendered[0]?.ctx.sections as { resetHref: string }[];
    // The reset link keeps the active view but drops the empty foreign params.
    expect(sections[0]?.resetHref).toBe('/_profiler?view=profiling');
  });

  describe('pagination', () => {
    // Distinct, descending createdAt so newest-first ordering yields tok-0…tok-N deterministically
    // (independent of the token tie-breaker used only for equal timestamps).
    const manyProfiles = (n: number): Profile[] =>
      Array.from({ length: n }, (_, i) => makeProfile(`tok-${i}`, 1_000_000 - i));

    it('slices a section to one page and reports the total + range', async () => {
      const { controller, rendered } = setup({ listPageSize: 25, profiles: manyProfiles(60) });
      await controller.listProfiles({ view: 'profiling' }, mockReq());
      const section = (rendered[0]?.ctx.sections as RenderedSection[])[0]!;
      expect(section.profiles).toHaveLength(25);
      expect(section.profiles[0]?.token).toBe('tok-0');
      expect(section.total).toBe(60);
      expect(section.pagination).toMatchObject({
        page: 1,
        pageCount: 3,
        pageSize: 25,
        filteredTotal: 60,
        rangeStart: 1,
        rangeEnd: 25,
        prevHref: null,
        // The pager preserves the active view so paging never bounces back to the default.
        nextHref: '/_profiler?view=profiling&http_page=2',
      });
    });

    it('serves the requested page and builds prev/next links preserving other params', async () => {
      const { controller, rendered } = setup({ listPageSize: 25, profiles: manyProfiles(60) });
      await controller.listProfiles(
        { view: 'profiling', http_page: '2', other_x: 'keep' },
        mockReq(),
      );
      const section = (rendered[0]?.ctx.sections as RenderedSection[])[0]!;
      expect(section.profiles[0]?.token).toBe('tok-25');
      expect(section.pagination).toMatchObject({
        page: 2,
        rangeStart: 26,
        rangeEnd: 50,
        // page 1 omits the `_page` param; both links carry the active view and foreign `other_x`.
        // The refreshed `_page` is appended last, after the preserved params.
        prevHref: '/_profiler?view=profiling&other_x=keep',
        nextHref: '/_profiler?view=profiling&other_x=keep&http_page=3',
      });
    });

    it('clamps an out-of-range page to the last page', async () => {
      const { controller, rendered } = setup({ listPageSize: 25, profiles: manyProfiles(60) });
      await controller.listProfiles({ view: 'profiling', http_page: '999' }, mockReq());
      const section = (rendered[0]?.ctx.sections as RenderedSection[])[0]!;
      expect(section.pagination).toMatchObject({
        page: 3,
        pageCount: 3,
        rangeStart: 51,
        rangeEnd: 60,
        nextHref: null,
      });
      expect(section.profiles).toHaveLength(10);
    });

    it('defaults the page size to 25 when no listPageSize option is given', async () => {
      const { controller, rendered } = setup({ profiles: manyProfiles(30) });
      await controller.listProfiles({ view: 'profiling' }, mockReq());
      const section = (rendered[0]?.ctx.sections as RenderedSection[])[0]!;
      expect(section.pagination.pageSize).toBe(25);
      expect(section.profiles).toHaveLength(25);
    });
  });
});
