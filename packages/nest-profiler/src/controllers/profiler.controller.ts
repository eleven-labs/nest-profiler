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
import { applyListFilters, parseFilterValues } from '../list-filters/list-filter.utils';

const BUILTIN_TAB_NAMES = ['command', 'request', 'response', 'performance', 'logs', 'exceptions'];

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
    const filterDefs = this.core.getListFilters();
    const { active, raw } = parseFilterValues(filterDefs, query);

    const [all, globalPanels] = await Promise.all([
      this.core.storage.findAll(),
      this.core.collectorRegistry.buildGlobalPanels(),
    ]);

    // The heap trend reflects the real process history, so it ignores filters.
    const heapSeries = all
      .slice(-30)
      .map((p) => p.performance.heapUsed)
      .filter((v) => v !== undefined);

    // Filters apply uniformly to HTTP/GraphQL requests and CLI commands; the
    // template splits the filtered set into its two tables.
    const filtered = applyListFilters(active, all);
    const commandProfiles = filtered.filter((p) => p.request.command);

    return this.templateRenderer.render('list', {
      title: 'Profiles',
      profilerPath: this.profilerPath,
      profiles: filtered,
      commandProfiles,
      globalPanels,
      heapSeries,
      filterDefs,
      filterValues: raw,
    });
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

    // Commands have no request/response tabs — land on the built-in Command tab.
    const isCommand = profile.request.command !== undefined;
    const activeTab = tab ?? (isCommand ? 'command' : 'request');

    const isCollectorTab =
      collectorTabNames.includes(activeTab) && !BUILTIN_TAB_NAMES.includes(activeTab);

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
      collectorPanels,
      collectorData,
    });
  }
}
