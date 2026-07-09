import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Query,
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
import { ProfilerGuard } from '../guards/profiler.guard';
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

  constructor(
    private readonly core: ProfilerCoreService,
    private readonly templateRenderer: TemplateRendererService,
    private readonly clientAssets: ClientAssetRegistry,
    @Inject(NEST_PROFILER_MODULE_OPTIONS) options: ProfilerModuleOptions,
  ) {
    this.pageSize = options.listPageSize ?? DEFAULT_LIST_PAGE_SIZE;
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
  ): Promise<string> {
    const allSections = this.core.getListSections();

    // Fetch only the 30 most-recent profiles for the heap trend — never the whole store.
    // `findAll()` would defeat the SQLite query pushdown (SELECT without LIMIT + JSON.parse
    // of every document) on the dashboard's own hot path.
    const [recentPage, globalPanels] = await Promise.all([
      this.core.storage.query({ filters: [], page: 1, pageSize: 30 }),
      this.core.collectorRegistry.buildGlobalPanels(),
    ]);

    // The heap trend reflects the real process history, so it ignores filters. `query()`
    // returns newest-first; reverse to plot oldest → newest.
    const heapSeries = recentPage.items
      .map((p) => p.performance.heapUsed)
      .filter((v) => v !== undefined)
      .reverse();

    // Each section is an independent list: it queries the store for its own page,
    // scoped to its entrypoint type(s), with its own namespaced filter/page params
    // (`<sectionKey>_<key>`). Filtering and pagination are pushed to the storage
    // adapter (native when supported, in-memory fallback otherwise).
    const sections = await Promise.all(
      allSections.map((section) => this.buildSection(section, allSections, query)),
    );

    return this.templateRenderer.render('list', {
      title: 'Profiles',
      profilerPath: this.profilerPath,
      clientScripts: this.clientAssets.list(),
      sections,
      globalPanels,
      heapSeries,
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
    @Param('token') token: string,
    @Query('tab') tab?: string,
    @Query('subtab') subtab?: string,
  ): Promise<string> {
    const profile = await this.core.storage.findOne(token);
    if (!profile) throw new NotFoundException(`Profile "${token}" not found.`);

    const collectorPanels = this.core.collectorRegistry.buildPanels(profile);
    const collectorTabNames = collectorPanels.map((p) => p.name);

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
    const activeTab = tab ?? defaultTab;

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
      activeSubTab: subtab ?? null,
    });
  }
}
