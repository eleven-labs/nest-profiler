# Enable / disable strategies

Both strategies keep `ProfilerService` **injectable everywhere** so `app.useLogger(...)` and any service that injects it keep working whether profiling is on or off. Pick one and apply it consistently to the core module and every collector.

**Approach A is the recommended default — always present it first.** `@nestjs/config` is a first-party Nest package that can be installed **solely** to obtain `ConditionalModule`, without adopting `ConfigModule` or changing how the app loads its configuration. So even an app that has no `@nestjs/config` today should default to Approach A; Approach B is the fallback only when the user declines that one dependency.

Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler>

## Presenting the choice (via `AskUserQuestion`)

Follow these rules exactly — they were the source of past defects:

- **Fixed order**: Approach A in position 1, Approach B in position 2. Never reorder based on how the project currently manages its configuration — that is an argument to state _inside_ B's description, never a reason to promote B to first.
- **Recommendation on the `label`, not the description**: label A `"@nestjs/config + ConditionalModule (recommended)"`, label B `"enabled flag (alternative)"`. A reader must see which is recommended without expanding anything.
- **`header` ≤ 12 characters** or the tool call fails schema validation (e.g. `Activation`).
- **Descriptions are technical and concrete** — state what gets installed and the exact runtime behaviour, not vague adjectives. The substance to convey:
  - **A** — installs `@nestjs/config` (home of `ConditionalModule`); `ProfilerModule` is **never instantiated** when off and `ProfilerNoopModule` supplies the no-op `ProfilerService` in its place; fine-grained gating, zero runtime cost when off.
  - **B** — no dependency added; `ProfilerModule.forRoot({ enabled })` stays loaded but **inert** when off (no CLS, middleware, interceptor, controller or storage); gating at whole-module granularity only.

## `env-condition` helpers — ship these first

Both approaches read `PROFILER_ENABLED` from the environment. Write a small helper module in the consumer's project (e.g. `src/config/env-condition.ts`) so every `ConditionalModule.registerWhen(...)` gate stays readable and consistent. This mirrors the pattern used in the repo's `examples/api`.

```ts title="src/config/env-condition.ts"
export type EnvCondition = (env: NodeJS.ProcessEnv) => boolean;

/** Wraps a predicate with a `toString()` label so ConditionalModule debug logs stay readable. */
export const labeledCondition = (label: string, predicate: EnvCondition): EnvCondition => {
  const condition: EnvCondition = (env) => predicate(env);
  condition.toString = () => label;
  return condition;
};

/** Enabled when the variable is truthy and not `'false'`; otherwise falls back to `defaultValue`. */
export const enabled = (variableName: string, defaultValue = false): EnvCondition =>
  labeledCondition(variableName, (env) => {
    const value = env[variableName] ?? defaultValue;
    return value !== 'false' && Boolean(value);
  });

/** Negates a condition, keeping a readable label (`!LABEL`). */
export const not = (condition: EnvCondition): EnvCondition =>
  labeledCondition(`!${String(condition)}`, (env) => !condition(env));
```

```ts title="src/config/profiler.config.ts"
import { enabled } from './env-condition.js';

// OFF by default → OFF in production if PROFILER_ENABLED is unset. Turn it on for local dev
// by setting PROFILER_ENABLED=true in .env / .env.example (dev only).
export const isProfilerEnabled = enabled('PROFILER_ENABLED');
```

Why `toString()`: NestJS logs a `registerWhen` condition via `String(condition)` at debug level, which otherwise dumps the whole function body. The label keeps logs readable (`PROFILER_ENABLED` instead of the source).

> ⚠️ The repo's `examples/api` sets `enabled('PROFILER_ENABLED', true)` (**on by default**) because that app exists to _demo_ the profiler live. For a real application keep the default `false` so a production deploy that forgets the variable stays off.

## Approach A — RECOMMENDED: `ConditionalModule` + `ProfilerNoopModule`

Requires `@nestjs/config` (that is where `ConditionalModule` lives). The active `ProfilerModule` is **never loaded** when profiling is off; `ProfilerNoopModule` supplies the zero-dependency no-op `ProfilerService` in its place.

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule, ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { ConditionalModule } from '@nestjs/config';
import { isProfilerEnabled } from './config/profiler.config.js';
import { not } from './config/env-condition.js';

