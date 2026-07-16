---
name: setup-nest-profiler
description: |
  Install and configure @eleven-labs/nest-profiler in a NestJS application.
  Introspects the project, picks an enable strategy (ConditionalModule vs the enabled flag), configures the core, and wires the optional collectors (TypeORM, MikroORM, Mongoose, HTTP, cache, auth, config, GraphQL, validator, commander, RabbitMQ, routes) that match the stack — asking the user to confirm the choices that matter.
  Use when a user wants to add the profiler to their NestJS app, or enable request / log / exception / query profiling.
---

# Set up nest-profiler

`@eleven-labs/nest-profiler` is a Symfony-Web-Profiler-style toolkit for NestJS: every execution gets a token and a `/_profiler` UI to inspect requests, logs, exceptions, performance spans, and one panel per collector. Wire it into the **consumer's** app — introspect the project, ask what to add, apply idiomatic wiring, verify it works.

⚠️ **Off in production by default** — the profiler exposes headers, query params and logs, so recommend keeping it off in production. It is the user's call, though: if the API isn't publicly reachable (internal, behind a VPN) or they've weighed the risks and still want it on, respect that and help them harden it (the `harden-for-production` skill, or the production section in [references/core-options.md](references/core-options.md)) — don't refuse. Both enable strategies keep `ProfilerService` injectable, so app code that calls it keeps working (as a no-op) when profiling is off.

**Only adding one collector to an app that already has the core profiler wired?** → use the `add-nest-profiler-collector` skill instead. This skill installs the core (and can add collectors in the same pass).

## Workflow

1. **Introspect the project** first — nothing else until you have this (see below).
2. **Choose the enable strategy** with `AskUserQuestion` → [references/enable-strategies.md](references/enable-strategies.md): Approach A (`ConditionalModule` + `ProfilerNoopModule`, **recommended, always presented first**) vs Approach B (the synchronous `enabled` flag).
3. **Install and configure the core** — ask the config questions that matter (see below).
4. **Detect and wire collectors** → [references/collectors-matrix.md](references/collectors-matrix.md) and the family references; multi-select which to add, then ask each collector's key question.
5. **Finalize and verify** (see below).

Full `ProfilerModuleOptions` table, storage backends, env vars and headers → [references/core-options.md](references/core-options.md).

## Introspect the project

Before changing anything, gather:

- **Package manager** — from the lockfile (`pnpm-lock.yaml` → pnpm, `package-lock.json` → npm, `yarn.lock` → yarn). Use it for every install command.
- **`package.json` dependencies** — the detection signal for both the enable strategy and the collectors.
- **The composition root** — the `@Module` that `NestFactory.create(...)` bootstraps (usually `app.module.ts`), plus the `main.ts` entrypoint.
- **`@nestjs/config` presence** — informs the enable-strategy default (but never blocks Approach A — see below).
- **ESM vs CJS** — `"type": "module"` in the consumer's `package.json`; required if you add the MikroORM collector.

If this is not a NestJS 11+ app (no `@nestjs/core`), stop and say so — the profiler does not apply. It also targets Node ≥ 22.

## Choose the enable strategy

Present the choice with `AskUserQuestion`, following the rules in [references/enable-strategies.md](references/enable-strategies.md) **exactly** (they fix past defects):

- **Fixed order** — Approach A in position 1, Approach B in position 2. **Always.** Never reorder based on how the project currently manages its config.
- **Approach A is the recommended default even when `@nestjs/config` is absent** — it is a first-party Nest package installable **solely** for `ConditionalModule`, without adopting `ConfigModule`. Do not silently fall back to B; present both, put the "install one first-party dependency" trade-off inside B's description, and let the user pick.
- Put "(recommended)" on A's **label**, keep `header` ≤ 12 characters, and write **concrete** descriptions (what gets installed, exact runtime behaviour).

Then **ship the `env-condition` helpers** (`src/config/env-condition.ts` + `isProfilerEnabled`) as shown in the reference — every gate reuses them.

## Install and configure the core

