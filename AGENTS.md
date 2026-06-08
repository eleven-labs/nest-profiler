# NestJS Package Template

## Project overview

Open-source monorepo for the `@eleven-labs/nest-profiler` ecosystem: a Symfony Web Profiler-inspired toolkit for NestJS. It ships 11 publishable packages (`@eleven-labs/nest-profiler` core + 10 collector packages), a consuming example app (`example-api`), shared `@repo/*` workspace presets, an English-only Fumadocs site, and full CI / release automation to publish to github.

Constraints:

- Open source, MIT licensed.
- Only Node `>=22.0.0` is supported. No legacy Node 20, no `.nvmrc`.
- Public package APIs must remain importable from the package root only.
- The documentation site targets package consumers, never maintainers of the template itself.

---

## Technical stack

NestJS + TypeScript packages, Jest for tests, ESLint + Prettier, Turborepo for task orchestration, Changesets for versioning and publishing, Fumadocs (Next.js + MDX) for the English-only documentation site. Exact versions live in the respective `package.json` files.

Shared ESLint / Prettier / TypeScript / Jest rules live in `packages/configs/*` and are consumed as `@repo/*` packages with `workspace:*`. Never duplicate compiler, lint, or test options downstream — extend the preset.

---

## Architecture

The agent should introspect the workspace before editing; only the non-obvious rules are listed here.

- `packages/<name>` is the only path for publishable packages. New packages mirror the shape of `packages/nest-profiler`.
- `packages/configs/*` are private `@repo/*` presets, never published.
- `examples/api` is the consumer-side demonstration. It is in `.changeset/config.json#ignore` and never enters the release flow.
- `docs/` is a Fumadocs site deployed to Vercel via Vercel's Git integration (no workflow in this repo), independently of package release.
- `scripts/` holds release helpers (`changesets/*`, `absolutize-readme-images.ts`), not runtime code. Repository labels and milestones are declarative (`.github/labels.yml`, `.github/milestones.yml`) and synced by the `repo-config.yml` workflow; one-time GitHub setup is documented in `MAINTAINERS.md`.

---

## Code conventions

- Public exports live exclusively in each package's `src/index.ts`. Deep imports from `dist/` or internal paths are not part of the public API.
- Every public symbol that should appear in the API reference carries TSDoc comments — `<AutoTypeTable>` reads them.
- NestJS modules use `ConfigurableModuleBuilder` with `forRoot` / `forRootAsync`. Options expose an `isGlobal` flag forwarded as `global` on the returned `DynamicModule`.
- Publishable packages declare `"type": "commonjs"`, `"sideEffects": false`, `"engines.node": ">=22.0.0"`, and treat NestJS + `reflect-metadata` + `rxjs` as **peer** dependencies (and as devDependencies for local tests).
- Tests live next to the source as `*.spec.ts` and run under Jest with `ts-jest`.
- Documentation content is written in English only. Consumer documentation files use the explicit `.en.mdx` suffix, and the default language served by the site is `en`.
- Any user-visible change to a publishable package requires a Changeset entry (`pnpm changeset`). `example-api` and `@repo/*` are excluded from publishing.

---

## Available commands

The agent should read `package.json` for the full list of scripts. The conventions below describe when to use them, not which exist.

- Targeted iteration: `pnpm --filter @eleven-labs/<name> <script>` (e.g. `pnpm --filter @eleven-labs/nest-profiler test`).
- Cross-cutting actions live in root `package.json` scripts (docs, example app, release, packing). Prefer them over recreating their command lines.
- Do not invoke `turbo run …` directly from new code or workflows — route through a root script.

### Mandatory validation before delivery

Every change must pass:

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`

Add when the change touches the matching area:

- `pnpm docs:build` — when editing anything under `docs/`.
- `pnpm pack:dry-run`, `pnpm publint`, and `pnpm attw` — when editing a publishable package's manifest or its public exports.
- Repeat the relevant suite under `nvm use 22` then `nvm use 24` when the change is runtime-sensitive.

No change is considered ready while any required step fails.

---

## Best practices

- **SOLID and clear boundaries**: each NestJS module exposes one responsibility, services are injected via tokens, options flow through `ConfigurableModuleBuilder`. Avoid generic helper layers until two packages prove they are needed.
- **DRY across the workspace**: shared lint / format / TypeScript rules live in the `@repo/*` presets, never duplicated downstream. Shared release filters live in root `package.json` scripts, not inside workflows.
- **KISS**: a package template should be obvious before it is clever. Prefer one explicit module + service pattern over abstract factories. Three similar lines beat a premature abstraction.
- **Configurability**: anything environment-specific is supplied by the _consumer_ through module options (`forRoot` / `forRootAsync`). Packages never read `process.env` directly — that decision belongs to the host application (`examples/api` shows the pattern).
- **Dependency hygiene**: before adding a new runtime dependency, check whether NestJS, `rxjs`, or an existing package already provides it. New dependencies must be actively maintained, lightweight, and declared in the correct bucket — `peerDependencies` for anything the consumer also installs.
- **Documentation in sync**: any change to a publishable package's public API requires updating its `docs/content/docs/packages/<name>.en.mdx` page, its `api-reference/<name>.en.mdx` page, and — where relevant — its tutorials.

---

## Workflow

### When adding a feature

1. Identify the target package under `packages/<name>`, or scaffold a new one when no existing package fits.
2. Implement the change in the appropriate file — service for runtime logic, builder for option contracts, module for wiring.
3. Add or update `*.spec.ts` next to the code to cover the new behaviour.
4. Export anything intended for consumers from the package's `src/index.ts` only, and add TSDoc on every new public symbol.
5. If the feature is demonstrable, wire it into `examples/api`.
6. Update the matching Fumadocs pages (package guide, API reference, tutorial) in English.
7. Run the mandatory validation suite, then add `pnpm changeset`.

### When fixing a bug

1. Write a failing `*.spec.ts` that reproduces the bug (TDD-first).
2. Fix the source. Do not bundle refactors or unrelated cleanup into a bug fix.
3. Confirm error handling and any user-facing messages still match the public contract.
4. Run the mandatory validation suite, then add `pnpm changeset` with a `patch` bump.

### When refactoring

1. Run `pnpm test` before any edit to capture the current baseline.
2. Keep the public API stable — `src/index.ts` exports and option types do not change in a refactor.
3. Stay within the existing architectural boundaries (packages vs configs vs examples vs docs).
4. Coverage must not drop on touched packages.
5. Run the mandatory validation suite.
6. Add a Changeset only if any consumer-observable behaviour changed.
