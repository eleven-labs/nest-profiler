import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_LIST_PAGE_SIZE, PROFILER_BASE_PATH } from '../constants';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { TemplateRendererService } from '../services/template-renderer.service';
import { ClientAssetRegistry } from '../services/client-asset-registry.service';
import { PUBLIC_DIR } from '../views/template-engine';
import { ProfilerCoreService } from '../services/profiler-core.service';
import { SummaryService } from '../services/summary.service';
import type { ProfilerSummary } from '../summary/profiler-summary';
import type { CollectorPanelInfo, GlobalPanelInfo } from '../collectors/collector-registry.service';
import type { ProfilerTag } from '../analysis/profiler-tag.interface';
import type { CollectorSummarySection } from '../collectors/collector-summary.interface';
import { ProfilerGuard } from '../guards/profiler.guard';
import { appendLinkQuery, linkQueryPairs } from '../views/link.utils';
import type { PlatformRequest } from '../types/http';
import type { Profile } from '../interfaces/profile.interface';
import {
  buildCriteria,
  filterAppliesToSection,
  parseFilterValues,
  parseLenientInt,
} from '../list-filters/list-filter.utils';
import { sectionTypeConstraint } from '../list-sections/list-section.utils';
import { buildPageHref } from '../list-pagination/list-pagination.utils';
import type { ProfilerQuery } from '../storage/profiler-query';
import type { ProfilerListFilter } from '../list-filters/profiler-list-filter.interface';
import type { ProfilerListSection } from '../list-sections/profiler-list-section.interface';

/** Universal tabs every profile shows, regardless of its entrypoint kind. */
const UNIVERSAL_TAB_NAMES = ['performance', 'logs', 'exceptions'];

/**
 * The home page's built-in sidebar view keys. The active view is chosen from the
 * `?view=` query param (server-rendered, no client routing), mirroring the detail
 * page's `?tab=` navigation. `summary` is the aggregated overview (the default);
 * `profiling` hosts the per-entrypoint list sections; global-collector panels
 * (Config, Routes, Schemas…) contribute their own view keys dynamically.
 */
const SUMMARY_VIEW = 'summary';
const PROFILING_VIEW = 'profiling';

/** The view rendered when `?view=` is absent or unknown. */
const DEFAULT_HOME_VIEW = SUMMARY_VIEW;

/**
 * Stylesheets the profiler serves same-origin from `public/styles`. The allowlist
 * doubles as path-traversal protection: any name not listed here is rejected with
 * a 404. Authored/extension scripts are served via {@link ClientAssetRegistry}
 * instead; the vendored third-party scripts below round out the script allowlist.
 */
const STYLE_ALLOWLIST = ['profiler.css', 'toolbar.css', 'github.min.css', 'github-dark.min.css'];

/** Vendored third-party scripts served from `public/scripts` (not authored bundles). */
const VENDORED_SCRIPTS = ['highlight.min.js', 'graphql.min.js'];

/**
 * Content-Security-Policy for the profiler's sensitive responses. `script-src 'self'` (the UI
 * carries no inline scripts) neutralises any residual XSS; `frame-ancestors 'none'` blocks
 * clickjacking. Paired with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`
 * on the HTML pages and the JSON export.
 */
const PROFILER_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'";

@UseGuards(ProfilerGuard)
@Controller()
export class ProfilerController {
  private static readonly assetCache = new Map<string, string>();
  private readonly profilerPath = PROFILER_BASE_PATH;
  /** Profiles shown per page in each list section (see `listPageSize`). */
  private readonly pageSize: number;
  /** Optional hook returning a query string appended to UI links (query-param auth). */
  private readonly linkQueryFn?: (request: PlatformRequest) => string;

  constructor(
    private readonly core: ProfilerCoreService,
    private readonly templateRenderer: TemplateRendererService,
    private readonly clientAssets: ClientAssetRegistry,
    private readonly summary: SummaryService,
    @Inject(NEST_PROFILER_MODULE_OPTIONS) options: ProfilerModuleOptions,
  ) {
    this.pageSize = options.listPageSize ?? DEFAULT_LIST_PAGE_SIZE;
    this.linkQueryFn = options.security?.linkQuery;
  }

  /**
   * The credential query string (e.g. `?token=abc`) to thread through the UI's links so a
   * query-param auth scheme survives browser navigation. Empty unless `security.linkQuery`
   * is configured (cookie/session/Basic auth needs nothing here — the browser propagates it).
   */
  private resolveLinkQuery(req: PlatformRequest): string {
    return this.linkQueryFn?.(req) ?? '';
  }

