import {
  DynamicModule,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, ApplicationConfig, DiscoveryModule } from '@nestjs/core';
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
 * The profiler's own routes, in the shape `setGlobalPrefix()` stores its exclusions.
 *
 * Nest compiles these with `path-to-regexp` when an app writes them by hand; the patterns are
 * spelled out here instead so the package does not reach into that internal helper. They cover a
 * fixed, literal path — `/_profiler` itself and everything nested under it (`/:token`, the JSON
 * export, `/__assets/*`) — so there is no user input to translate.
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
   * Opts the profiler out of the host's `setGlobalPrefix()`, so the UI is always at `/_profiler`
   * whatever the app prefixes its own API with — and without the app having to declare anything.
   *
   * The profiler is tooling, not part of the API surface, so it has no business living under
   * `/api/v1`. Left alone, Nest prefixes it like any other controller, which both moves the UI and
   * strands everything that points at the fixed {@link PROFILER_BASE_PATH} (asset links, the
   * injected toolbar, the `X-Debug-Token-Link` header). Excluding it keeps that constant true.
   *
   * Timing is what makes this work: `configure()` runs inside `registerModules()`, before
   * `registerRouter()` builds the routes, and `RoutePathFactory` re-reads the exclusion list for
   * every route it creates — so an entry added here is honoured. `setGlobalPrefix()` has already
   * run by then (it happens on the app instance before `listen()`), hence merging into the host's
   * options rather than replacing them.
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
