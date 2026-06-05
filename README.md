# nest-profiler

A **Symfony Web Profiler-inspired** toolkit for NestJS applications. Each profiled execution receives a unique token, and a rich panel UI at `/_profiler` lets you inspect request data, logs, exceptions, performance spans, and much more — in real time.

The ecosystem is built around an **extensible collector architecture**: the core package provides the profiler engine, storage, and UI, while optional sub-packages each add a dedicated panel as a self-contained NestJS module.

![Profiler UI — profiles list with filters, HTTP statuses, durations and the global Config panel](docs/public/screenshots/profiler/profiles-list.png)

## Packages

Each package is a self-contained NestJS module with its own README:

- [`@eleven-labs/nest-profiler`](packages/nest-profiler/README.md) — Core + Timeline panel
- [`@eleven-labs/nest-profiler-typeorm`](packages/nest-profiler-typeorm/README.md) — Database panel (TypeORM)
- [`@eleven-labs/nest-profiler-mikro-orm`](packages/nest-profiler-mikro-orm/README.md) — Database panel (MikroORM)
- [`@eleven-labs/nest-profiler-axios`](packages/nest-profiler-axios/README.md) — HTTP Client panel
- [`@eleven-labs/nest-profiler-cache`](packages/nest-profiler-cache/README.md) — Cache panel
- [`@eleven-labs/nest-profiler-auth`](packages/nest-profiler-auth/README.md) — Security panel
- [`@eleven-labs/nest-profiler-config`](packages/nest-profiler-config/README.md) — Config panel
- [`@eleven-labs/nest-profiler-mongoose`](packages/nest-profiler-mongoose/README.md) — Database (NoSQL) panel
- [`@eleven-labs/nest-profiler-validator`](packages/nest-profiler-validator/README.md) — Validator panel

Full guides and API reference live on the documentation site (`pnpm docs:dev`, then http://localhost:3002).

### Panels at a glance

|                                                                  |                                                                        |                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ![Database panel](docs/public/screenshots/profiler/database.png) | ![HTTP Client panel](docs/public/screenshots/profiler/http-client.png) | ![Cache panel](docs/public/screenshots/profiler/cache.png)       |
| **Database** (TypeORM)                                           | **HTTP Client** (Axios)                                                | **Cache**                                                        |
| ![Security panel](docs/public/screenshots/profiler/security.png) | ![Validator panel](docs/public/screenshots/profiler/validator.png)     | ![Timeline panel](docs/public/screenshots/profiler/timeline.png) |
| **Security** (JWT/Auth)                                          | **Validator** (class-validator)                                        | **Timeline** (spans)                                             |

## Quickstart

Requirements: Node.js `22+`, pnpm `10+`

```bash
pnpm install        # install dependencies
pnpm build          # build all packages
pnpm test:cov       # run the test suite with coverage
pnpm docs:dev       # serve the documentation site at http://localhost:3002
```

To try the profiler against a real app, start the demo API and open `http://localhost:3000/_profiler`:

```bash
pnpm example:dev
```

## Installation

Packages are published to **GitHub Packages**. Unlike the public npm registry, GitHub Packages requires authentication even for public packages.

### 1. Create a GitHub token

Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)** and generate a token with the `read:packages` scope.

> In GitHub Actions, `${{ secrets.GITHUB_TOKEN }}` already has `read:packages` — no extra token needed in CI.

### 2. Configure `.npmrc`

Add the registry mapping to your project's `.npmrc` (or `~/.npmrc` for a global setup):

```ini
@eleven-labs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then export the token in your shell (or add it to your `.env`):

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

### 3. Install

```bash
pnpm add @eleven-labs/nest-profiler nestjs-cls
```

```ts title="app.module.ts"
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

Add optional collectors in their respective feature modules:

```bash
pnpm add @eleven-labs/nest-profiler-typeorm
```

```ts title="products/products.module.ts"
import { TypeOrmCollectorModule } from '@eleven-labs/nest-profiler-typeorm';

@Module({
  imports: [TypeOrmCollectorModule.forRoot({ slowQueryThreshold: 50 })],
})
export class ProductsModule {}
```

## Repository Layout

A pnpm + Turbo monorepo. Publishable packages live under `packages/`; everything else supports them.

```text
packages/
  nest-profiler/            core profiler engine, storage, and UI
  nest-profiler-*/          optional collectors (typeorm, axios, cache, auth, config, mongoose, validator)
  configs/                  shared @repo/* tooling presets (eslint, jest, prettier, typescript)
examples/
  api/                      NestJS demo app with all collectors enabled
docs/                       Fumadocs documentation site
scripts/                    repository automation and release helpers
```

## Common Commands

Run a task across every package via Turbo:

```bash
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test           # run unit tests
pnpm test:cov       # run tests with coverage (enforces the 90% threshold)
pnpm build          # build all packages
pnpm docs:dev       # serve the docs site
pnpm changeset      # record a version bump
```

Target a single package with `--filter`:

```bash
pnpm --filter @eleven-labs/nest-profiler test:cov
pnpm --filter @eleven-labs/nest-profiler-typeorm build
```

## Publishing

Published packages are versioned with Changesets. The project intentionally stays in `0.x` until the public API is mature enough for a stable `1.0.0`.

### Versioning Policy

While packages are in `0.x`:

- use `patch` for bug fixes
- use `minor` for new features and breaking changes
- reserve `major` for the explicit v1 transition, or another intentional major release

Breaking changes in `0.x` should still be documented clearly in the changeset body with a `BREAKING:` note. CI rejects `major` changesets by default; set `ALLOW_MAJOR_BUMPS=true` only when preparing v1.

The stable v0 release channel is named `stable` in scripts and is published with the npm/GitHub Packages `latest` dist-tag. Consumer-facing versions still look like `0.2.0`, `0.3.0`, and so on.

### Release Channels

The release workflow calls `pnpm release`, which publishes with `latest` by default and automatically uses the active Changesets prerelease tag when `.changeset/pre.json` is in `pre` mode. The channel-specific scripts are available for explicit local publishes.

Stable v0 release:

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

Alpha release:

```bash
pnpm changeset:pre:alpha
pnpm changeset
pnpm version-packages
pnpm release:alpha
```

Beta release:

```bash
pnpm changeset:pre:beta
pnpm changeset
pnpm version-packages
pnpm release:beta
```

Exit prerelease mode before publishing the stable v0 version:

```bash
pnpm changeset:pre:exit
pnpm version-packages
pnpm release
```

Packages are published to the **GitHub Packages** registry by the release workflow on pushes to `main`. Authentication uses `GITHUB_TOKEN` automatically — no additional secret is needed.

## License

MIT — © 2026 Fabien Pasquet
