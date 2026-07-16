import { timingSafeEqual } from 'node:crypto';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProfilerModule, combineFilters } from '@eleven-labs/nest-profiler';
import type { PlatformRequest, ProfilerModuleOptions } from '@eleven-labs/nest-profiler';
import { SqliteStorageAdapter } from '@eleven-labs/nest-profiler/sqlite';
import type { ProfilerAuth } from '../config/features.config.js';
import { JwtAuthGuard } from '../auth/http/jwt-auth.guard.js';
import {
  ignoreGraphQLPlayground,
  ignoreGraphQLIntrospection,
} from '@eleven-labs/nest-profiler-graphql';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';
import { CommanderCollectorModule } from '@eleven-labs/nest-profiler-commander';
import { RoutesCollectorModule } from '@eleven-labs/nest-profiler-routes';

/**
 * Resolves the storage-related profiler options from config. `sqlite` is opted into via
 * the `storage` adapter instance (the core module never imports `@libsql/client`); `file`
 * and `memory` go through the built-in `storageType`. The one SQLite adapter serves both a
 * local file and a remote SQLite database — pass `PROFILER_STORAGE_URL` to target the latter.
 */
function resolveStorageOptions(config: ConfigService): Partial<ProfilerModuleOptions> {
  const storageType = config.get<'memory' | 'file' | 'sqlite'>('profiler.storage.type');
  const maxProfiles = config.get<number>('profiler.storage.maxProfiles');

  if (storageType === 'sqlite') {
    const storageUrl = config.get<string>('profiler.storage.url');
    return {
      storage: new SqliteStorageAdapter({
        // A remote SQLite URL takes precedence over the local file path.
        ...(storageUrl
          ? { url: storageUrl, authToken: config.get<string>('profiler.storage.authToken') }
          : { path: config.get<string>('profiler.storage.path') }),
        maxProfiles,
        ttl: config.get<number>('profiler.storage.ttl'),
      }),
      maxProfiles,
    };
  }

  return {
    storageType,
    ...(storageType === 'file' && {
      storagePath: config.get<string>('profiler.storage.path'),
      ttl: config.get<number>('profiler.storage.ttl'),
    }),
    maxProfiles,
  };
}

type ProfilerSecurity = ProfilerModuleOptions['security'];

/**
 * `basic` — HTTP Basic auth with a configurable `user`/`password`
 * (`PROFILER_BASIC_USER` / `PROFILER_BASIC_PASSWORD`). The browser-friendly path: the browser
 * prompts once, then re-sends the credential on every link (pages, tabs, the JSON export)
 * automatically, so nothing has to be threaded through the UI. Test with `curl -u user:password`.
 * Falls back to open when no password is configured.
 */
function basicAuthSecurity(user: string, password: string): ProfilerSecurity {
  if (!password) return undefined;

  const expected = Buffer.from(`${user}:${password}`);

  return {
    authorize: ({ request, response }) => {
      const header = request.headers['authorization'];
      const provided = Buffer.from(
        typeof header === 'string' && header.startsWith('Basic ')
          ? Buffer.from(header.slice(6), 'base64').toString('utf8')
          : '',
      );
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
      response.setHeader('WWW-Authenticate', 'Basic realm="Profiler"');
      return false;
    },
  };
}

/**
 * `token` — a bearer token (API/CLI) or a `?token=` query (browser), checked against the configured
 * `PROFILER_TOKEN`. `linkQuery` threads the query credential across the UI links so query-param
 * navigation keeps working. Falls back to open when no token is configured.
 */
function tokenQuerySecurity(expected: string): ProfilerSecurity {
  if (!expected) return undefined;

  const tokenOf = (request: PlatformRequest): string | undefined => {
    const auth = request.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
    const q = request.query?.['token'];
    return Array.isArray(q) ? q[0] : q;
  };

  return {
    authorize: ({ request }) => tokenOf(request) === expected,
    linkQuery: (request) => {
      const t = tokenOf(request);
      return t ? `?token=${encodeURIComponent(t)}` : '';
    },
  };
}

