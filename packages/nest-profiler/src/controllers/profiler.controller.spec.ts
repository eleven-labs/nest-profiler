import { ProfilerController } from './profiler.controller';
import type { ProfilerCoreService } from '../services/profiler-core.service';
import type { TemplateRendererService } from '../services/template-renderer.service';
import type { ClientAssetRegistry } from '../services/client-asset-registry.service';
import type { ProfilerEntrypointType } from '../entrypoints/profiler-entrypoint-type.interface';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(): Profile {
  return {
    token: 'tok-123456789',
    createdAt: Date.now(),
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

function setup(): {
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
    storage: {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(makeProfile()),
    },
    collectorRegistry: {
      buildGlobalPanels: jest.fn().mockResolvedValue([]),
      buildPanels: jest.fn().mockReturnValue([]),
    },
    getListFilters: jest.fn().mockReturnValue([]),
    getListSections: jest.fn().mockReturnValue([
      {
        key: 'http',
        title: 'HTTP',
        isDefault: true,
        templatePath: '/tmp/http.ejs',
        matches: () => true,
      },
    ]),
    getEntrypointType: jest.fn().mockReturnValue(TABLESS_TYPE),
  } as unknown as ProfilerCoreService;

  const clientAssets = {
    register: jest.fn(),
    list: jest.fn().mockReturnValue(['profiler.js']),
    resolve: jest.fn(),
  } as unknown as ClientAssetRegistry;

  const controller = new ProfilerController(core, renderer, clientAssets);

  return { controller, rendered, core: core as never };
}

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
});
