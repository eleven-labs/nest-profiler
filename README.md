# nest-profiler

A **Symfony Web Profiler-inspired** toolkit for NestJS applications. Every HTTP request receives a unique token, and a rich panel UI at `/_profiler` lets you inspect request data, logs, exceptions, performance spans, and much more — in real time.

The ecosystem is built around an **extensible collector architecture**: the core package provides the profiler engine, storage, and UI, while optional sub-packages each add a dedicated panel as a self-contained NestJS module.

## Packages

Each package is a self-contained NestJS module with its own README:

- [`@eleven-labs/nest-profiler`](packages/nest-profiler/README.md) — Core + Timeline panel

## Quickstart

Requirements: Node.js `22+`, pnpm `10+`

```bash
pnpm install        # install dependencies
pnpm build          # build all packages
pnpm test:cov       # run the test suite with coverage
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

## Repository Layout

A pnpm + Turbo monorepo. Publishable packages live under `packages/`; everything else supports them.

```text
packages/
  nest-profiler/            core profiler engine, storage, and UI
  configs/                  shared @repo/* tooling presets (eslint, jest, prettier, typescript)
```

## Common Commands

Run a task across every package via Turbo:

```bash
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test           # run unit tests
pnpm test:cov       # run tests with coverage (enforces the 90% threshold)
pnpm build          # build all packages
pnpm changeset      # record a version bump
```

Target a single package with `--filter`:

```bash
pnpm --filter @eleven-labs/nest-profiler test:cov
```

## Publishing

Published packages are versioned with Changesets:

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

Packages are published to the **GitHub Packages** registry.

## License

MIT — © 2026 Fabien Pasquet
