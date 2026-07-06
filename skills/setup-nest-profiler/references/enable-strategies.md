# Enable / disable strategies

Both strategies keep `ProfilerService` **injectable everywhere** so `app.useLogger(...)` and any service that injects it keep working whether profiling is on or off. Pick one and apply it consistently to the core module and every collector.

## Approach A — RECOMMENDED: `ConditionalModule` + `ProfilerNoopModule`

Requires `@nestjs/config` (that is where `ConditionalModule` lives). The active `ProfilerModule` is **never loaded** when profiling is off; `ProfilerNoopModule` supplies the zero-dependency no-op `ProfilerService` in its place.

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { ConditionalModule } from '@nestjs/config';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [
    ConditionalModule.registerWhen(ProfilerModule.forRoot({ isGlobal: true }), isProfilerEnabled),
    ConditionalModule.registerWhen(
      ProfilerNoopModule.forRoot({ isGlobal: true }),
      (env) => !isProfilerEnabled(env),
    ),
  ],
})
export class AppModule {}
```

Rules:

- The condition is a plain `(env: NodeJS.ProcessEnv) => boolean`. `ConditionalModule` reads env **after** `.env` is loaded — pass the function, not a pre-computed boolean.
- Register `ProfilerNoopModule.forRoot({ isGlobal: true })` with the **same `isGlobal`** as the active module.
- Gate each optional collector the same way. Collectors need **no** no-op counterpart.
- When options depend on injected providers (e.g. `ConfigService`), use `ProfilerModule.forRootAsync({ isGlobal: true, inject: [...], useFactory: ... })`. `isGlobal` stays a top-level key, outside the factory.

## Approach B — ALTERNATIVE: the `enabled` flag (no `@nestjs/config`)

Use when the app does not have `@nestjs/config`. Before falling back to this, **offer the user the choice**: adding `@nestjs/config` unlocks the recommended Approach A (finer gating, the active module never loads when off); staying without it means this `enabled` flag. Do not pick silently — surface the trade-off and let them decide.

`enabled` is a **synchronous, top-level** bootstrap flag: when `false`, the core registers only an inert layer that binds `ProfilerService` to the same no-op service (no CLS, no middleware/interceptor/controller/storage/collectors).

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';

@Module({
  imports: [
    ProfilerModule.forRoot({
      isGlobal: true,
      enabled: process.env.NODE_ENV !== 'production',
    }),
  ],
})
export class AppModule {}
```

Rules:

- `enabled` must be known **before** the async factory runs — with `forRootAsync` it stays a top-level key, it is **not** resolved inside `useFactory`.
- For collectors, either gate them with your own `enabled`-style condition or accept that they are cheap no-ops when the core is inert. Prefer A whenever `@nestjs/config` is available.

## Bundling pattern — keep the root tidy (`ProfilingModule`)

Group the core module and the **root-level** collectors (config, validator, commander…) into one module so the composition root keeps just two profiler entries (active bundle + no-op fallback). Infra-scoped collectors stay in their feature modules.

```ts title="profiling.module.ts"
import { DynamicModule, Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

@Module({})
export class ProfilingModule {
  static forRoot(): DynamicModule {
    return {
      module: ProfilingModule,
      imports: [
        ProfilerModule.forRoot({ isGlobal: true }),
        ConfigCollectorModule.forRoot(),
        ValidatorCollectorModule.forRoot(),
      ],
    };
  }
}
```

```ts title="app.module.ts"
ConditionalModule.registerWhen(ProfilingModule.forRoot(), isProfilerEnabled),
ConditionalModule.registerWhen(
  ProfilerNoopModule.forRoot({ isGlobal: true }),
  (env) => !isProfilerEnabled(env),
),
```