@Module({
  imports: [
    ConditionalModule.registerWhen(ProfilerModule.forRoot({ isGlobal: true }), isProfilerEnabled),
    ConditionalModule.registerWhen(
      ProfilerNoopModule.forRoot({ isGlobal: true }),
      not(isProfilerEnabled),
    ),
  ],
})
export class AppModule {}
```

Rules:

- The condition is a plain `(env: NodeJS.ProcessEnv) => boolean`. `ConditionalModule` reads env **after** `.env` is loaded — pass the function, not a pre-computed boolean.
- Register `ProfilerNoopModule.forRoot({ isGlobal: true })` with the **same `isGlobal`** as the active module, gated on `not(isProfilerEnabled)`.
- Gate each optional collector the same way (`ConditionalModule.registerWhen(..., isProfilerEnabled)`). Collectors need **no** no-op counterpart.
- When options depend on injected providers (e.g. `ConfigService`), use `ProfilerModule.forRootAsync({ isGlobal: true, inject: [...], useFactory: ... })`. `isGlobal` stays a top-level key, outside the factory.
- **CLI apps (`nest-commander` / `CommandFactory`):** `registerWhen` `await`s `ConfigModule.envVariablesLoaded`, which only resolves once `@nestjs/config`'s `ConfigModule.forRoot()` has run. An HTTP root module usually imports it already; a `CommandFactory` CLI often does not — and without it registration hangs and the process exits `0` **silently** (no logs, no error; the internal timeout is `unref`'d). Import `ConfigModule.forRoot()` in any CLI root module that gates something with `registerWhen` (core, DB, RabbitMQ collectors…).

## Approach B — ALTERNATIVE: the `enabled` flag (no `@nestjs/config`)

Use only when the user declines `@nestjs/config`. Approach A stays the default even for an app that has no `@nestjs/config` today — it is a first-party Nest package that can be installed **solely** for `ConditionalModule`, without adopting `ConfigModule`. So before falling back here, offer the choice; do not pick silently.

`enabled` is a **synchronous, top-level** bootstrap flag: when `false`, the core registers only an inert layer that binds `ProfilerService` to the same no-op service (no CLS, no middleware/interceptor/controller/storage/collectors).

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { enabled } from './config/env-condition.js';

@Module({
  imports: [
    ProfilerModule.forRoot({
      isGlobal: true,
      // OFF by default; PROFILER_ENABLED=true turns it on. Still just an env read at bootstrap.
      enabled: enabled('PROFILER_ENABLED')(process.env),
    }),
  ],
})
export class AppModule {}
```

Rules:

- `enabled` must be known **before** the async factory runs — with `forRootAsync` it stays a top-level key, it is **not** resolved inside `useFactory`.
- For collectors, either gate them with your own `enabled`-style condition or accept that they are cheap no-ops when the core is inert. Prefer A whenever `@nestjs/config` is available.

## Bundling pattern — keep the root tidy (`ProfilingModule`)

Group the core module and the **root-level** collectors (config, validator, commander, routes…) into one module so the composition root keeps just two profiler entries (active bundle + no-op fallback). Infra-scoped collectors stay in their feature modules, each with their own gate. Two static factories keep the web and CLI processes distinct (the CLI defaults to file/sqlite storage so its profiles show up in the web UI). The CLI composition root (`CommandFactory.run(...)`) must import `ConfigModule.forRoot()` — the gates rely on it (see the CLI note under Approach A).

```ts title="src/profiling/profiling.module.ts"
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { ConfigCollectorModule } from '@eleven-labs/nest-profiler-config';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';
import { CommanderCollectorModule } from '@eleven-labs/nest-profiler-commander';
import { RoutesCollectorModule } from '@eleven-labs/nest-profiler-routes';

@Module({})
export class ProfilingModule {
  /** Web app bundle: core profiler + the root-level collectors. */
  static forWeb(): DynamicModule {
    return {
      module: ProfilingModule,
      imports: [
        ProfilerModule.forRootAsync({
          isGlobal: true,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            storageType: config.get('profiler.storageType') ?? 'memory',
            // Lock the UI down in any non-local environment — see "Securing the UI" in core-options.md.
            // e.g. reuse an app guard: security: { guards: [JwtAuthGuard] }
          }),
        }),
        ConfigCollectorModule.forRoot({ maskKeys: ['database.password'] }),
        // Panel only — the app owns the validation pipe in main.ts, so validation survives the gate.
        ValidatorCollectorModule.forRoot(),
        RoutesCollectorModule.forRoot(),
        CommanderCollectorModule.forRoot(),
      ],
    };
  }
}
```

Since the bundle is gated, install the validation pipe in `main.ts` (not the module) so it runs even when the profiler is off:

```ts title="src/main.ts"
import {
  createProfilerValidationPipe,
  createClassValidatorPipe,
} from '@eleven-labs/nest-profiler-validator';

app.useGlobalPipes(
  createProfilerValidationPipe(createClassValidatorPipe({ whitelist: true, transform: true })),
);
```

```ts title="app.module.ts"
ConditionalModule.registerWhen(ProfilingModule.forWeb(), isProfilerEnabled),
ConditionalModule.registerWhen(ProfilerNoopModule.forRoot({ isGlobal: true }), not(isProfilerEnabled)),
```

The full worked example (web + CLI bundles, `ConfigService`-driven storage, sqlite adapter) lives in the repo at `examples/api/src/profiling/profiling.module.ts`.