  @Get(`${PROFILER_BASE_PATH}/__assets/styles/:file`)
  @Header('Content-Type', 'text/css; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  getStyle(@Param('file') file: string): string {
    if (!STYLE_ALLOWLIST.includes(file)) throw new NotFoundException(`Asset "${file}" not found.`);
    return this.readAsset(join(PUBLIC_DIR, 'styles', file), `styles/${file}`);
  }

  @Get(`${PROFILER_BASE_PATH}/__assets/scripts/:file`)
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  getScript(@Param('file') file: string): string {
    // Registered bundles (core + extensions) resolve to their on-disk path;
    // vendored third-party scripts live in `public/scripts`. Anything else 404s.
    const absPath =
      this.clientAssets.resolve(file) ??
      (VENDORED_SCRIPTS.includes(file) ? join(PUBLIC_DIR, 'scripts', file) : undefined);
    if (absPath === undefined) throw new NotFoundException(`Asset "${file}" not found.`);
    return this.readAsset(absPath, `scripts/${file}`);
  }

  /** Reads a static asset from an absolute path, caching its contents in memory by key. */
  private readAsset(absPath: string, cacheKey: string): string {
    let content = ProfilerController.assetCache.get(cacheKey);
    if (content === undefined) {
      content = readFileSync(absPath, 'utf-8');
      ProfilerController.assetCache.set(cacheKey, content);
    }
    return content;
  }

  @Get(PROFILER_BASE_PATH)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', PROFILER_CSP)
  async listProfiles(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() req: PlatformRequest,
  ): Promise<string> {
    const linkQuery = this.resolveLinkQuery(req);
    const allSections = this.core.getListSections();

    // The active sidebar view is server-selected from `?view=` (no client routing).
    const requestedView = typeof query.view === 'string' ? query.view : undefined;

    // Sidebar views: the built-in "Profiling" list plus one entry per registered global
    // panel (Config, Routes, Schemas…). Descriptors carry name/label/icon only — no
    // `collect()` runs here; only the active view's panel is materialised below. An
    // unknown/absent `?view=` falls back to the default so a stale link never blanks the pane.
    const globalDescriptors = this.core.collectorRegistry.listGlobalPanelDescriptors();
    const views = [
      { key: SUMMARY_VIEW, label: 'Summary' },
      { key: PROFILING_VIEW, label: 'Profiling' },
      ...globalDescriptors.map((d) => ({ key: d.name, label: d.label, icon: d.icon })),
    ];
    const activeView = views.some((v) => v.key === requestedView)
      ? (requestedView as string)
      : DEFAULT_HOME_VIEW;

    // Build only the active view. Summary aggregates a bounded window (cached, including the heap
    // trend); the Profiling view builds the list sections; a global view materialises its panel.
    let summary: ProfilerSummary | undefined;
    let domainSections: CollectorSummarySection[] = [];
    let sections: Record<string, unknown>[] = [];
    let activeGlobalPanel: GlobalPanelInfo | undefined;

    if (activeView === SUMMARY_VIEW) {
      // The request-level summary (index-only) and the optional collector-contributed domain
      // sections (full-profile window, only when a collector opts in) are both cached.
      [summary, domainSections] = await Promise.all([
        this.summary.getSummary(),
        this.summary.getDomainSections(),
      ]);
    } else if (activeView === PROFILING_VIEW) {
      // Each section is an independent list, scoped to its entrypoint type(s) with its own
      // namespaced filter/page params (`<sectionKey>_<key>`); filtering and pagination are pushed
      // to the storage adapter (native when supported, in-memory fallback otherwise).
      sections = await Promise.all(
        allSections.map((section) => this.buildSection(section, allSections, query)),
      );
    } else {
      activeGlobalPanel = await this.core.collectorRegistry.buildGlobalPanel(activeView);
    }

    return this.templateRenderer.render('list', {
      title: 'Profiles',
      profilerPath: this.profilerPath,
      link: (href: string) => appendLinkQuery(href, linkQuery),
      linkQueryPairs: linkQueryPairs(linkQuery),
      clientScripts: this.clientAssets.list(),
      views,
      activeView,
      summary,
      domainSections,
      sections,
      activeGlobalPanel,
    });
  }

