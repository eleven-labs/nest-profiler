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
import { ProfilerFiltersQuery } from './profiler-filters.query';
import type { Profile } from '../interfaces/profile.interface';
import type { StorageFindOptions } from '../storage/storage-adapter.interface';

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
  async listProfiles(@Query() query: ProfilerFiltersQuery): Promise<string> {
    const filters: StorageFindOptions = {};
    if (query.method) filters.method = query.method;
    if (query.statusCode) filters.statusCode = parseInt(query.statusCode, 10);
    if (query.minDuration) filters.minDuration = parseInt(query.minDuration, 10);
    if (query.maxDuration) filters.maxDuration = parseInt(query.maxDuration, 10);
    if (query.url) filters.urlPattern = query.url;

    const hasFilters = Object.keys(filters).length > 0;

    const [profiles, globalPanels] = await Promise.all([
      this.core.storage.findAll(hasFilters ? filters : undefined),
      this.core.collectorRegistry.buildGlobalPanels(),
    ]);

    const allRecent = hasFilters ? await this.core.storage.findAll() : profiles;
    const heapSeries = allRecent
      .slice(-30)
      .map((p) => p.performance.heapUsed)
      .filter((v) => v !== undefined);

    // CLI commands are listed in a dedicated table, independent of the HTTP filters.
    const commandProfiles = allRecent.filter((p) => p.request.command);

    return this.templateRenderer.render('list', {
      title: 'Profiles',
      profilerPath: this.profilerPath,
      profiles,
      commandProfiles,
      globalPanels,
      heapSeries,
      filters: {
        method: query.method,
        statusCode: query.statusCode,
        minDuration: query.minDuration,
        maxDuration: query.maxDuration,
        url: query.url,
      },
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
