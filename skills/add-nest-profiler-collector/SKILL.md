---
name: add-nest-profiler-collector
description: |
  Add one optional @eleven-labs/nest-profiler collector package to a NestJS app that already has the core profiler configured.
  Matches the app's existing install (dev dependency + dev entrypoint, or dependencies + ConditionalModule), registers it in the profiler bundle, and applies the collector's wiring gotcha.
  Use when a project gains a new integration (TypeORM, MikroORM, Mongoose, HTTP client, cache, auth, config, GraphQL, class-validator/zod, nest-commander, RabbitMQ, @nestjs/event-emitter, routes) and the user wants its dedicated profiler panel.
---

# Add a nest-profiler collector

Wire a single `@eleven-labs/nest-profiler-*` collector into an app whose core `ProfilerModule` is already set up. The [references/collectors-matrix.md](references/collectors-matrix.md) index maps a dependency to its collector and points at the **family reference** with the full options, snippet, gotcha and the question(s) to ask.

**Core profiler not set up yet** (no `@eleven-labs/nest-profiler` dependency, no `ProfilerModule` in the codebase)? → use the `setup-nest-profiler` skill instead; it installs the core and can add collectors in the same pass. A collector alone does nothing without the core.

## Workflow

1. **Confirm the base setup** — find where `ProfilerModule` is registered (usually a `ProfilingModule` bundle) and note the existing **install**: `@eleven-labs/nest-profiler` in `devDependencies` with a dev entrypoint (`main-dev.ts` booting an `AppDevModule`) — or in `dependencies`, gated with `ConditionalModule.registerWhen(..., isProfilerEnabled)` (or the `enabled` flag). Match it exactly — never introduce a second pattern. Reuse the app's existing bundle and `isProfilerEnabled` / `env-condition` helpers.
2. **Identify the collector** — from the integration the user named or the new dependency in `package.json`, look it up in [references/collectors-matrix.md](references/collectors-matrix.md) and open its family reference. Confirm the host lib is actually a dependency. If no `@eleven-labs/nest-profiler-*` package instruments it, say so — do not invent one (point to the `custom-collector` skill instead).
3. **Install** — with the project's package manager (from the lockfile) and the **same flag as the core**: `<pm> add -D <collector-package>` for a dev-dependency install, `<pm> add <collector-package>` otherwise. The host library it instruments stays a production dependency.
4. **Ask the collector's key question(s)** — each family reference lists them (e.g. ORM: add the Schema panel? / HTTP: which client(s) to instrument? / validator: class-validator or zod?). Use `AskUserQuestion` with `header` ≤ 12 chars.
5. **Register, and apply the gotcha** — add it to the `ProfilingModule` bundle's `imports` (collectors resolve what they instrument across the whole app, so nothing goes in feature modules — see the matrix's "Install and placement"). With a dev-dependency install that is all: no gate. With `ConditionalModule`, the bundle's gate covers it; if the app keeps collectors next to their host module instead, follow that convention with the same `isProfilerEnabled` gate. Never import the collector from a production file of a dev-dependency install. Collectors need no no-op counterpart. Key gotchas:
   - **TypeORM** — `TypeOrmCollectorModule` self-resolves the `DataSource` (via `connectionName`); **no `inject: [DataSource]`**. Add `TypeOrmSchemaCollectorModule` for the entity panel.
   - **MikroORM** — ESM-only (`"type": "module"`).
   - **HTTP** — nothing is captured without an `instrumentations` entry (`AxiosInstrumentation` from `/axios`, `FetchInstrumentation` from `/fetch`); the app keeps `HttpModule` where it injects `HttpService`.
   - **GraphQL** — the module is `GraphQLCollectorModule`; the `context` must expose the request.
   - **validator** — the pipe is app-owned: with a dev-dependency install, add a `validationPipe` hook to the shared bootstrap and pass `createProfilerValidationPipe(...)` from `main-dev.ts` only; with `ConditionalModule`, wrap the global pipe in `main.ts`. One global pipe only; value imports for DTOs.
   - **commander** — a cross-process store (`storageType: 'file'`, or the SQLite `storage` adapter — there is no `storageType: 'sqlite'`) and registered in both the CLI and web bundles; with a dev-dependency install the CLI gets its own `cli-dev.ts` entry (see `setup-nest-profiler`'s `enable-strategies.md`).
   - **cache** — the app must register `CacheModule.register({ isGlobal: true })`, or the bundle cannot see `CACHE_MANAGER`.
   - **event-emitter** — the app keeps `EventEmitterModule.forRoot()`; request-scoped subscribers cannot be profiled.

## Verify

Start the app with the entrypoint that loads the profiler (the dev entry, or `PROFILER_ENABLED=true`), exercise the instrumented subsystem (run a query, call an HTTP endpoint, hit a cached route…), open a fresh profile at `/_profiler`, and confirm the new collector panel appears with entries. Confirm the production path still boots without the profiler (`node dist/main` after a production-only install, or `PROFILER_ENABLED` unset).