  /** Resolves one list section: its filter bar, the current page of profiles and the pager. */
  private async buildSection(
    section: ProfilerListSection,
    allSections: ProfilerListSection[],
    query: Record<string, string | string[] | undefined>,
  ): Promise<Record<string, unknown>> {
    const constraint = sectionTypeConstraint(section, allSections);

    // Resolve the section's filter bar, filling dynamic `select` options from the
    // store's distinct values for filters that declare a `distinctField`.
    const filterDefs = await Promise.all(
      this.core
        .getListFilters()
        .filter((f) => filterAppliesToSection(f, section.key))
        .map((f) => this.resolveFilterOptions(f, constraint.typeIn)),
    );

    const namespaced: Record<string, string | string[] | undefined> = {};
    for (const def of filterDefs) namespaced[def.key] = query[`${section.key}_${def.key}`];
    const { active, raw } = parseFilterValues(filterDefs, namespaced);
    const criteria = buildCriteria(active);

    const pageParam = query[`${section.key}_page`];
    const rawPage = parseLenientInt(Array.isArray(pageParam) ? pageParam[0] : pageParam) ?? 1;

    // The pager links carry every query param forward, so they preserve the active
    // filters and the pages of other sections. Submitting the filter form drops the
    // `_page` params (they are anchor-only), so changing a filter resets to page 1.
    const baseQuery: ProfilerQuery = {
      ...constraint,
      filters: criteria,
      page: rawPage,
      pageSize: this.pageSize,
    };
    const { items, total, page, pageCount } = await this.querySection(baseQuery);

    // The badge/visibility use the section's unfiltered total; it equals the page
    // total when no filter is active, else it takes one extra count query.
    const unfilteredTotal =
      criteria.length === 0
        ? total
        : (await this.core.storage.query({ ...constraint, filters: [], page: 1, pageSize: 1 }))
            .total;

    const offset = (page - 1) * this.pageSize;
    return {
      key: section.key,
      title: section.title,
      description: section.description,
      itemLabel: section.itemLabel ?? 'profile',
      isDefault: section.isDefault === true,
      defaultCollapsed: section.defaultCollapsed === true,
      templatePath: section.templatePath,
      total: unfilteredTotal,
      profiles: items,
      filterDefs,
      filterValues: raw,
      filterPrefix: section.key,
      resetHref: this.buildResetHref(query, section.key),
      pagination: {
        page,
        pageCount,
        pageSize: this.pageSize,
        filteredTotal: total,
        rangeStart: items.length === 0 ? 0 : offset + 1,
        rangeEnd: offset + items.length,
        prevHref: page > 1 ? buildPageHref(this.profilerPath, query, section.key, page - 1) : null,
        nextHref:
          page < pageCount ? buildPageHref(this.profilerPath, query, section.key, page + 1) : null,
      },
    };
  }

  /** Fills a filter's dynamic `select` options from the store's distinct values, if it declares one. */
  private async resolveFilterOptions(
    filter: ProfilerListFilter,
    typeIn?: string[],
  ): Promise<ProfilerListFilter> {
    if (!filter.distinctField) return filter;
    const values = await this.core.storage.distinct(filter.distinctField, typeIn);
    const options = [
      { value: '', label: 'All' },
      ...values.map((v) => ({ value: String(v), label: String(v) })),
    ];
    return { ...filter, options };
  }

  /**
   * Runs a section's query, clamping an out-of-range page to the last page (one
   * extra query only when the requested page overflows the available range).
   */
  private async querySection(
    baseQuery: ProfilerQuery,
  ): Promise<{ items: Profile[]; total: number; page: number; pageCount: number }> {
    const page = Math.max(1, baseQuery.page);
    const first = await this.core.storage.query({ ...baseQuery, page });
    const pageCount = Math.max(1, Math.ceil(first.total / baseQuery.pageSize));
    if (page > pageCount) {
      const last = await this.core.storage.query({ ...baseQuery, page: pageCount });
      return { items: last.items, total: last.total, page: pageCount, pageCount };
    }
    return { items: first.items, total: first.total, page, pageCount };
  }

