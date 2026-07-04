import { ProfilerController } from './profiler.controller';
import type { ProfilerCoreService } from '../services/profiler-core.service';
import type { TemplateRendererService } from '../services/template-renderer.service';
import type { ClientAssetRegistry } from '../services/client-asset-registry.service';
import type { ProfilerEntrypointType } from '../entrypoints/profiler-entrypoint-type.interface';
import type { Profile } from '../interfaces/profile.interface';
import type { ProfilerQuery } from '../storage/profiler-query';
import { applyQueryInMemory, distinctInMemory } from '../storage/profiler-query';

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

function setup(options: { listPageSize?: number; profiles?: Profile[] } = {}): {
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

  const controller = new ProfilerController(core, renderer, clientAssets, options);

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
    await controller.listProfiles({});
    expect(rendered[0]?.ctx.profilerPath).toBe('/_profiler');
  });

  it('falls back to the performance tab when the entrypoint type has no detail tabs', async () => {
    const { controller, rendered } = setup();
    await controller.getProfileDetail('tok-123456789');
    expect(rendered[0]?.template).toBe('detail');
    expect(rendered[0]?.ctx.activeTab).toBe('performance');
    expect(rendered[0]?.ctx.entrypointTabs).toEqual([]);
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
    await controller.getProfileDetail('tok-123456789');
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
    await controller.listProfiles({ other_a: '', other_b: [] });
    const sections = rendered[0]?.ctx.sections as { resetHref: string }[];
    expect(sections[0]?.resetHref).toBe('/_profiler');
  });

  describe('pagination', () => {
    // Distinct, descending createdAt so newest-first ordering yields tok-0…tok-N deterministically
    // (independent of the token tie-breaker used only for equal timestamps).
    const manyProfiles = (n: number): Profile[] =>
      Array.from({ length: n }, (_, i) => makeProfile(`tok-${i}`, 1_000_000 - i));

    it('slices a section to one page and reports the total + range', async () => {
      const { controller, rendered } = setup({ listPageSize: 25, profiles: manyProfiles(60) });
      await controller.listProfiles({});
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
        nextHref: '/_profiler?http_page=2',
      });
    });

    it('serves the requested page and builds prev/next links preserving other params', async () => {
      const { controller, rendered } = setup({ listPageSize: 25, profiles: manyProfiles(60) });
      await controller.listProfiles({ http_page: '2', other_x: 'keep' });
      const section = (rendered[0]?.ctx.sections as RenderedSection[])[0]!;
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
      await controller.listProfiles({ http_page: '999' });
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
      await controller.listProfiles({});
      const section = (rendered[0]?.ctx.sections as RenderedSection[])[0]!;
      expect(section.pagination.pageSize).toBe(25);
      expect(section.profiles).toHaveLength(25);
    });
  });
});
