import { ProfilerController } from './profiler.controller';
import type { ProfilerCoreService } from '../services/profiler-core.service';
import type { TemplateRendererService } from '../services/template-renderer.service';
import type { ClientAssetRegistry } from '../services/client-asset-registry.service';
import type { ExplainRunnerRegistry } from '../collectors/sql/explain/explain-runner-registry.service';
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
    explainRunner?: unknown;
  } = {},
): {
  controller: ProfilerController;
  rendered: RenderArgs[];
  core: jest.Mocked<Pick<ProfilerCoreService, never>> & Record<string, unknown>;
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

  const explainRunners = {
    get: jest.fn().mockReturnValue(options.explainRunner),
    names: jest.fn().mockReturnValue(options.explainRunner ? ['typeorm'] : []),
    register: jest.fn(),
  } as unknown as ExplainRunnerRegistry;

  const controller = new ProfilerController(core, renderer, clientAssets, explainRunners, options);

  return { controller, rendered, core: core as never };
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
    it('defaults to the catch-all section and lists sections + badged global panels in the sidebar', async () => {
      const { controller, rendered, core } = setup();
      (
        core.collectorRegistry as { buildGlobalPanels: jest.Mock }
      ).buildGlobalPanels.mockResolvedValue([
        { name: 'config', label: 'Config', data: {}, badge: 12 },
      ]);
      await controller.listProfiles({}, mockReq());
      expect(rendered[0]?.template).toBe('list');
      expect(rendered[0]?.ctx.activeView).toBe('http');
      // Section sub-items carry an unfiltered count badge; global items carry the panel's own badge.
      expect(rendered[0]?.ctx.sectionViews).toEqual([{ key: 'http', label: 'HTTP', count: 0 }]);
      expect(rendered[0]?.ctx.globalViews).toEqual([
        { key: 'config', label: 'Config', icon: undefined, count: 12 },
      ]);
      expect((rendered[0]?.ctx.activeSection as { key: string }).key).toBe('http');
      expect(rendered[0]?.ctx.activeGlobalPanel).toBeUndefined();
    });

    it('picks the active global panel for ?view=<panel> and builds no section', async () => {
      const { controller, rendered, core } = setup();
      (
        core.collectorRegistry as { buildGlobalPanels: jest.Mock }
      ).buildGlobalPanels.mockResolvedValue([
        { name: 'config', label: 'Config', data: {}, badge: 3 },
      ]);

      await controller.listProfiles({ view: 'config' }, mockReq());

      expect(rendered[0]?.ctx.activeView).toBe('config');
      expect((rendered[0]?.ctx.activeGlobalPanel as { name: string }).name).toBe('config');
      expect(rendered[0]?.ctx.activeSection).toBeUndefined();
    });

    it('falls back to the default section for an unknown ?view=', async () => {
      const { controller, rendered } = setup();
      await controller.listProfiles({ view: 'nope' }, mockReq());
      expect(rendered[0]?.ctx.activeView).toBe('http');
    });
  });

  it('falls back to the performance tab when the entrypoint type has no detail tabs', async () => {
    const { controller, rendered } = setup();
    await controller.getProfileDetail(mockReq(), 'tok-123456789');
    expect(rendered[0]?.template).toBe('detail');
    expect(rendered[0]?.ctx.activeTab).toBe('performance');
    expect(rendered[0]?.ctx.entrypointTabs).toEqual([]);
  });

  it('resolves the profile list view for the back link (its section, else the default)', async () => {
    const { controller, rendered, core } = setup();
    // The GraphQL section owns the `graphql` type implicitly (a section's types default to its key).
    (core.getListSections as jest.Mock).mockReturnValue([
      { key: 'http', title: 'HTTP', isDefault: true, templatePath: '/tmp/http.ejs' },
      { key: 'graphql', title: 'GraphQL', templatePath: '/tmp/gql.ejs' },
    ]);

    // A 'tabless' profile matches no typed section → the default catch-all.
    await controller.getProfileDetail(mockReq(), 'tok-123456789');
    expect(rendered[0]?.ctx.listView).toBe('http');
    expect(rendered[0]?.ctx.listLabel).toBe('HTTP');

    // A profile whose entrypoint type owns a section → that section.
    const gqlProfile = makeProfile('gql-token-123');
    gqlProfile.entrypoint = { type: 'graphql', data: {} };
    (core.storage as { findOne: jest.Mock }).findOne.mockResolvedValueOnce(gqlProfile);
    await controller.getProfileDetail(mockReq(), 'gql-token-123');
    expect(rendered[1]?.ctx.listView).toBe('graphql');
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
    await controller.listProfiles({ other_a: '', other_b: [] }, mockReq());
    const section = rendered[0]?.ctx.activeSection as { resetHref: string };
    expect(section.resetHref).toBe('/_profiler');
  });

  describe('pagination', () => {
    // Distinct, descending createdAt so newest-first ordering yields tok-0…tok-N deterministically
    // (independent of the token tie-breaker used only for equal timestamps).
    const manyProfiles = (n: number): Profile[] =>
      Array.from({ length: n }, (_, i) => makeProfile(`tok-${i}`, 1_000_000 - i));

    it('slices a section to one page and reports the total + range', async () => {
      const { controller, rendered } = setup({ listPageSize: 25, profiles: manyProfiles(60) });
      await controller.listProfiles({}, mockReq());
      const section = rendered[0]?.ctx.activeSection as RenderedSection;
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
        nextHref: '/_profiler?http_page=2',
      });
    });

    it('serves the requested page and builds prev/next links preserving other params', async () => {
      const { controller, rendered } = setup({ listPageSize: 25, profiles: manyProfiles(60) });
      await controller.listProfiles({ http_page: '2', other_x: 'keep' }, mockReq());
      const section = rendered[0]?.ctx.activeSection as RenderedSection;
      expect(section.profiles[0]?.token).toBe('tok-25');
      expect(section.pagination).toMatchObject({
        page: 2,
        rangeStart: 26,
        rangeEnd: 50,
        // page 1 omits the `_page` param; both links carry the foreign `other_x`.
        // The refreshed `_page` is appended last, after the preserved params.
        prevHref: '/_profiler?other_x=keep',
        nextHref: '/_profiler?other_x=keep&http_page=3',
      });
    });

    it('clamps an out-of-range page to the last page', async () => {
      const { controller, rendered } = setup({ listPageSize: 25, profiles: manyProfiles(60) });
      await controller.listProfiles({ http_page: '999' }, mockReq());
      const section = rendered[0]?.ctx.activeSection as RenderedSection;
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
      await controller.listProfiles({}, mockReq());
      const section = rendered[0]?.ctx.activeSection as RenderedSection;
      expect(section.pagination.pageSize).toBe(25);
      expect(section.profiles).toHaveLength(25);
    });
  });

  describe('explainQuery', () => {
    function profileWithQuery(): Profile {
      const profile = makeProfile('exp-token-123');
      profile.collectors['typeorm'] = [
        {
          sql: 'SELECT * FROM products WHERE sku = $1',
          parameters: ['abc'],
          duration: 12,
          type: 'SELECT',
          startedAt: 0,
        },
      ];
      return profile;
    }

    it('404s when no runner is registered for the collector', async () => {
      const { controller } = setup({ profiles: [profileWithQuery()] });
      await expect(controller.explainQuery('exp-token-123', 'typeorm', '0')).rejects.toThrow(
        /No EXPLAIN runner/,
      );
    });

    it('runs the runner and renders the plan fragment', async () => {
      const explain = jest.fn().mockResolvedValue({
        dialect: 'postgres',
        analyzed: false,
        raw: [
          {
            Plan: {
              'Node Type': 'Sort',
              Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'products' }],
            },
          },
        ],
      });
      const { controller, rendered } = setup({
        profiles: [profileWithQuery()],
        explainRunner: { collectorName: 'typeorm', explain },
      });

      await controller.explainQuery('exp-token-123', 'typeorm', '0');

      expect(explain).toHaveBeenCalledWith('SELECT * FROM products WHERE sku = $1', ['abc']);
      const call = rendered.find((r) => r.template === 'explain-fragment');
      expect(call?.ctx.plan).toMatchObject({ hasSeqScan: true, seqScanRelations: ['products'] });
      // The raw plan is serialized at full depth — the nested Plans tree must not collapse.
      expect(call?.ctx.rawJson).toContain('Seq Scan');
      expect(call?.ctx.rawJson).not.toContain('[Object]');
    });

    it('renders an error fragment when the runner throws', async () => {
      const explain = jest.fn().mockRejectedValue(new Error('boom'));
      const { controller, rendered } = setup({
        profiles: [profileWithQuery()],
        explainRunner: { collectorName: 'typeorm', explain },
      });

      await controller.explainQuery('exp-token-123', 'typeorm', '0');

      const call = rendered.find((r) => r.template === 'explain-fragment');
      expect(call?.ctx.error).toBe('boom');
    });

    it('404s when the query index is out of range', async () => {
      const { controller } = setup({
        profiles: [profileWithQuery()],
        explainRunner: { collectorName: 'typeorm', explain: jest.fn() },
      });
      await expect(controller.explainQuery('exp-token-123', 'typeorm', '5')).rejects.toThrow(
        /Query "5" not found/,
      );
    });
  });
});
