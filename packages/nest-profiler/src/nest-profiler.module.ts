import {
  DynamicModule,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  ApplicationConfig,
  DiscoveryModule,
} from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import {
  ConfigurableModuleClass,
  NEST_PROFILER_MODULE_OPTIONS,
  PROFILER_ENABLED,
} from './nest-profiler.builder';
import type { ProfilerModuleAsyncOptions, ProfilerModuleOptions } from './nest-profiler.builder';
import { ProfilerStorageService } from './services/profiler-storage.service';
import { ProfilerService } from './services/nest-profiler.service';
import { NoopProfilerService } from './services/noop-profiler.service';
import { ProfilerMiddleware } from './middleware/profiler.middleware';
import { ProfilerInterceptor } from './interceptors/profiler.interceptor';
import { ProfilerExceptionFilter } from './exception-filters/profiler-exception.filter';
import { ProfilerController } from './controllers/profiler.controller';
import { ProfilerGuard } from './guards/profiler.guard';
import { ProfilerLifecycleGuard } from './guards/profiler-lifecycle.guard';
import { CollectorRegistry } from './collectors/collector-registry.service';
import { RouteCollector } from './collectors/route.collector';
import { TemplateRendererService } from './services/template-renderer.service';
import { ClientAssetRegistry } from './services/client-asset-registry.service';
import { ProfilerCoreService } from './services/profiler-core.service';
import { PROFILER_STORAGE_ADAPTER, FileStorageAdapter } from './storage';
import { TimelineCollector } from './collectors/timeline/timeline.collector';
import { PROFILER_BASE_PATH } from './constants';

/** The entry shape `setGlobalPrefix()` stores, read off Nest's own signature. */
type ExcludedRoute = NonNullable<
  ReturnType<ApplicationConfig['getGlobalPrefixOptions']>['exclude']
>[number];

/**
 * The profiler's routes, in the shape `setGlobalPrefix()` stores its exclusions. The `pathRegex`
 * is spelled out by hand — the path is a fixed literal, so we avoid pulling in Nest's internal
 * `path-to-regexp` conversion — covering `/_profiler` and everything nested under it.
 */
const PROFILER_GLOBAL_PREFIX_EXCLUSIONS: ExcludedRoute[] = [
  {
    path: PROFILER_BASE_PATH,
    requestMethod: RequestMethod.ALL,
    pathRegex: new RegExp(`^${PROFILER_BASE_PATH}$`),
  },
  {
    path: `${PROFILER_BASE_PATH}/*path`,
    requestMethod: RequestMethod.ALL,
    pathRegex: new RegExp(`^${PROFILER_BASE_PATH}/.*$`),
  },
];

@Module({})
export class ProfilerModule extends ConfigurableModuleClass implements NestModule {
  constructor(
    @Inject(PROFILER_ENABLED) private readonly enabled: boolean,
    private readonly appConfig: ApplicationConfig,
  ) {
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
        ProfilerLifecycleGuard,
        { provide: APP_GUARD, useExisting: ProfilerLifecycleGuard },
        ProfilerExceptionFilter,
        { provide: APP_FILTER, useExisting: ProfilerExceptionFilter },
      ],
      exports: [
        ProfilerService,
        ProfilerStorageService,
        CollectorRegistry,
        TemplateRendererService,
        ClientAssetRegistry,
        ProfilerCoreService,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    if (!this.enabled) return;
    this.excludeFromGlobalPrefix();
    // Keeps the profiler from profiling its own UI.
    consumer
      .apply(ProfilerMiddleware)
      .exclude(
        { path: PROFILER_BASE_PATH, method: RequestMethod.ALL },
        { path: `${PROFILER_BASE_PATH}/*path`, method: RequestMethod.ALL },
      )
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }

  /**
   * Opts the profiler out of the host's `setGlobalPrefix()` so the UI stays at `/_profiler`, with
   * nothing for the app to declare. Everything pointing at {@link PROFILER_BASE_PATH} (asset links,
   * the toolbar, the `X-Debug-Token-Link` header) then stays valid.
   *
   * Relies on ordering: `configure()` runs before `registerRouter()` builds the routes, and
   * `RoutePathFactory` re-reads the exclusion list per route — so an entry added here is honoured.
   * We merge into the host's options (already carrying its own `setGlobalPrefix()` call) rather
   * than replacing them.
   */
  private excludeFromGlobalPrefix(): void {
    const options = this.appConfig.getGlobalPrefixOptions();
    const exclude = options.exclude ?? [];
    // The app may already have excluded the profiler by hand — don't duplicate its entry.
    if (exclude.some((route) => route.pathRegex?.test(PROFILER_BASE_PATH))) return;

    this.appConfig.setGlobalPrefixOptions({
      ...options,
      exclude: [...exclude, ...PROFILER_GLOBAL_PREFIX_EXCLUSIONS],
    });
  }
}
