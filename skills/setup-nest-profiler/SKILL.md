---
name: setup-nest-profiler
description: |
  Install and configure @eleven-labs/nest-profiler in a NestJS application.
  Introspects the project, picks the install (dev dependency + dev-only entrypoint by default, or dependencies + ConditionalModule when production code calls the profiler), configures the core, and wires the optional collectors (TypeORM, MikroORM, Mongoose, HTTP, cache, auth, config, GraphQL, validator, commander, RabbitMQ, event emitter, routes) that match the stack — asking the user to confirm the choices that matter.
  Use when a user wants to add the profiler to their NestJS app, or enable request / log / exception / query profiling.
---

# Set up nest-profiler

`@eleven-labs/nest-profiler` is a Symfony-Web-Profiler-style toolkit for NestJS: every execution gets a token and a `/_profiler` UI to inspect requests, logs, exceptions, performance spans, and one panel per collector. Wire it into the **consumer's** app — introspect the project, ask what to add, apply idiomatic wiring, verify it works.

⚠️ **Out of production by default** — the profiler exposes headers, query params and logs. The default install keeps it in `devDependencies`, loaded only by a dev entrypoint, so production never installs it. It is the user's call, though: if their production code calls the profiler, or they want it running on an internal / VPN-only environment, install it as a regular dependency behind a `ConditionalModule` gate and help them harden it (the `harden-for-production` skill) — don't refuse.

**Only adding one collector to an app that already has the core profiler wired?** → use the `add-nest-profiler-collector` skill instead. This skill installs the core (and can add collectors in the same pass).

## Workflow

1. **Introspect the project** first — nothing else until you have this (see below).
2. **Choose the install** with `AskUserQuestion` → [references/enable-strategies.md](references/enable-strategies.md): **dev dependency + dev entrypoint** (recommended, always first) vs **dependencies + `ConditionalModule`** (only when production code calls the profiler, or it must run outside local dev).
3. **Install and configure the core** — ask the config questions that matter (see below).
4. **Detect and wire collectors** → [references/collectors-matrix.md](references/collectors-matrix.md) and the family references; multi-select which to add, then ask each collector's key question.
5. **Finalize and verify** (see below).

Full `ProfilerModuleOptions` table, storage backends, env vars and headers → [references/core-options.md](references/core-options.md).

## Introspect the project

Before changing anything, gather:

- **Package manager** — from the lockfile (`pnpm-lock.yaml` → pnpm, `package-lock.json` → npm, `yarn.lock` → yarn). Use it for every install command.
- **`package.json` dependencies** — the detection signal for the collectors.
- **Profiler API in application code** — grep for `TracerService`, `@Span(`, `runInSpan`, `createProfilerLogger`, `profileAgent`, `markMcpTools`. Any hit in a production file (a re-run on an app that already has the profiler), or a user who says they want custom spans kept in their services, points to the `dependencies` + `ConditionalModule` install.
- **Entrypoints** — `main.ts` and the `@Module` that `NestFactory.create(...)` bootstraps (usually `app.module.ts`); a `nest-commander` CLI (`CommandFactory`, usually `cli.ts`) if any.
- **Loggers** — the one passed to `app.useLogger(...)`, and any logger **injected through DI** in services (`nestjs-pino`'s `PinoLogger`, a custom `LoggerService` provider) or `ConsoleLogger` instantiated directly: they bypass `app.useLogger()` and need the seam described in the reference.
- **Build setup** — `nest-cli.json`, `tsconfig.build.json`, the `build` / `start:dev` scripts, a Dockerfile or CI install step (`--omit=dev`, `--prod`), and an ESLint config.
- **ESM vs CJS** — `"type": "module"` in the consumer's `package.json`; required if you add the MikroORM collector.

If this is not a NestJS 11+ app (no `@nestjs/core`), stop and say so — the profiler does not apply. It also targets Node ≥ 22.

## Choose the install

Present the choice with `AskUserQuestion`, following the rules in [references/enable-strategies.md](references/enable-strategies.md) **exactly**:

- **Fixed order** — the dev-dependency install in position 1 with `(recommended)` on its **label**, the `dependencies` + `ConditionalModule` install in position 2.
- **Recommend position 2 only on a concrete signal** — profiler API in production code (or the user wants it there), or the profiler must run outside local dev. Log capture is **not** such a signal: the dev entry wraps the logger.
- Keep `header` ≤ 12 characters, and write **concrete** descriptions (what gets installed, which files change, exact runtime behaviour).

## Install and configure the core

1. **Dev-dependency install:** `<pm> add -D @eleven-labs/nest-profiler nestjs-cls` (`pnpm add -D` / `npm install -D` / `yarn add -D`). **`ConditionalModule` install:** `<pm> add @eleven-labs/nest-profiler nestjs-cls @nestjs/config` (skip `@nestjs/config` if present). `nestjs-cls` powers per-request context and is the one peer a Nest app doesn't already provide. Add `@libsql/client` (same flag as the profiler) only if the user picks SQLite storage.
2. **Ask the core config questions that matter** (balanced — apply and state documented defaults for the rest): storage backend (`memory` / `file` / `sqlite`; use file or sqlite for CLI/multi-process), **access control** (the `security` option — the profiler is **open by default**; with the dev install it only runs locally, so this matters mostly for the `ConditionalModule` install or a shared dev environment — see [references/core-options.md](references/core-options.md)), whether to `collectBody` (default `false`, sensitive), and `sampleRate`. Leave `maxProfiles`, `ttl`, `ignorePaths`, `redaction`, `emitDebugHeaders`, `maxBodySize`, `listPageSize` at their defaults unless the user has a reason.
3. **Bundle the profiler** in `src/profiling/profiling.module.ts` — `ProfilerModule.forRoot({ isGlobal: true, ... })` (or `forRootAsync` when options come from `ConfigService`; `isGlobal` stays top-level) plus every collector.
4. **Wire it per install** — follow the reference:
   - **Dev dependency:** keep `AppModule` and every feature module profiler-free; add `AppDevModule` (`imports: [AppModule, ProfilingModule]`); move the bootstrap into a shared `bootstrap(rootModule, { instrument?, wrapLogger?, validationPipe? })` used by `main.ts` (plain) and `main-dev.ts` (`createProfilerLogger`, the profiler validation pipe); exclude the dev files from `tsconfig.build.json`, add `tsconfig.dev.json` and a `start:dev` script on `--entryFile main-dev`. Add the `LOGGER_WRAP` seam for DI-injected loggers, the CLI split (`cli-dev.ts` + `CliDevModule`) if there is a CLI, and the `import/no-extraneous-dependencies` lint rule if the project uses ESLint.
   - **`ConditionalModule`:** ship the `env-condition` helpers, gate `ProfilingModule` with `ConditionalModule.registerWhen(..., isProfilerEnabled)` plus `ProfilerNoopModule` on `not(isProfilerEnabled)` (it keeps the `TracerService` injections resolving when off), and wrap the logger in `main.ts` with `createProfilerLogger(...)` unconditionally. A CLI root module must import `ConfigModule.forRoot()`.

## Detect and wire collectors

Cross-reference `package.json` against [references/collectors-matrix.md](references/collectors-matrix.md), then **ask the user (multi-select)** which detected collectors to add — do not assume all. Same `AskUserQuestion` rules (header ≤ 12 chars, concrete descriptions). For each chosen collector, open its **family reference** and:

- **[collectors-orm.md](references/collectors-orm.md)** — typeorm / mikro-orm / mongoose: query collector + optional Schema panel companion. Ask: add the Schema panel? tune `slowThreshold`? TypeORM needs **no** `inject: [DataSource]` (it self-resolves via `connectionName`); MikroORM is ESM-only.
- **[collectors-http.md](references/collectors-http.md)** — ⚠️ nothing is captured unless you list an instrumentation. Ask: axios, fetch, or both? capture bodies? The app keeps importing `HttpModule` where it uses `HttpService`; `AxiosInstrumentation` discovers it.
- **[collectors-validator.md](references/collectors-validator.md)** — ask: class-validator or zod? Validation is app-owned: the bootstrap installs the pipe (`createProfilerValidationPipe(...)` from the profiler entry only) and the bundle registers the panel with `forRoot()`. One global validation pipe only; value-import DTOs.
- **[collectors-config-auth.md](references/collectors-config-auth.md)** — ask: extra keys / user fields to mask.
- **[collectors-simple.md](references/collectors-simple.md)** — cache / graphql / commander / routes / rabbitmq / event-emitter: mostly confirm inclusion. GraphQL `context` must expose the request; cache needs `CacheModule.register({ isGlobal: true })`; commander needs file/sqlite storage in both processes; event-emitter cannot profile request-scoped subscribers.

Install every collector with the **same flag as the core** (`-D` for the dev install), and register it in the `ProfilingModule` bundle: collectors resolve what they instrument across the whole application, so nothing goes in the feature modules. The host library's app-side config (ORM module, `HttpModule`, `CacheModule`, GraphQL `context`…) stays where the app has it. With the `ConditionalModule` install, the single gate on the bundle covers them all; a collector may also sit next to the module it instruments, gated with `isProfilerEnabled`. Collectors need no no-op counterpart.

## Finalize

- **Dev dependency:** no env variable to add — the entrypoint is the switch. Point the user at `start:dev`, and mention that the production image/server must install production dependencies only (`npm ci --omit=dev`, `pnpm install --prod`, `yarn install --production`).
- **`ConditionalModule`:** add `PROFILER_ENABLED=true` to `.env` and `.env.example` **for local dev** — the code default (`enabled('PROFILER_ENABLED')`) is off, so a production deploy without the variable stays off.
- If the user configured a `security` strategy, add the credential env var(s) their strategy reads (e.g. `PROFILER_BASIC_PASSWORD`) to `.env.example` — the profiler defines no auth env var itself.
- If `storageType: 'file'` or SQLite, add `.profiler/` to `.gitignore`.
- **State the production stance explicitly** when you finish. With the `ConditionalModule` install, the profiler is **open by default**: if the user wants it on anywhere reachable they MUST add a `security` strategy — don't refuse, confirm they accept the exposure and route them to the `harden-for-production` skill.

## Verify

- **Dev dependency:** run the dev entry (`<pm> run start:dev`), `curl -i http://localhost:3000/<some-route>`, confirm `X-Debug-Token` / `X-Debug-Token-Link`, open `/_profiler` and check the Request / Response / Performance / Logs / Exceptions tabs (plus each collector panel). Then verify production: `<pm> run build`, copy `dist` + `package.json` + the lockfile to a temp dir, install production dependencies only, run `node dist/main`, and confirm it boots with no `MODULE_NOT_FOUND`, no `X-Debug-Token`, and `/_profiler` → `404`. Run the linter if you added the rule.
- **`ConditionalModule`:** with `PROFILER_ENABLED=true`, the same checks as above; with it unset, confirm the app boots, `/_profiler` → `404`, and services injecting `TracerService` still resolve (no-op).