/**
 * Demo access control for /_profiler, selected by `PROFILER_AUTH` (mirrors how `SQL_ORM` picks an
 * adapter) — see {@link ProfilerAuth}. The strategy and its credentials come from the `profiler`
 * config namespace's `security` object (see profiler.config.ts). Disabled by default (`none`): the dashboard is open. `cookie` reuses the
 * app's own `JwtAuthGuard` through the profiler's `security.guards`; the guard reads the JWT from the
 * `profiler_jwt` cookie (set by `GET /api/v1/auth/token`) so the dashboard is browser-navigable, and
 * still accepts a Bearer header for API clients.
 */
function resolveProfilerSecurity(config: ConfigService): ProfilerSecurity {
  switch (config.get<ProfilerAuth>('profiler.security.auth') ?? 'none') {
    case 'basic':
      return basicAuthSecurity(
        config.get<string>('profiler.security.basicAuth.user') ?? 'admin',
        config.get<string>('profiler.security.basicAuth.password') ?? '',
      );
    case 'token':
      return tokenQuerySecurity(config.get<string>('profiler.security.token') ?? '');
    case 'cookie':
      return { guards: [JwtAuthGuard] };
    case 'none':
    default:
      return undefined;
  }
}

/**
 * Bundles the profiler modules that belong at the composition root — the core `ProfilerModule` plus
 * the global collectors (config, validator, commander) — into a single module. It carries **no**
 * `ConditionalModule` itself: the composition root gates the whole bundle with one
 * `ConditionalModule.registerWhen(ProfilingModule.forWeb(), isProfilerEnabled)` and pairs it with
 * `ProfilerNoopModule` for the off state — so the root keeps just two profiler-related entries.
 *
 * Infra-scoped collectors (http, cache, database, rabbitmq, graphql transport) stay co-located in
 * the bounded-context modules that own their infrastructure — they are gated by their own feature
 * flags (`SQL_ORM`, `FEATURE_MONGOOSE`…) on top of the profiler flag, so they cannot be hoisted here.
 */
@Module({})
export class ProfilingModule {
  /** Web app bundle: core profiler + config, validator and commander collectors. */
  static forWeb(): DynamicModule {
    return {
      module: ProfilingModule,
      imports: [
        ProfilerModule.forRootAsync({
          isGlobal: true,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            ...resolveStorageOptions(config),
            // Demo captures bodies for a richer UI. In production, prefer `collectBody: false`
            // (or a small `maxBodySize`) and ALWAYS lock the dashboard — which exposes captured
            // requests — behind `security` (see `resolveProfilerSecurity` above).
            collectBody: true,
            security: resolveProfilerSecurity(config),
            sampleRate: 1.0,
            ignorePaths: ['/favicon.ico'],
            ignoreRequest: combineFilters(ignoreGraphQLPlayground, ignoreGraphQLIntrospection),
            // What counts as a failed request. The default (5xx, so a 404 is an answer rather
            // than an error) is what most apps want; this demo also flags 429 to show that a
            // predicate can pick out individual statuses.
            error: { httpStatus: (statusCode) => statusCode >= 500 || statusCode === 429 },
          }),
        }),
        ConfigCollectorModule.forRoot({ maskKeys: ['database.password'] }),
        RoutesCollectorModule.forRoot(),
        // Panel only — the app owns the validation pipe in main.ts, so validation runs profiler-off.
        ValidatorCollectorModule.forRoot(),
        CommanderCollectorModule.forRoot(),
      ],
    };
  }

  /** CLI bundle: core profiler (file storage by default) + the commander collector. */
  static forCli(): DynamicModule {
    return {
      module: ProfilingModule,
      imports: [
        ProfilerModule.forRootAsync({
          isGlobal: true,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => resolveStorageOptions(config),
        }),
        CommanderCollectorModule.forRoot(),
      ],
    };
  }
}
