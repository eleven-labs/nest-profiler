---
name: setup-nest-profiler
description: |
  Install and configure @eleven-labs/nest-profiler in a NestJS application.
  Introspects the project, picks an enable strategy (ConditionalModule vs the enabled flag), and wires the optional collectors (TypeORM, MikroORM, Mongoose, HTTP, cache, auth, config, GraphQL, validator, commander, RabbitMQ) that match the stack.
  Use when a user wants to add the profiler to their NestJS app, or enable request / log / exception / query profiling.
---

# Set up nest-profiler

`@eleven-labs/nest-profiler` is a Symfony-Web-Profiler-style toolkit for NestJS: every execution gets a token and a `/_profiler` UI to inspect requests, logs, exceptions, performance spans, and one panel per collector. Wire it into the **consumer's** app — introspect the project, ask what to add, apply idiomatic wiring, verify it works.

⚠️ **Off in production by default** — the profiler exposes headers, query params and logs, so recommend against enabling it in production. It is the user's call, though: if the API isn't publicly reachable (internal, behind a VPN) or they've weighed the risks and still want it on, respect that and help them harden it (see the production section in [references/options.md](references/options.md)) — don't refuse. Both enable strategies keep `ProfilerService` injectable, so app code that calls it keeps working (as a no-op) when profiling is off.

**Only adding one collector to an app that already has the core profiler wired?** → use the `add-nest-profiler-collector` skill instead. This skill installs the core (and can add collectors in the same pass).

## Workflow

1. **Introspect the project** first — nothing else until you have this (see below).
2. **Choose the enable strategy** → [references/enable-strategies.md](references/enable-strategies.md): `ConditionalModule` + `ProfilerNoopModule` (recommended, needs `@nestjs/config`) vs the synchronous `enabled` flag.
3. **Install and wire the core** (see below).
4. **Detect and wire collectors** → [references/collectors.md](references/collectors.md): the dependency → collector matrix, placement rules, and per-collector gotchas.
5. **Finalize and verify** (see below).

Full `ProfilerModuleOptions` table, env vars and response headers → [references/options.md](references/options.md).

## Introspect the project

Before changing anything, gather:

- **Package manager** — from the lockfile (`pnpm-lock.yaml` → pnpm, `package-lock.json` → npm, `yarn.lock` → yarn). Use it for every install command.
- **`package.json` dependencies** — the detection signal for both the enable strategy and the collectors.
- **The composition root** — the `@Module` that `NestFactory.create(...)` bootstraps (usually `app.module.ts`), plus the `main.ts` entrypoint.
- **`@nestjs/config` presence** — decides the default enable strategy.
- **ESM vs CJS** — `"type": "module"` in the consumer's `package.json`; required if you add the MikroORM collector.

If this is not a NestJS 11+ app (no `@nestjs/core`), stop and say so — the profiler does not apply.

## Choose the enable strategy

Full snippets and rules in [references/enable-strategies.md](references/enable-strategies.md). Decide from what you found:

- **`@nestjs/config` present** → default to **Approach A** (recommended): `ConditionalModule.registerWhen` + `ProfilerNoopModule`.
- **`@nestjs/config` absent** → do **not** silently fall back. Present both options to the user and let them pick: (1) add `@nestjs/config` to unlock the recommended Approach A, or (2) use **Approach B**, the synchronous `enabled` flag. State the trade-off (a new dependency vs. a coarser flag) so the choice is informed.

## Install and wire the core

1. `<pm> add @eleven-labs/nest-profiler nestjs-cls` — `nestjs-cls` powers per-request context and is the one peer a Nest app doesn't already provide.
2. Add the gated import(s) to the composition root per the chosen strategy, with `isGlobal: true`.
3. Enable log capture in `main.ts`: create the app with `{ bufferLogs: true }`, then `app.useLogger(app.get(ProfilerService).createLogger(new ConsoleLogger('App')))`.

## Detect and wire collectors

Cross-reference `package.json` against the matrix in [references/collectors.md](references/collectors.md), then **ask the user (multi-select)** which detected collectors to add — do not assume all. For each chosen one: install its package, place it correctly (`config`/`validator` at the root; database / http / cache / rabbitmq / graphql co-located with their host module), gate it the same way as the core, and apply its gotcha (TypeORM `forRootAsync` + `inject: [DataSource]`; MikroORM ESM-only after `MikroOrmModule`; HTTP needs `HttpModule` alongside; GraphQL needs a `context` exposing the request; validator replaces the global `ValidationPipe`; commander needs file storage in both processes). Consider grouping the root-level collectors + core into one `ProfilingModule` to keep the composition root to two profiler entries.

## Finalize

- Add `PROFILER_ENABLED` (and optionally `PROFILER_TOKEN`) to `.env` and `.env.example`.
- If `storageType: 'file'`, add `.profiler/` to `.gitignore`.
- **State the production stance explicitly** when you finish a setup: recommend keeping the profiler off in production by default (`PROFILER_ENABLED=false`, or gated off). If the user wants it on in production anyway, don't refuse — confirm they accept the exposure and help them harden it (`PROFILER_TOKEN`, no `collectBody`, a low `sampleRate`, `ignorePaths` for sensitive routes). See the production section in [references/options.md](references/options.md).

## Verify

- Start the app, `curl -i http://localhost:3000/<some-route>`, and confirm the response carries `X-Debug-Token` and `X-Debug-Token-Link`.
- Open `http://localhost:3000/_profiler`, click the token, and confirm the Request / Response / Performance / Logs / Exceptions tabs (plus any collector panel you added) render.
- Confirm the app still boots with `PROFILER_ENABLED=false` — `ProfilerService` must still resolve.
