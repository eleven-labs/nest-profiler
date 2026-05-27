# nest-profiler

A **Symfony Web Profiler-inspired** toolkit for NestJS applications. Every HTTP request receives a unique token, and a rich panel UI at `/_profiler` lets you inspect request data, logs, exceptions, performance spans, and much more — in real time.

The ecosystem is built around an **extensible collector architecture**: the core package provides the profiler engine, storage, and UI, while optional sub-packages each add a dedicated panel as a self-contained NestJS module.

## Quickstart

Requirements: Node.js `22+`, pnpm `10+`

```bash
pnpm install        # install dependencies
```

## Repository Layout

A pnpm + Turbo monorepo. Publishable packages live under `packages/`; everything else supports them.

```text
packages/
  configs/                  shared @repo/* tooling presets (eslint, jest, prettier, typescript)
```

## Common Commands

Run a task across every package via Turbo:

```bash
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test           # run unit tests
pnpm build          # build all packages
pnpm changeset      # record a version bump
```

## License

MIT — © 2026 Fabien Pasquet
