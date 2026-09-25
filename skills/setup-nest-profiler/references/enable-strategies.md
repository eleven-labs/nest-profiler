# Install and enable strategies

The profiler is a development tool. How it is installed — and therefore how it is turned off in production — depends on one question: **does production code call the profiler?**

- **No** (request, log, exception and query profiling while developing — the common case) → **dev dependency + dev entrypoint**. Production never installs, imports or bundles the profiler; the entrypoint is the switch.
- **Yes** — a service injects `TracerService` (`span()`, `captureError()`, `currentToken()`), uses `@Span()` / `runInSpan`, calls `createProfilerLogger` inside a service, or calls a collector helper (`profileAgent`, `markMcpTools`), and the user wants to keep that code — or the profiler must run outside local dev (internal/VPN API, shared staging) → **dependencies + `ConditionalModule`**, so those imports resolve in production while the profiler stays switched off there.

**Log capture never requires the second install**: `createProfilerLogger` wraps the logger from the entrypoint, so the dev entry handles it. Neither does `ProfilerNoopModule` on its own — it only exists to keep `TracerService` injections resolving under the runtime gate.

Docs: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler>

## Presenting the choice (via `AskUserQuestion`)

- **Fixed order**: the dev-dependency install in position 1, the `ConditionalModule` install in position 2. Never reorder.
- **Recommendation on the `label`**: label 1 `"devDependencies + dev entrypoint (recommended)"`, label 2 `"dependencies + ConditionalModule"`. When introspection found profiler API calls in production code, say so in option 2's description (it is then the one that fits) — but keep the order and labels.
- **`header` ≤ 12 characters** or the tool call fails schema validation (e.g. `Install`).
- **Descriptions are technical and concrete**:
  - **1** — installs the profiler with `-D`; adds `profiling/profiling.module.ts`, `app.dev.module.ts`, `bootstrap.ts`, `main-dev.ts`, `tsconfig.dev.json`, a `start:dev` script on `--entryFile main-dev`; `main.ts` / `AppModule` / feature modules stay profiler-free; production installs without dev dependencies and never loads it. No env variable, no `@nestjs/config`, no `ProfilerNoopModule`. Requires that no production file imports the profiler at runtime.
  - **2** — installs the profiler (and `@nestjs/config` for `ConditionalModule`) in `dependencies`; `ProfilingModule` gated by `ConditionalModule.registerWhen(..., isProfilerEnabled)` (off unless `PROFILER_ENABLED=true`), `ProfilerNoopModule` on the off path so `TracerService` injections resolve as no-ops; the profiler module is never instantiated when off.
- If the user picks 2 but refuses to add `@nestjs/config`, fall back to the synchronous `enabled` flag (see the end of this file) — do not offer it as a third option.

## Install 1 — RECOMMENDED: dev dependency + dev entrypoint

**Hard requirement:** no production file may import a `@eleven-labs/nest-profiler*` package or `nestjs-cls` **at runtime**. `import type { … }` is fine (erased by TypeScript). If a production file injects `TracerService` or uses `@Span()`, either remove those calls or use install 2.

```bash
pnpm add -D @eleven-labs/nest-profiler nestjs-cls   # npm install -D / yarn add -D
```

Collector packages — and `@libsql/client` for SQLite storage — install the same way (`-D`). The host libraries a collector instruments (`@nestjs/typeorm`, `@nestjs/axios`, `@nestjs/cache-manager`, `class-validator`, `nest-commander`…) are the app's own **production** dependencies: never move them to `-D`.

### The bundle — every profiler module in one place

```ts title="src/profiling/profiling.module.ts"
import { Module } from '@nestjs/common';
import { ProfilerModule } from '@eleven-labs/nest-profiler';
import { ValidatorCollectorModule } from '@eleven-labs/nest-profiler-validator';

@Module({
  imports: [
    ProfilerModule.forRoot({ isGlobal: true }),
    // + every collector the app uses — no gate, this module is only loaded by main-dev.ts
    ValidatorCollectorModule.forRoot(),
  ],
})
export class ProfilingModule {}
```