  /** Link that clears one section's filters while preserving every other section's. */
  private buildResetHref(
    query: Record<string, string | string[] | undefined>,
    prefix: string,
  ): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith(`${prefix}_`)) continue;
      const v = Array.isArray(value) ? value[0] : value;
      if (typeof v === 'string' && v.length > 0) params.set(key, v);
    }
    const qs = params.toString();
    return qs ? `${this.profilerPath}?${qs}` : this.profilerPath;
  }

  /**
   * JSON export of the aggregated Summary. Declared **before** the `:token` route so the literal
   * `summary.json` segment wins over the token matcher (Nest matches in declaration order).
   */
  @Get(`${PROFILER_BASE_PATH}/summary.json`)
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  getSummaryData(): Promise<ProfilerSummary> {
    return this.summary.getSummary();
  }

  @Get(`${PROFILER_BASE_PATH}/:token/data`)
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async getProfileData(@Param('token') token: string): Promise<Profile> {
    const profile = await this.core.storage.findOne(token);
    if (!profile) throw new NotFoundException(`Profile "${token}" not found.`);
    return profile;
  }

  @Get(`${PROFILER_BASE_PATH}/:token`)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', PROFILER_CSP)
  async getProfileDetail(
    @Req() req: PlatformRequest,
    @Param('token') token: string,
    @Query('tab') tab?: string,
    @Query('subtab') subtab?: string,
    @Query('tag') tag?: string,
  ): Promise<string> {
    const linkQuery = this.resolveLinkQuery(req);
    const profile = await this.core.storage.findOne(token);
    if (!profile) throw new NotFoundException(`Profile "${token}" not found.`);

    const collectorPanels = this.core.collectorRegistry.buildPanels(profile);
    const collectorTabNames = collectorPanels.map((p) => p.name);

    // From a Summary issue row (`?tag=<id>`, no explicit `?tab=`): open the tab that carries the tag.
    const tagTab = tab ? undefined : this.resolveTagTab(profile, collectorPanels, tag);

    // The active entrypoint type owns the primary tabs (e.g. Request/Response for
    // HTTP, Command for a CLI command, Message for a consumed message). It falls
    // back to the built-in HTTP type when the kind has no dedicated type.
    const entrypointType = this.core.getEntrypointType(profile.entrypoint.type);
    const entrypointTabs = entrypointType.detailTabs.map((t) => ({
      name: t.name,
      label: t.label,
      icon: t.icon,
      badge: t.badge ? (t.badge(profile) ?? null) : undefined,
    }));
    const entrypointTabNames = entrypointTabs.map((t) => t.name);
    const builtinTabNames = [...entrypointTabNames, ...UNIVERSAL_TAB_NAMES];

    const defaultTab = entrypointTabs[0]?.name ?? 'performance';
    const activeTab = tab ?? tagTab?.tab ?? defaultTab;

    const summary = entrypointType.summary(profile);
    const entrypointTabTemplate = entrypointType.detailTabs.find(
      (t) => t.name === activeTab,
    )?.templatePath;

    const isCollectorTab =
      collectorTabNames.includes(activeTab) && !builtinTabNames.includes(activeTab);

    let collectorData: unknown = undefined;
    if (isCollectorTab) {
      const activePanel = collectorPanels.find((p) => p.name === activeTab);
      if (activePanel?.isGroup && activePanel.subPanels) {
        collectorData = {
          subPanels: activePanel.subPanels
            .map((sp) => ({ ...sp, data: profile.collectors[sp.name] }))
            .filter((sp) => sp.data !== undefined),
        };
      } else {
        collectorData = profile.collectors[activeTab];
      }
    }

    return this.templateRenderer.render('detail', {
      title: `Profile ${profile.token.slice(0, 8)}`,
      profilerPath: this.profilerPath,
      link: (href: string) => appendLinkQuery(href, linkQuery),
      clientScripts: this.clientAssets.list(),
      token: profile.token,
      profile,
      activeTab,
      entrypointTabs,
      entrypointTabTemplate,
      summary,
      collectorPanels,
      collectorData,
      // Which sub-tab of a grouped collector panel (e.g. `mongoose` within Database)
      // is initially active; honoured server-side so a sub-panel is linkable/screenshot-able.
      activeSubTab: subtab ?? tagTab?.subtab ?? null,
    });
  }

  /**
   * The detail tab (and grouped sub-tab) a `?tag=<id>` link should open: the first collector panel
   * whose entries carry that tag, else the Exceptions tab for a profile-level `error`. `undefined`
   * when nothing carries it (keep the default tab) or `tagId` is absent.
   */
  private resolveTagTab(
    profile: Profile,
    panels: CollectorPanelInfo[],
    tagId?: string,
  ): { tab: string; subtab?: string } | undefined {
    if (!tagId) return undefined;
    const carriesTag = (data: unknown): boolean =>
      Array.isArray(data) &&
      data.some(
        (entry) =>
          entry != null &&
          typeof entry === 'object' &&
          Array.isArray((entry as { tags?: ProfilerTag[] }).tags) &&
          (entry as { tags: ProfilerTag[] }).tags.some((t) => t.id === tagId),
      );
    for (const panel of panels) {
      if (panel.isGroup && panel.subPanels) {
        for (const sub of panel.subPanels) {
          if (carriesTag(profile.collectors[sub.name]))
            return { tab: panel.name, subtab: sub.name };
        }
      } else if (carriesTag(profile.collectors[panel.name])) {
        return { tab: panel.name };
      }
    }
    if (tagId === 'error' && profile.exceptions.length > 0) return { tab: 'exceptions' };
    return undefined;
  }
}
