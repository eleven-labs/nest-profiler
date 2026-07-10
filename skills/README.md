# Agent skills

Installable [agent skills](https://github.com/vercel-labs/skills) that teach your coding agent (Claude Code, Cursor, Codex…) how to add and configure `@eleven-labs/nest-profiler` in your own NestJS application. Each skill is a self-contained `SKILL.md` with bundled `references/`.

## Install

```bash
# All skills from this repo
npx skills add eleven-labs/nest-profiler

# A single skill (monorepo subpath)
npx skills add https://github.com/eleven-labs/nest-profiler/tree/main/skills/setup-nest-profiler
```

`npx skills` auto-detects your installed agents and drops the skill into the right config directory (project scope by default, `-g` for global). Then just ask your agent, e.g. _"set up nest-profiler in this app"_.

## Available skills

| Skill                                                                 | What it does                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`setup-nest-profiler`](setup-nest-profiler/SKILL.md)                 | Install and configure the core profiler end-to-end: introspect the project, pick an enable strategy (`ConditionalModule` vs the `enabled` flag), configure the core and each collector via targeted questions, capture logs, and verify. |
| [`add-nest-profiler-collector`](add-nest-profiler-collector/SKILL.md) | Add one collector package to an app that already has the core profiler set up, matching the existing enable strategy and placement rules.                                                                                                |
| [`harden-for-production`](harden-for-production/SKILL.md)             | Harden an existing setup for production: pluggable `security` access control (guards / authorize), masking, sampling, retention and safe persistence.                                                                                    |
| [`custom-collector`](custom-collector/SKILL.md)                       | Write a custom collector (`IProfilerCollector`) or a context adapter (`IContextAdapter`) when no official collector package instruments the integration.                                                                                 |
| [`custom-storage-adapter`](custom-storage-adapter/SKILL.md)           | Implement a custom storage backend (Redis, a database, S3…) via `IProfilerStorageAdapter` and the `storage` option.                                                                                                                      |
| [`interpret-performance-tags`](interpret-performance-tags/SKILL.md)   | Read and act on the performance tags (slow, n+1, chatty, large-payload, error), tune thresholds, and add custom rules.                                                                                                                   |

## Evals

Each skill has its own `evals/` folder with manual evaluations — one JSON file per topic (`skill.json` for the workflow, plus one per reference file). They assert the enable strategy, collector choice, placement, and gotchas the skill should drive. See [`setup-nest-profiler/evals`](setup-nest-profiler/evals/README.md) and [`add-nest-profiler-collector/evals`](add-nest-profiler-collector/evals/README.md).

## Notes

- The `collectors-*.md` family references (`collectors-matrix.md`, `collectors-orm.md`, `collectors-http.md`, `collectors-validator.md`, `collectors-config-auth.md`, `collectors-simple.md`) are bundled by **both** skills so each installs standalone, but there is a **single source of truth**: `setup-nest-profiler/references/`. The copies under `add-nest-profiler-collector/references/` are **generated** — do not edit them by hand. After changing a source file, run `pnpm sync:skill-refs`; the Quality workflow runs `pnpm sync:skill-refs:check` and fails on drift.
- These consumer skills live under `skills/` (committed, the source of truth per `.gitignore`), distinct from the maintainer skills installed per-developer under `.agents/skills/`.
