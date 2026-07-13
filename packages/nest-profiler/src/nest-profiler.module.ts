import {
  DynamicModule,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import {
  ConfigurableModuleClass,
  NEST_PROFILER_MODULE_OPTIONS,
  PROFILER_ENABLED,
} from './nest-profiler.builder';
import type { ProfilerModuleAsyncOptions, ProfilerModuleOptions } from './nest-profiler.builder';
import { ProfilerStorageService } from './services/profiler-storage.service';
import { SummaryService } from './services/summary.service';
import { ProfilerService } from './services/nest-profiler.service';
import { NoopProfilerService } from './services/noop-profiler.service';
import { ProfilerMiddleware } from './middleware/profiler.middleware';
import { ProfilerInterceptor } from './interceptors/profiler.interceptor';
import { ProfilerExceptionFilter } from './exception-filters/profiler-exception.filter';
import { ProfilerController } from './controllers/profiler.controller';
import { ProfilerGuard } from './guards/profiler.guard';
import { CollectorRegistry } from './collectors/collector-registry.service';
import { RouteCollector } from './collectors/route.collector';
import { TemplateRendererService } from './services/template-renderer.service';
import { ClientAssetRegistry } from './services/client-asset-registry.service';
import { ProfilerCoreService } from './services/profiler-core.service';
import { PROFILER_STORAGE_ADAPTER, FileStorageAdapter } from './storage';
import { TimelineCollector } from './collectors/timeline/timeline.collector';
import { PROFILER_BASE_PATH } from './constants';

@Module({})
export class ProfilerModule extends ConfigurableModuleClass implements NestModule {
  constructor(@Inject(PROFILER_ENABLED) private readonly enabled: boolean) {
    super();
  }

  static forRoot(options: ProfilerModuleOptions = {}): DynamicModule {
    return ProfilerModule.build(super.forRoot(options), options);
  }

  static forRootAsync(options: ProfilerModuleAsyncOptions): DynamicModule {
    return ProfilerModule.build(super.forRootAsync(options), options);
  }

  /**
   * Registers the active layer, or an inert no-op layer when `enabled` is false.
   * Either way {@link ProfilerService} stays injectable.
   */
  private static build(
    base: DynamicModule,
    options: { enabled?: boolean; isGlobal?: boolean },
  ): DynamicModule {
    const enabled = options.enabled !== false;
    const global = options.isGlobal ?? false;

    if (!enabled) {
      // Inert layer: a no-op ProfilerService with no dependencies — no ClsModule,
      // and the async options factory never runs, so the disabled path costs nothing.
      return {
        module: ProfilerModule,
        global,
        providers: [
          { provide: PROFILER_ENABLED, useValue: false },
          { provide: ProfilerService, useClass: NoopProfilerService },
        ],
        exports: [ProfilerService],
      };
    }

    // Active layer. Declared here, not on the @Module() decorator: NestJS merges
    // decorator metadata into every DynamicModule the class returns, so it would
    // otherwise leak into the inert layer above and defeat the zero-cost path.
    return {
      ...base,
      module: ProfilerModule,
      global,
      imports: [
        ...(base.imports ?? []),
        // The profiler manages its own lifecycle, so disable nestjs-cls auto-mounting.
        ClsModule.forRoot({
          global: true,
          middleware: { mount: false },
          guard: { mount: false },
          interceptor: { mount: false },
        }),
        DiscoveryModule,
      ],
      controllers: [ProfilerController],
      providers: [
        { provide: PROFILER_ENABLED, useValue: true },
        ...(base.providers ?? []),
        {
          provide: PROFILER_STORAGE_ADAPTER,
          inject: [NEST_PROFILER_MODULE_OPTIONS],
          useFactory: (opts: ProfilerModuleOptions) => {
            // A custom adapter wins; otherwise `storageType: 'file'` builds a file adapter.
            if (opts.storage) return opts.storage;
            if (opts.storageType === 'file') {
              return new FileStorageAdapter({
                storagePath: opts.storagePath,
                maxProfiles: opts.maxProfiles,
                ttl: opts.ttl,
              });
            }
            // undefined → ProfilerStorageService falls back to the in-memory adapter.
            return undefined;
          },
        },
        ProfilerStorageService,
        SummaryService,
        ProfilerService,
        ProfilerMiddleware,
        ProfilerGuard,
        CollectorRegistry,
        RouteCollector,
        TemplateRendererService,
        ClientAssetRegistry,
        ProfilerCoreService,
        TimelineCollector,
        ProfilerInterceptor,
        { provide: APP_INTERCEPTOR, useExisting: ProfilerInterceptor },
        ProfilerExceptionFilter,
        { provide: APP_FILTER, useExisting: ProfilerExceptionFilter },
      ],
      exports: [
        ProfilerService,
        ProfilerStorageService,
        SummaryService,
        CollectorRegistry,
        TemplateRendererService,
        ClientAssetRegistry,
        ProfilerCoreService,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    if (!this.enabled) return;
    consumer
      .apply(ProfilerMiddleware)
      .exclude(
        { path: PROFILER_BASE_PATH, method: RequestMethod.ALL },
        { path: `${PROFILER_BASE_PATH}/*path`, method: RequestMethod.ALL },
      )
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
