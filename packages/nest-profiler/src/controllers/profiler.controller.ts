import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { TemplateRendererService } from '../services/template-renderer.service';
import { ProfilerCoreService } from '../services/profiler-core.service';
import { ProfilerGuard } from '../guards/profiler.guard';
import type { Profile } from '../interfaces/profile.interface';
import {
  applyListFilters,
  filterAppliesToSection,
  parseFilterValues,
  resolveFilterForSection,
} from '../list-filters/list-filter.utils';
import { bucketProfilesBySection } from '../list-sections/list-section.utils';

/** Universal tabs every profile shows, regardless of its entrypoint kind. */
const UNIVERSAL_TAB_NAMES = ['performance', 'logs', 'exceptions'];

@UseGuards(ProfilerGuard)
@Controller()
export class ProfilerController {
  private readonly profilerPath: string;

  constructor(
    private readonly core: ProfilerCoreService,
    private readonly templateRenderer: TemplateRendererService,
    @Optional() @Inject(NEST_PROFILER_MODULE_OPTIONS) options: ProfilerModuleOptions = {},
  ) {
    this.profilerPath = options.path ?? '/_profiler';
  }

  @Get('/_profiler')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async listProfiles(
    @Query() query: Record<string, string | string[] | undefined>,
  ): Promise<string> {
    const [all, globalPanels] = await Promise.all([
      this.core.storage.findAll(),
      this.core.collectorRegistry.buildGlobalPanels(),
    ]);

    // The heap trend reflects the real process history, so it ignores filters.
    const heapSeries = all
      .slice(-30)
      .map((p) => p.performance.heapUsed)
      .filter((v) => v !== undefined);

    // Each list has its own filter bar: the universal filters (no `forType`) plus
    // the filters scoped to that section's entrypoint kind. Filters apply only to
    // their own section, so query params are namespaced by section key.
    const allFilters = this.core.getListFilters();
    const buckets = bucketProfilesBySection(this.core.getListSections(), all);

    const sections = buckets.map((bucket) => {
      const filterDefs = allFilters
        .filter((f) => filterAppliesToSection(f, bucket.key))
        .map((f) => resolveFilterForSection(f, bucket.profiles));
      const namespaced: Record<string, string | string[] | undefined> = {};
      for (const def of filterDefs) namespaced[def.key] = query[`${bucket.key}_${def.key}`];

      const { active, raw } = parseFilterValues(filterDefs, namespaced);
      return {
        ...bucket,
        total: bucket.profiles.length,
        profiles: applyListFilters(active, bucket.profiles),
        filterDefs,
        filterValues: raw,
        filterPrefix: bucket.key,
        resetHref: this.buildResetHref(query, bucket.key),
      };
    });

    return this.templateRenderer.render('list', {
      title: 'Profiles',
      profilerPath: this.profilerPath,
      sections,
      globalPanels,
      heapSeries,
    });
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

  @Get('/_profiler/:token/data')
  async getProfileData(@Param('token') token: string): Promise<Profile> {
    const profile = await this.core.storage.findOne(token);
    if (!profile) throw new NotFoundException(`Profile "${token}" not found.`);
    return profile;
  }

  @Get('/_profiler/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getProfileDetail(
    @Param('token') token: string,
    @Query('tab') tab?: string,
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
      badge: t.badge?.(profile) ?? null,
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
      token: profile.token,
      profile,
      activeTab,
      entrypointTabs,
      entrypointTabTemplate,
      summary,
      collectorPanels,
      collectorData,
    });
  }
}
