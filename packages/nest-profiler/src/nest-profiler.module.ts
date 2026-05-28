import {
  DynamicModule,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DiscoveryModule } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import {
  ConfigurableModuleClass,
  NEST_PROFILER_MODULE_OPTIONS,
  PROFILER_ENABLED,
} from './nest-profiler.builder';
import type { ProfilerModuleAsyncOptions, ProfilerModuleOptions } from './nest-profiler.builder';
import { ProfilerStorageService } from './services/profiler-storage.service';
import { ProfilerService } from './services/nest-profiler.service';
import { ProfilerMiddleware } from './middleware/profiler.middleware';
import { ProfilerInterceptor } from './interceptors/profiler.interceptor';
import { ProfilerController } from './controllers/profiler.controller';
import { ProfilerGuard } from './guards/profiler.guard';
import { CollectorRegistry } from './collectors/collector-registry.service';
import { RouteCollector } from './collectors/route.collector';
import { TemplateRendererService } from './services/template-renderer.service';
import { ProfilerCoreService } from './services/profiler-core.service';
import { PROFILER_STORAGE_ADAPTER, FileStorageAdapter } from './storage';
import { TimelineCollector } from './collectors/timeline/timeline.collector';

// Minimal CLS setup shared by both layers: the profiler manages its own
// lifecycle, so nestjs-cls auto-mounting is disabled.
const clsImport = ClsModule.forRoot({
  global: true,
  middleware: { mount: false },
  guard: { mount: false },
  interceptor: { mount: false },
});

// Providers/imports/controllers that make up the ACTIVE layer. They are kept
// out of the @Module decorator on purpose: NestJS merges decorator metadata
// with the DynamicModule returned by forRoot, so anything declared there would
// leak into the inert layer (controller routes, global interceptor, …).
const activeImports = [clsImport, DiscoveryModule];

const activeControllers = [ProfilerController];

const activeProviders = [
  {
    provide: PROFILER_STORAGE_ADAPTER,
    inject: [NEST_PROFILER_MODULE_OPTIONS],
    useFactory: (opts: ProfilerModuleOptions) => {
      // Explicit custom adapter takes full precedence
      if (opts.storage) return opts.storage;
      // Convenience: storageType: 'file'
      if (opts.storageType === 'file') {
        return new FileStorageAdapter({
          storagePath: opts.storagePath,
          maxProfiles: opts.maxProfiles,
          ttl: opts.ttl,
        });
      }
      // Default: undefined → ProfilerStorageService falls back to MemoryStorageAdapter
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
  ProfilerCoreService,
  TimelineCollector,
  {
    provide: APP_INTERCEPTOR,
    useClass: ProfilerInterceptor,
  },
];

const activeExports = [
  ProfilerService,
  ProfilerStorageService,
  CollectorRegistry,
  TemplateRendererService,
  ProfilerCoreService,
];

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
   * Composes the final module from the ConfigurableModuleBuilder `base`
   * (which already provides the resolved options token) and the synchronous
   * `enabled` decision. When disabled, only the inert layer is registered so
   * {@link ProfilerService} stays injectable everywhere while staying a no-op.
   */
  private static build(
    base: DynamicModule,
    options: { enabled?: boolean; isGlobal?: boolean },
  ): DynamicModule {
    const enabled = options.enabled !== false;
    const global = options.isGlobal ?? false;
    const baseProviders = base.providers ?? [];

    if (!enabled) {
      return {
        module: ProfilerModule,
        global,
        imports: [clsImport],
        providers: [
          { provide: PROFILER_ENABLED, useValue: false },
          ...baseProviders,
          ProfilerService,
        ],
        exports: [ProfilerService],
      };
    }

    return {
      ...base,
      module: ProfilerModule,
      global,
      imports: [...(base.imports ?? []), ...activeImports],
      controllers: activeControllers,
      providers: [
        { provide: PROFILER_ENABLED, useValue: true },
        ...baseProviders,
        ...activeProviders,
      ],
      exports: activeExports,
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    if (!this.enabled) return;
    consumer
      .apply(ProfilerMiddleware)
      .exclude(
        { path: '_profiler', method: RequestMethod.ALL },
        { path: '_profiler/*path', method: RequestMethod.ALL },
      )
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