Collectors resolve what they instrument across the whole DI container — verified for all of them from a single bundle: `AxiosInstrumentation` discovers every `HttpService` (via `DiscoveryService`) wherever `HttpModule` is imported, `FetchInstrumentation` patches the global `fetch`, TypeORM / MikroORM resolve their connection by token (`connectionName` for a named one), Mongoose patches `Query` / `Aggregate`, RabbitMQ patches `AmqpConnection` and discovers `@RabbitSubscribe` handlers, event-emitter discovers `@OnEvent` handlers, cache wraps the global `CACHE_MANAGER` (so `CacheModule.register({ isGlobal: true })` is required), GraphQL needs the app's `GraphQLModule` `context` to expose the request. So **nothing goes in the feature modules**. When the app itself toggles an integration with a feature flag (e.g. two ORMs selected by env), the bundle may gate that collector with the same app-level condition.

### The dev root module and the shared bootstrap

```ts title="src/app.dev.module.ts"
import { Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { ProfilingModule } from './profiling/profiling.module';

@Module({ imports: [AppModule, ProfilingModule] })
export class AppDevModule {}
```

Move the body of the existing `main.ts` into a shared function — keep everything the app already does there (global prefix, Swagger, CORS, versioning, a serverless handler export…) — and expose hooks for what the profiler replaces:

```ts title="src/bootstrap.ts"
import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import type {
  LoggerService,
  NestApplicationOptions,
  PipeTransform,
  Type,
  ValidationPipeOptions,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

export interface BootstrapOptions {
  instrument?: NestApplicationOptions['instrument'];
  wrapLogger?: (logger: LoggerService) => LoggerService;
  validationPipe?: (options: ValidationPipeOptions) => PipeTransform;
}

export async function bootstrap(
  rootModule: Type<unknown>,
  {
    instrument,
    wrapLogger = (logger) => logger,
    validationPipe = (options) => new ValidationPipe(options),
  }: BootstrapOptions = {},
): Promise<void> {
  const app = await NestFactory.create(rootModule, { bufferLogs: true, instrument });
  app.useLogger(wrapLogger(new ConsoleLogger('App'))); // or app.get(PinoLogger), etc.
  app.useGlobalPipes(validationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
```

```ts title="src/main.ts"
import { AppModule } from './app.module';
import { bootstrap } from './bootstrap';

void bootstrap(AppModule);
```

```ts title="src/main-dev.ts"
import { createProfilerLogger } from '@eleven-labs/nest-profiler';
import {
  createClassValidatorPipe,
  createProfilerValidationPipe,
} from '@eleven-labs/nest-profiler-validator';
import { AppDevModule } from './app.dev.module';
import { bootstrap } from './bootstrap';

void bootstrap(AppDevModule, {
  wrapLogger: (logger) => createProfilerLogger(logger),
  validationPipe: (options) => createProfilerValidationPipe(createClassValidatorPipe(options)),
});
```

Only add the hooks the app needs (no validator collector ⇒ no `validationPipe` hook). The opt-in automatic instrumentation (`instrument: createProfilerInstrument()`) goes in `main-dev.ts` only.

### Loggers that bypass `app.useLogger()`

`app.useLogger(createProfilerLogger(...))` captures every `new Logger(context)` call. Two cases escape it:

- a `ConsoleLogger` **instantiated** in a service → switch to `new Logger(MyService.name)`;
- a logger **injected through DI** (`nestjs-pino`'s `PinoLogger`, a custom `LoggerService` provider) → add a seam: an optional token the dev bundle provides.

```ts title="src/logger/logger-wrap.ts"
import type { LoggerService } from '@nestjs/common';

export const LOGGER_WRAP = Symbol('LOGGER_WRAP');
export type LoggerWrap = <T extends LoggerService>(logger: T) => T;
```

```ts title="where the logger is provided"
{
  provide: AppLogger,
  useFactory: (wrap?: LoggerWrap) => {
    const logger = new AppLogger();
    return wrap ? wrap(logger) : logger;
  },
  inject: [{ token: LOGGER_WRAP, optional: true }],
}
// or, in a service: @Optional() @Inject(LOGGER_WRAP) wrap?: LoggerWrap → this.logger = wrap ? wrap(pino) : pino
```

```ts title="src/profiling/profiling.module.ts"
@Global()
@Module({
  imports: [ProfilerModule.forRoot({ isGlobal: true }) /* , collectors… */],
  providers: [{ provide: LOGGER_WRAP, useValue: createProfilerLogger satisfies LoggerWrap }],
  exports: [LOGGER_WRAP],
})
export class ProfilingModule {}
```

### CLI (`nest-commander`)

Same split: `cli.ts` keeps running the profiler-free `CliModule`; `cli-dev.ts` runs a `CliDevModule` (`imports: [CliModule, <CLI bundle>]`). The CLI bundle uses `file` storage (or the SQLite adapter) with the web app's path, so command profiles show up in `/_profiler`, plus `CommanderCollectorModule.forRoot()` and any collector the commands exercise (http, cache…). Commands log with `new Logger(MyCommand.name)`, and the wrapped logger goes to `CommandFactory`:

```ts title="src/cli-dev.ts"
import { ConsoleLogger } from '@nestjs/common';
import { createProfilerLogger } from '@eleven-labs/nest-profiler';
import { CommandFactory } from 'nest-commander';
import { CliDevModule } from './cli.dev.module';

void CommandFactory.run(CliDevModule, {
  logger: createProfilerLogger(new ConsoleLogger('Cli', { logLevels: ['log', 'warn', 'error'] })),
});
```

Script: `"cli:dev": "nest start --entryFile cli-dev -p tsconfig.dev.json --"`. There is no `ConditionalModule` here, so the `ConfigModule.forRoot()` requirement of install 2 does not apply.

### Build, run, deploy

```jsonc title="tsconfig.build.json"
{
  "extends": "./tsconfig.json",
  "exclude": [
    "node_modules",
    "test",
    "dist",
    "**/*spec.ts",
    "src/main-dev.ts",
    "src/app.dev.module.ts",
    "src/profiling/**",
    // + src/cli-dev.ts, src/cli.dev.module.ts when there is a CLI
  ],
}
```

```jsonc title="tsconfig.dev.json"
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"],
}
```

```jsonc title="package.json"
{
  "scripts": {
    "build": "nest build",
    "start": "node dist/main",
    "start:dev": "nest start --watch --entryFile main-dev -p tsconfig.dev.json",
  },
}
```

Mirror the app's existing `tsconfig.build.json` exclusions in `tsconfig.dev.json` (minus the dev files) so both emit the same `dist/` layout. Builds run with dev dependencies installed; the production image/server installs production dependencies only (`npm ci --omit=dev`, `pnpm install --prod`, `yarn install --production`). A multi-stage Dockerfile that builds with everything and installs `--prod` in the final stage already fits.

### Guard the boundary

`tsconfig.build.json` exclusions do **not** stop a production file from importing a dev file (TypeScript follows imports — e.g. a feature module importing a helper from `profiling/`). Add both checks:

- **Lint** (when the project uses ESLint): `import/no-extraneous-dependencies` (`eslint-plugin-import`, or `import-x/…`) with `devDependencies: false` on `src/**/*.ts` and `devDependencies: true` on the dev files (`src/main-dev.ts`, `src/cli-dev.ts`, `src/*.dev.module.ts`, `src/profiling/**/*.ts`). Type-only imports are ignored by default.
- **Smoke test** (the verification step, and worth a CI job): build, install production dependencies only in a clean copy, `node dist/main` → boots, no `MODULE_NOT_FOUND`, `/_profiler` → `404`.

End-to-end tests may boot `AppDevModule` (or reuse `bootstrap` with the dev hooks) to assert on collected profiles.

## Install 2 — `dependencies` + `ConditionalModule`

```bash
pnpm add @eleven-labs/nest-profiler nestjs-cls @nestjs/config
```

`@nestjs/config` is a first-party Nest package that can be installed **solely** to obtain `ConditionalModule`, without adopting `ConfigModule` for configuration loading.

### `env-condition` helpers — ship these first

Write a small helper module in the consumer's project so every `ConditionalModule.registerWhen(...)` gate stays readable and consistent. This mirrors the repo's `examples/api`.

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

Why `toString()`: NestJS logs a `registerWhen` condition via `String(condition)` at debug level, which otherwise dumps the whole function body.

> ⚠️ The repo's `examples/api` sets `enabled('PROFILER_ENABLED', true)` (**on by default**) because that app exists to _demo_ the profiler live. For a real application keep the default `false` so a production deploy that forgets the variable stays off.

### Gate the bundle, keep `TracerService` resolvable

```ts title="app.module.ts"
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { ProfilerNoopModule } from '@eleven-labs/nest-profiler';
import { ProfilingModule } from './profiling/profiling.module.js';
import { isProfilerEnabled } from './config/profiler.config.js';
import { not } from './config/env-condition.js';

@Module({
  imports: [
    ConditionalModule.registerWhen(ProfilingModule, isProfilerEnabled),
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
- `ProfilerNoopModule` keeps `TracerService` (and so `span`, `captureError`, `currentToken`, `@Span()`) resolvable as no-ops when off. Register it with the **same `isGlobal`** as the active module. It is the reason this install exists, so it is normally present; skip it only if no code injects `TracerService`.
- `ProfilingModule` holds the core and the collectors, as in install 1. A collector may also sit next to the module it instruments, gated with the same `isProfilerEnabled` (the example app does that, combined with its own feature flags). Collectors need **no** no-op counterpart.
- When options depend on injected providers (e.g. `ConfigService`), use `ProfilerModule.forRootAsync({ isGlobal: true, inject: [...], useFactory: ... })`. `isGlobal` stays a top-level key, outside the factory.
- `main.ts` wraps the logger with `createProfilerLogger(...)` and installs `createProfilerValidationPipe(...)` **unconditionally** — both are pass-throughs when the profiler is off. A DI-injected logger can be wrapped at its injection point with `createProfilerLogger(...)` directly.
- **CLI apps (`nest-commander` / `CommandFactory`):** `registerWhen` `await`s `ConfigModule.envVariablesLoaded`, which only resolves once `@nestjs/config`'s `ConfigModule.forRoot()` has run. An HTTP root module usually imports it already; a `CommandFactory` CLI often does not — and without it registration hangs and the process exits `0` **silently** (no logs, no error; the internal timeout is `unref`'d). Import `ConfigModule.forRoot()` in any CLI root module that gates something with `registerWhen`.

### Fallback — the `enabled` flag (no `@nestjs/config`)

Only when the user picked install 2 and declines `@nestjs/config`. `enabled` is a **synchronous, top-level** bootstrap flag: when `false`, the core registers only an inert layer that binds `TracerService` to the same no-op service (no CLS, no middleware/interceptor/controller/storage/collectors), so no `ProfilerNoopModule` is needed.

```ts title="src/profiling/profiling.module.ts"
ProfilerModule.forRoot({
  isGlobal: true,
  // OFF by default; PROFILER_ENABLED=true turns it on. Still just an env read at bootstrap.
  enabled: enabled('PROFILER_ENABLED')(process.env),
}),
```

- `enabled` must be known **before** the async factory runs — with `forRootAsync` it stays a top-level key, it is **not** resolved inside `useFactory`. Collectors take the same top-level flag.