1. `<pm> add @eleven-labs/nest-profiler@alpha nestjs-cls` — the profiler has **no stable release yet**, so every `@eleven-labs/nest-profiler*` package must be pinned to the `@alpha` dist-tag (`@latest` resolves to nothing). `nestjs-cls` powers per-request context and is the one peer a Nest app doesn't already provide. Add `@libsql/client` too only if the user picks SQLite storage (local file, `:memory:`, or a remote SQLite database).
2. **Ask the core config questions that matter** (balanced — apply and state documented defaults for the rest): storage backend (`memory` / `file` / `sqlite`; use file or sqlite for CLI/multi-process), **access control** (the `security` option — the profiler is **open by default**, so ask whether to lock the UI down now and how: reuse an app guard via `security.guards`, or an `authorize` predicate — see [references/core-options.md](references/core-options.md)), whether to `collectBody` (default `false`, sensitive), and `sampleRate`. Leave `maxProfiles`, `ttl`, `ignorePaths`, `maskHeaders`, `emitDebugHeaders`, `maxBodySize`, `listPageSize` at their defaults unless the user has a reason.
3. Add the gated import(s) to the composition root per the chosen strategy, with `isGlobal: true`. When options come from `ConfigService`, use `forRootAsync` (`isGlobal`/`enabled` stay top-level). Consider the `ProfilingModule.forWeb()` bundle to keep the root to two profiler entries.
4. Enable log capture in `main.ts`: create the app with `{ bufferLogs: true }`, then `app.useLogger(app.get(ProfilerService).createLogger(new ConsoleLogger('App')))`.

## Detect and wire collectors

Cross-reference `package.json` against [references/collectors-matrix.md](references/collectors-matrix.md), then **ask the user (multi-select)** which detected collectors to add — do not assume all. Same `AskUserQuestion` rules (header ≤ 12 chars, concrete descriptions). For each chosen collector, open its **family reference** and:

- **[collectors-orm.md](references/collectors-orm.md)** — typeorm / mikro-orm / mongoose: query collector + optional Schema panel companion. Ask: add the Schema panel? tune `slowThreshold`? TypeORM needs **no** `inject: [DataSource]` (it self-resolves via `connectionName`); MikroORM is ESM-only; place each after its ORM module.
- **[collectors-http.md](references/collectors-http.md)** — ⚠️ nothing is captured unless you list an instrumentation. Ask: axios, fetch, or both? capture bodies? axios needs `HttpModule` imported alongside.
- **[collectors-validator.md](references/collectors-validator.md)** — ask: class-validator or zod? Installs a global `APP_PIPE` — remove any second global `ValidationPipe`; value-import DTOs.
- **[collectors-config-auth.md](references/collectors-config-auth.md)** — ask: extra keys / user fields to mask.
- **[collectors-simple.md](references/collectors-simple.md)** — cache / graphql / commander / routes / rabbitmq: mostly confirm inclusion. GraphQL `context` must expose the request; commander needs file storage in both processes.

Place each per the matrix (`config`/`validator`/`routes`/`commander` at the root, ideally bundled into `ProfilingModule`; database / http / cache / rabbitmq / graphql co-located with their host module), and gate it the same way as the core (`ConditionalModule.registerWhen(..., isProfilerEnabled)` for A). Collectors need no no-op counterpart.

## Finalize

- Add `PROFILER_ENABLED=true` to `.env` and `.env.example` **for local dev** — the code default (`enabled('PROFILER_ENABLED')`) is off, so a production deploy without the variable stays off.
- If the user configured a `security` strategy, add the credential env var(s) their strategy reads (e.g. `PROFILER_BASIC_PASSWORD`) to `.env.example` — the profiler defines no auth env var itself.
- If `storageType: 'file'` or SQLite, add `.profiler/` to `.gitignore`.
- **State the production stance explicitly** when you finish: recommend keeping the profiler off in production by default. Because the profiler is **open by default**, if the user wants it on anywhere reachable they MUST add a `security` strategy — don't refuse, confirm they accept the exposure and route them to the `harden-for-production` skill.

## Verify

- Start the app, `curl -i http://localhost:3000/<some-route>`, and confirm the response carries `X-Debug-Token` and `X-Debug-Token-Link`.
- Open `http://localhost:3000/_profiler`, click the token, and confirm the Request / Response / Performance / Logs / Exceptions tabs (plus any collector panel you added) render.
- Confirm the app still boots with `PROFILER_ENABLED=false` — `ProfilerService` must still resolve.
