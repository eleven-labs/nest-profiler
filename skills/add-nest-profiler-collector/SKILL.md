---
name: add-nest-profiler-collector
description: |
  Add one optional @eleven-labs/nest-profiler collector package to a NestJS app that already has the core profiler configured.
  Matches the app's existing enable strategy and placement rules, and applies the collector's wiring gotcha.
  Use when a project gains a new integration (TypeORM, MikroORM, Mongoose, HTTP client, cache, auth, config, GraphQL, class-validator/zod, nest-commander, RabbitMQ) and the user wants its dedicated profiler panel.
---

# Add a nest-profiler collector

Wire a single `@eleven-labs/nest-profiler-*` collector into an app whose core `ProfilerModule` is already set up. [references/collectors.md](references/collectors.md) holds the dependency → collector matrix, placement rules, and per-collector gotchas.

**Core profiler not set up yet** (no `@eleven-labs/nest-profiler` dependency, no `ProfilerModule` in the codebase)? → use the `setup-nest-profiler` skill instead; it installs the core and can add collectors in the same pass. A collector alone does nothing without the core.

## Workflow

1. **Confirm the base setup** — find the registered `ProfilerModule` (or a `ProfilingModule` bundle) in the composition root and note the existing **enable strategy**: `ConditionalModule.registerWhen(..., isProfilerEnabled)` (Approach A) or the `enabled` flag (Approach B). Match it exactly — never introduce a second pattern.
2. **Identify the collector** — from the integration the user named or the new dependency in `package.json`, look it up in [references/collectors.md](references/collectors.md). Confirm the host lib is actually a dependency. If no `@eleven-labs/nest-profiler-*` package instruments it, say so — do not invent one (point to a custom collector / context adapter instead).
3. **Install** — `<pm> add <collector-package>` with the project's package manager (from the lockfile).
4. **Place and gate it** — put it where the matrix says (`config`/`validator` at the root; database / http / cache / rabbitmq / graphql co-located with their host module) and gate it with the **same** strategy as the core. Collectors need no no-op counterpart.
5. **Apply the gotcha** — TypeORM `forRootAsync` + `inject: [DataSource]`; MikroORM ESM-only, after `MikroOrmModule`; HTTP needs `HttpModule` imported alongside; GraphQL needs a `context` exposing the request; validator replaces the global `ValidationPipe` (remove any second one) and needs value imports of DTOs; commander needs `storageType: 'file'` and to be imported in both the CLI and HTTP processes.

## Verify

Start the app, exercise the instrumented subsystem (run a query, call an HTTP endpoint, hit a cached route…), open a fresh profile at `/_profiler`, and confirm the new collector panel appears with entries. Confirm the app still boots with profiling disabled.
